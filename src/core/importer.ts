import type { ExportFormat, ImportOptions, StoreSchema } from '../types/index.js';
import { deserialize } from '../serialization/index.js';

/**
 * Delete an IndexedDB database by name.
 *
 * @param dbName - The name of the database to delete.
 * @returns A promise that resolves when the database is deleted.
 */
function deleteDatabase(dbName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(new Error(`Failed to delete database "${dbName}": ${String(request.error)}`));
    };

    request.onblocked = () => {
      reject(
        new Error(
          `Database "${dbName}" deletion blocked. Close all other connections to this database and try again.`
        )
      );
    };
  });
}

/**
 * Create object stores and indexes based on the backup schema during an `onupgradeneeded` event.
 *
 * @param db - The IDBDatabase instance being upgraded.
 * @param schema - The schema definitions from the backup.
 * @param strategy - The import strategy being used.
 */
function createStoresFromSchema(
  db: IDBDatabase,
  schema: Record<string, StoreSchema>,
  strategy: 'overwrite' | 'merge'
): void {
  for (const [storeName, storeSchema] of Object.entries(schema)) {
    let store: IDBObjectStore;

    if (db.objectStoreNames.contains(storeName)) {
      if (strategy === 'overwrite') {
        // In overwrite mode on a fresh DB, this shouldn't happen,
        // but handle it defensively
        db.deleteObjectStore(storeName);
        store = db.createObjectStore(storeName, {
          keyPath: storeSchema.keyPath ?? undefined,
          autoIncrement: storeSchema.autoIncrement,
        });
      } else {
        // Merge mode: store already exists, skip creation.
        // We cannot access the store for index creation outside a
        // versionchange transaction that actually changes the version,
        // so we skip index modification in merge mode.
        continue;
      }
    } else {
      store = db.createObjectStore(storeName, {
        keyPath: storeSchema.keyPath ?? undefined,
        autoIncrement: storeSchema.autoIncrement,
      });
    }

    // Create indexes on the newly created store
    for (const indexSchema of storeSchema.indexes) {
      store.createIndex(indexSchema.name, indexSchema.keyPath, {
        unique: indexSchema.unique,
        multiEntry: indexSchema.multiEntry,
      });
    }
  }
}

/**
 * Open (or create) a database matching the backup schema.
 *
 * For the `"overwrite"` strategy, the existing database is deleted first,
 * then a new database is created with the backup's version and schema.
 *
 * For the `"merge"` strategy, the database is opened with a version bump
 * (if new stores need to be added), or at the current version if no
 * structural changes are required.
 *
 * @param dbName - The name of the database to open.
 * @param backupData - The parsed backup data.
 * @param strategy - The import strategy.
 * @returns A promise that resolves to the opened IDBDatabase.
 */
async function openDatabaseForImport(
  dbName: string,
  backupData: ExportFormat,
  strategy: 'overwrite' | 'merge'
): Promise<IDBDatabase> {
  if (strategy === 'overwrite') {
    // Delete the existing database entirely
    await deleteDatabase(dbName);

    // Recreate with the backup's version and schema
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, backupData.databaseVersion);

      request.onupgradeneeded = () => {
        const db = request.result;
        createStoresFromSchema(db, backupData.schema, strategy);
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        reject(new Error(`Failed to create database "${dbName}": ${String(request.error)}`));
      };

      request.onblocked = () => {
        reject(
          new Error(
            `Database "${dbName}" open blocked. Close all other connections and try again.`
          )
        );
      };
    });
  }

  // Merge strategy: open at a higher version if new stores are needed
  return new Promise((resolve, reject) => {
    // First, probe the current version
    const probeRequest = indexedDB.open(dbName);

    probeRequest.onsuccess = () => {
      const existingDb = probeRequest.result;
      const currentVersion = existingDb.version;
      const existingStoreNames = Array.from(existingDb.objectStoreNames);
      existingDb.close();

      // Check if we need to add any new stores
      const backupStoreNames = Object.keys(backupData.schema);
      const needsNewStores = backupStoreNames.some(
        (name) => !existingStoreNames.includes(name)
      );

      if (!needsNewStores) {
        // No structural changes needed — just open at the current version
        const openRequest = indexedDB.open(dbName, currentVersion);

        openRequest.onsuccess = () => {
          resolve(openRequest.result);
        };

        openRequest.onerror = () => {
          reject(
            new Error(`Failed to open database "${dbName}": ${String(openRequest.error)}`)
          );
        };

        openRequest.onblocked = () => {
          reject(
            new Error(
              `Database "${dbName}" open blocked. Close all other connections and try again.`
            )
          );
        };
        return;
      }

      // Need to add stores — bump version by 1 to trigger onupgradeneeded
      const upgradeRequest = indexedDB.open(dbName, currentVersion + 1);

      upgradeRequest.onupgradeneeded = () => {
        const db = upgradeRequest.result;
        createStoresFromSchema(db, backupData.schema, strategy);
      };

      upgradeRequest.onsuccess = () => {
        resolve(upgradeRequest.result);
      };

      upgradeRequest.onerror = () => {
        reject(
          new Error(`Failed to upgrade database "${dbName}": ${String(upgradeRequest.error)}`)
        );
      };

      upgradeRequest.onblocked = () => {
        reject(
          new Error(
            `Database "${dbName}" upgrade blocked. Close all other connections and try again.`
          )
        );
      };
    };

    probeRequest.onerror = () => {
      reject(new Error(`Failed to probe database "${dbName}": ${String(probeRequest.error)}`));
    };
  });
}

/**
 * Insert records into a single object store.
 *
 * Each record is deserialized from its tagged representation back to
 * native JavaScript types before insertion.
 *
 * In merge mode, `put()` is used to upsert records (add or update by key).
 * In overwrite mode, `add()` is used since the store is guaranteed to be empty.
 *
 * @param store - The IDBObjectStore to insert records into.
 * @param records - The serialized records from the backup.
 * @param strategy - The import strategy.
 * @returns A promise that resolves when all records are inserted.
 */
function insertRecords(
  store: IDBObjectStore,
  records: Array<{ key: unknown; value: unknown }>,
  strategy: 'overwrite' | 'merge'
): Promise<void> {
  return new Promise((resolve, reject) => {
    let completed = 0;
    const total = records.length;

    if (total === 0) {
      resolve();
      return;
    }

    for (const serializedRecord of records) {
      const value = deserialize(serializedRecord.value);
      const key = deserialize(serializedRecord.key);

      // For stores with out-of-line keys (keyPath is null), pass the key explicitly.
      // For inline-key stores, IDB extracts the key from the value automatically.
      const hasInlineKey = store.keyPath !== null;
      let request: IDBRequest;

      if (strategy === 'merge') {
        request = hasInlineKey ? store.put(value) : store.put(value, key as IDBValidKey);
      } else {
        request = hasInlineKey ? store.add(value) : store.add(value, key as IDBValidKey);
      }

      request.onsuccess = () => {
        completed++;
        if (completed === total) {
          resolve();
        }
      };

      request.onerror = () => {
        reject(
          new Error(
            `Failed to insert record into store "${store.name}": ${String(request.error)}`
          )
        );
      };
    }
  });
}

/**
 * Import data from a JSON backup into an IndexedDB database.
 *
 * Supports two strategies:
 * - `"overwrite"` — Deletes the existing database, recreates it from the backup
 *   schema, and inserts all backup records. This is a clean restore.
 * - `"merge"` — Opens the existing database, creates any missing stores from the
 *   backup schema, and upserts records (add new, update existing by key).
 *
 * @param options - Import configuration.
 * @param options.dbName - The name of the target IndexedDB database.
 * @param options.backupData - The parsed ExportFormat JSON to import.
 * @param options.strategy - Either `"overwrite"` or `"merge"`.
 * @param options.storeNames - Optional list of store names to restore records into. If omitted,
 *   records from every store in the backup are restored. Schema creation is unaffected, so stores
 *   left out of the list still exist after the import — they are simply not populated.
 * @returns A promise that resolves when the import is complete.
 *
 * @example
 * ```typescript
 * // Overwrite: clean restore
 * await importDB({
 *   dbName: 'my-app-db',
 *   backupData: backup,
 *   strategy: 'overwrite',
 * });
 *
 * // Merge: additive sync
 * await importDB({
 *   dbName: 'my-app-db',
 *   backupData: backup,
 *   strategy: 'merge',
 * });
 *
 * // Selective restore: rebuild the full schema, but only repopulate user data
 * // and leave derived cache stores empty so the app refetches them.
 * await importDB({
 *   dbName: 'my-app-db',
 *   backupData: backup,
 *   strategy: 'overwrite',
 *   storeNames: ['portfolioPositions', 'portfolioTransactions'],
 * });
 * ```
 */
export async function importDB(options: ImportOptions): Promise<void> {
  const { dbName, backupData, strategy, storeNames } = options;

  const db = await openDatabaseForImport(dbName, backupData, strategy);

  try {
    // Determine which stores to populate from the backup
    const selected = storeNames ? new Set(storeNames) : null;
    const dbStoreNames = Array.from(db.objectStoreNames);

    // Only insert into stores that exist in both the backup and the database,
    // narrowed to the caller's `storeNames` selection when one was provided.
    const targetStores = Object.keys(backupData.stores).filter(
      (name) => dbStoreNames.includes(name) && (selected === null || selected.has(name)),
    );

    if (targetStores.length === 0) {
      return;
    }

    // Open a single readwrite transaction across all target stores
    const transaction = db.transaction(targetStores, 'readwrite');

    const insertPromises = targetStores.map((storeName) => {
      const store = transaction.objectStore(storeName);
      const records = backupData.stores[storeName] ?? [];
      return insertRecords(store, records, strategy);
    });

    await Promise.all(insertPromises);

    // Wait for the transaction to complete
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => {
        resolve();
      };
      transaction.onerror = () => {
        reject(new Error(`Import transaction failed: ${String(transaction.error)}`));
      };
      transaction.onabort = () => {
        reject(new Error(`Import transaction aborted: ${String(transaction.error)}`));
      };
    });
  } finally {
    db.close();
  }
}
