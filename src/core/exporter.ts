import type { ExportFormat, ExportOptions, IndexSchema, StoreSchema } from '../types/index.js';
import { serialize, BACKUP_VERSION } from '../serialization/index.js';

/**
 * Extract the schema for a single object store, including all its indexes.
 *
 * @param store - The IDBObjectStore to extract the schema from.
 * @returns The store schema definition.
 */
function extractStoreSchema(store: IDBObjectStore): StoreSchema {
  const indexes: IndexSchema[] = [];

  const indexNames = Array.from(store.indexNames);

  for (const indexName of indexNames) {
    const index = store.index(indexName);
    indexes.push({
      name: index.name,
      keyPath: index.keyPath,
      unique: index.unique,
      multiEntry: index.multiEntry,
    });
  }

  return {
    keyPath: store.keyPath,
    autoIncrement: store.autoIncrement,
    indexes,
  };
}

/**
 * Read all records from an object store using a cursor.
 *
 * Each record is serialized using type-tagged serialization to ensure
 * non-JSON-safe types (Uint8Array, bigint, Date) are preserved.
 *
 * @param store - The IDBObjectStore to read records from.
 * @returns A promise that resolves to an array of serialized records.
 */
function readAllRecords(store: IDBObjectStore): Promise<Array<{ key: unknown; value: unknown }>> {
  return new Promise((resolve, reject) => {
    const records: Array<{ key: unknown; value: unknown }> = [];
    const request = store.openCursor();

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor) {
        records.push({
          key: serialize(cursor.primaryKey),
          value: serialize(cursor.value),
        });
        cursor.continue();
      } else {
        resolve(records);
      }
    };

    request.onerror = () => {
      reject(
        new Error(`Failed to read records from store "${store.name}": ${String(request.error)}`),
      );
    };
  });
}

/**
 * Read the next key that each auto-increment store's key generator would assign.
 *
 * IndexedDB has no API to read a key generator directly, so this adds an empty
 * placeholder record to each auto-increment store, reads the key it was given,
 * then aborts the transaction. Aborting rolls back both the placeholder and the
 * generator, so the database is left unchanged.
 *
 * A store whose probe fails (for example because its generator is exhausted)
 * is left out of the result, and its backup simply has no `keyGeneratorNext`.
 *
 * @param db - The open database.
 * @param storeNames - The auto-increment stores being exported (must not be empty).
 * @returns The next generated key for each auto-increment store, by store name.
 */
function readKeyGenerators(db: IDBDatabase, storeNames: string[]): Promise<Record<string, number>> {
  return new Promise((resolve) => {
    const result: Record<string, number> = Object.create(null);
    const transaction = db.transaction(storeNames, 'readwrite');
    transaction.onabort = () => resolve(result);

    let pending = storeNames.length;
    // Abort synchronously from the last request callback, while the transaction
    // is still active, so it can never auto-commit the placeholders.
    const settle = () => {
      pending--;
      if (pending === 0) {
        transaction.abort();
      }
    };

    for (const storeName of storeNames) {
      let request: IDBRequest<IDBValidKey>;
      try {
        request = transaction.objectStore(storeName).add({});
      } catch {
        settle();
        continue;
      }
      request.onsuccess = () => {
        if (typeof request.result === 'number') {
          result[storeName] = request.result;
        }
        settle();
      };
      request.onerror = (event) => {
        // Keep one failed probe from aborting the others early.
        event.preventDefault();
        settle();
      };
    }
  });
}

/**
 * Open an IndexedDB database by name.
 *
 * @param dbName - The name of the database to open.
 * @returns A promise that resolves to the opened IDBDatabase instance.
 */
function openDatabase(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let existed = true;
    const request = indexedDB.open(dbName);

    request.onupgradeneeded = (event) => {
      if (event.oldVersion === 0) {
        existed = false;
        request.transaction?.abort();
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = (event) => {
      event.preventDefault();
      if (!existed) {
        reject(new Error(`Database "${dbName}" does not exist`));
      } else {
        reject(new Error(`Failed to open database "${dbName}": ${String(request.error)}`));
      }
    };
  });
}

/**
 * Export an IndexedDB database to the generic JSON backup format.
 *
 * Opens the specified database, extracts the schema for each object store,
 * reads all records (with type-tagged serialization), and returns the
 * complete ExportFormat envelope.
 *
 * @param options - Export configuration.
 * @param options.dbName - The name of the IndexedDB database to export.
 * @param options.storeNames - Optional list of store names to export. If omitted, all stores are exported.
 * @returns A promise that resolves to the ExportFormat JSON object.
 *
 * @example
 * ```typescript
 * const backup = await exportDB({ dbName: 'my-app-db' });
 * console.log(JSON.stringify(backup, null, 2));
 * ```
 */
export async function exportDB(options: ExportOptions): Promise<ExportFormat> {
  const { dbName, storeNames } = options;

  const db = await openDatabase(dbName);

  try {
    // Determine which stores to export
    const allStoreNames = Array.from(db.objectStoreNames);
    const targetStores = storeNames
      ? [...new Set(storeNames.filter((name) => allStoreNames.includes(name)))]
      : allStoreNames;

    if (targetStores.length === 0) {
      // Return an empty export if no stores match
      return {
        backupVersion: BACKUP_VERSION,
        databaseName: db.name,
        databaseVersion: db.version,
        exportedAt: new Date().toISOString(),
        schema: {},
        stores: {},
      };
    }

    // Read the key generators of auto-increment stores first, in a separate
    // transaction that is rolled back. Only those stores are locked for writing.
    const schemaTransaction = db.transaction(targetStores, 'readonly');
    const autoIncrementStores = targetStores.filter(
      (storeName) => schemaTransaction.objectStore(storeName).autoIncrement,
    );
    const keyGenerators: Record<string, number> =
      autoIncrementStores.length > 0 ? await readKeyGenerators(db, autoIncrementStores) : {};

    // Open a single read-only transaction across all target stores
    const transaction = db.transaction(targetStores, 'readonly');
    const schema: Record<string, StoreSchema> = {};
    const stores: Record<string, Array<{ key: unknown; value: unknown }>> = {};

    // Process each store: extract schema and read records
    const storePromises = targetStores.map(async (storeName) => {
      const store = transaction.objectStore(storeName);
      schema[storeName] = extractStoreSchema(store);
      const keyGeneratorNext = keyGenerators[storeName];
      if (keyGeneratorNext !== undefined) {
        schema[storeName].keyGeneratorNext = keyGeneratorNext;
      }
      stores[storeName] = await readAllRecords(store);
    });

    await Promise.all(storePromises);

    return {
      backupVersion: BACKUP_VERSION,
      databaseName: db.name,
      databaseVersion: db.version,
      exportedAt: new Date().toISOString(),
      schema,
      stores,
    };
  } finally {
    db.close();
  }
}
