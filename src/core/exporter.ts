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
 * Read the schema, the records and the next generated key of every target store
 * in one `readwrite` transaction, so all three describe the same state.
 *
 * Requests run in the order they are placed. For each store, `getAllKeys()` and
 * `getAll()` are placed before its probe `add({})`, so the records never include
 * the placeholder. The probe reports the key the generator would assign next.
 * After the last result arrives, the transaction is aborted, which rolls back
 * every placeholder and generator change, so the database is left unchanged.
 *
 * A store whose probe fails (for example because its generator is exhausted)
 * gets no `keyGeneratorNext` in the result.
 *
 * @param db - The open database.
 * @param storeNames - The stores to read.
 * @returns The schema, the serialized records, and the next key per auto-increment store.
 */
function readSnapshot(
  db: IDBDatabase,
  storeNames: string[],
): Promise<{
  schema: Record<string, StoreSchema>;
  stores: Record<string, Array<{ key: unknown; value: unknown }>>;
  keyGenerators: Record<string, number>;
}> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, 'readwrite');
    const schema: Record<string, StoreSchema> = {};
    const keys: Record<string, IDBValidKey[]> = {};
    const values: Record<string, unknown[]> = {};
    const keyGenerators: Record<string, number> = Object.create(null);

    let outstanding = 0;
    // Abort from the last request callback, while the transaction is still
    // active, so nothing can auto-commit the placeholders.
    const settle = () => {
      outstanding--;
      if (outstanding === 0) {
        transaction.abort();
      }
    };
    const track = <T>(request: IDBRequest<T>, onResult: (result: T) => void, isProbe = false) => {
      outstanding++;
      request.onsuccess = () => {
        onResult(request.result);
        settle();
      };
      request.onerror = (event) => {
        if (isProbe) {
          // A failed probe leaves out keyGeneratorNext; it must not fail the export.
          event.preventDefault();
          settle();
          return;
        }
        reject(new Error(`Failed to read records: ${String(request.error)}`));
      };
    };

    transaction.onabort = () => {
      const stores: Record<string, Array<{ key: unknown; value: unknown }>> = {};
      for (const storeName of storeNames) {
        stores[storeName] = (keys[storeName] ?? []).map((key, i) => ({
          key: serialize(key),
          value: serialize(values[storeName]?.[i]),
        }));
      }
      resolve({ schema, stores, keyGenerators });
    };

    for (const storeName of storeNames) {
      const store = transaction.objectStore(storeName);
      schema[storeName] = extractStoreSchema(store);

      track(store.getAllKeys(), (result) => {
        keys[storeName] = result;
      });
      track(store.getAll(), (result) => {
        values[storeName] = result;
      });

      if (store.autoIncrement) {
        let probe: IDBRequest<IDBValidKey>;
        try {
          probe = store.add({});
        } catch {
          continue;
        }
        track(
          probe,
          (result) => {
            if (typeof result === 'number') {
              keyGenerators[storeName] = result;
            }
          },
          true,
        );
      }
    }

    if (outstanding === 0) {
      transaction.abort();
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

    const { schema, stores, keyGenerators } = await readSnapshot(db, targetStores);
    for (const [storeName, keyGeneratorNext] of Object.entries(keyGenerators)) {
      schema[storeName]!.keyGeneratorNext = keyGeneratorNext;
    }

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
