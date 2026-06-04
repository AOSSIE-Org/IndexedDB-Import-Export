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
      reject(new Error(`Failed to read records from store "${store.name}": ${String(request.error)}`));
    };
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
    const request = indexedDB.open(dbName);

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(new Error(`Failed to open database "${dbName}": ${String(request.error)}`));
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
      ? storeNames.filter((name) => allStoreNames.includes(name))
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

    // Open a single read-only transaction across all target stores
    const transaction = db.transaction(targetStores, 'readonly');
    const schema: Record<string, StoreSchema> = {};
    const stores: Record<string, Array<{ key: unknown; value: unknown }>> = {};

    // Process each store: extract schema and read records
    const storePromises = targetStores.map(async (storeName) => {
      const store = transaction.objectStore(storeName);
      schema[storeName] = extractStoreSchema(store);
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
