import type { ExportFormat, ImportOptions, ImportSummary, StoreSchema } from '../types/index.js';
import { deserialize } from '../serialization/index.js';

/**
 * Build a stable {@link ImportSummary} from a backup envelope and the schema and
 * store subset that will actually be imported.
 *
 * Store names come from `schema` — the stores `importDB` will create — so the
 * summary lists exactly what will exist after the import, not what merely appears
 * in the backup records. Per-store counts come from `stores` (0 for a store the
 * schema creates but the records omit). Both are already narrowed to any
 * `storeNames` selection. The envelope-level metadata comes from `backupData`,
 * without exposing the raw {@link ExportFormat} to the caller.
 *
 * @param backupData - The parsed backup data, for the envelope-level metadata.
 * @param schema - The schema subset that will be created, after any selection.
 * @param stores - The store records that will be imported, after any selection.
 * @returns A summary describing what will be imported.
 */
function buildImportSummary(
  backupData: ExportFormat,
  schema: ExportFormat['schema'],
  stores: ExportFormat['stores'],
): ImportSummary {
  const storeNames = Object.keys(schema);
  const recordCounts: Record<string, number> = Object.create(null);

  for (const storeName of storeNames) {
    recordCounts[storeName] = stores[storeName]?.length ?? 0;
  }

  return {
    storeNames,
    recordCounts,
    backupVersion: backupData.backupVersion,
    databaseName: backupData.databaseName,
    exportedAt: backupData.exportedAt,
  };
}

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
 * Narrow a store-keyed record from the backup to the caller's `storeNames` selection.
 *
 * Used for both `schema` and `stores`, so a selection scopes structure and data
 * identically — the same subset a selective `exportDB()` would have produced.
 *
 * @param entries - A store-keyed record from the backup envelope.
 * @param selected - The selected store names, or `null` when the caller made no selection.
 * @returns The entries for the selected stores, or `entries` unchanged when there is no selection.
 */
function selectStores<T>(
  entries: Record<string, T>,
  selected: Set<string> | null,
): Record<string, T> {
  if (selected === null) {
    return entries;
  }

  return Object.fromEntries(Object.entries(entries).filter(([name]) => selected.has(name)));
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
 * Only the stores in `schema` are created. When the caller narrowed the import
 * with `storeNames`, the excluded stores are therefore never created here — under
 * `"merge"` that also means their absence does not trigger a version bump.
 *
 * @param dbName - The name of the database to open.
 * @param databaseVersion - The database version recorded in the backup.
 * @param schema - The schema definitions to create, already narrowed to the caller's selection.
 * @param strategy - The import strategy.
 * @returns A promise that resolves to the opened IDBDatabase.
 */
async function openDatabaseForImport(
  dbName: string,
  databaseVersion: number,
  schema: Record<string, StoreSchema>,
  strategy: 'overwrite' | 'merge',
): Promise<IDBDatabase> {
  if (strategy === 'overwrite') {
    // Delete the existing database entirely
    await deleteDatabase(dbName);

    // Recreate with the backup's version and schema
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, databaseVersion);

      request.onupgradeneeded = () => {
        const db = request.result;
        createStoresFromSchema(db, schema, strategy);
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
      const backupStoreNames = Object.keys(schema);
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
        createStoresFromSchema(db, schema, strategy);
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
 * @param options.storeNames - Optional list of store names to restore. If omitted, every store in
 *   the backup is restored. The selection scopes both schema and records, so an excluded store is
 *   never created: under `"merge"` an excluded store that is missing stays missing (and does not
 *   trigger a version bump), and under `"overwrite"` — which recreates the database from scratch —
 *   an excluded store is absent afterwards even if it existed before.
 * @param options.onBeforeImport - Optional hook called with a summary of the backup (narrowed to
 *   any `storeNames` selection) before anything is written; return `false` to abort the import
 *   without writing or deleting any data.
 * @returns A promise that resolves when the import is complete, or resolves early without changes
 *   if `onBeforeImport` returns `false`.
 *
 * @example
 * ```typescript
 * // Merge: additive sync
 * await importDB({
 *   dbName: 'my-app-db',
 *   backupData: backup,
 *   strategy: 'merge',
 * });
 *
 * // Selective merge: restore user data and leave the derived cache stores alone,
 * // so the app refetches them rather than reviving a stale copy. The excluded
 * // stores are neither populated nor created.
 * await importDB({
 *   dbName: 'my-app-db',
 *   backupData: backup,
 *   strategy: 'merge',
 *   storeNames: ['portfolioPositions', 'portfolioTransactions'],
 * });
 *
 * // Overwrite: clean restore of the whole backup
 * await importDB({
 *   dbName: 'my-app-db',
 *   backupData: backup,
 *   strategy: 'overwrite',
 * });
 * ```
 */
export async function importDB(options: ImportOptions): Promise<void> {
  const { dbName, backupData, strategy, storeNames, onBeforeImport } = options;

  // A selection scopes the whole import. Narrowing the schema as well as the records
  // is what keeps a partial restore from quietly recreating the stores the caller
  // asked to leave out, and makes this equivalent to importing a backup that was
  // exported with the same `storeNames`.
  const selected = storeNames ? new Set(storeNames) : null;
  const schema = selectStores(backupData.schema, selected);
  const stores = selectStores(backupData.stores, selected);

  // Give the caller a chance to inspect and reject the backup before any
  // destructive work. This runs before openDatabaseForImport, which deletes the
  // database under the "overwrite" strategy. Selection above is side-effect free,
  // so the summary reflects the selected stores, i.e. what will actually be written.
  if (onBeforeImport) {
    const proceed = await onBeforeImport(buildImportSummary(backupData, schema, stores));
    if (!proceed) {
      return;
    }
  }

  const db = await openDatabaseForImport(dbName, backupData.databaseVersion, schema, strategy);

  try {
    // Determine which stores to populate from the backup
    const dbStoreNames = Array.from(db.objectStoreNames);

    // Only insert into stores that exist in both the (selected) backup and the database
    const targetStores = Object.keys(stores).filter((name) => dbStoreNames.includes(name));

    if (targetStores.length === 0) {
      return;
    }

    // Open a single readwrite transaction across all target stores
    const transaction = db.transaction(targetStores, 'readwrite');

    const insertPromises = targetStores.map((storeName) => {
      const store = transaction.objectStore(storeName);
      const records = stores[storeName] ?? [];
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
