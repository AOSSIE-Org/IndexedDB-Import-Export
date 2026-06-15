import { beforeEach, afterEach } from 'vitest';
import 'fake-indexeddb/auto';

/**
 * Track all database names created during a test so they can be
 * torn down in `afterEach`, preventing cross-test leakage.
 */
const createdDatabases: string[] = [];

/** Monotonic counter for unique database names. */
let dbCounter = 0;

/**
 * Generate a unique database name per test invocation.
 *
 * @param prefix - Optional human-readable prefix for debugging.
 * @returns A collision-free database name.
 */
export function uniqueDBName(prefix = 'test-db'): string {
  const name = `${prefix}-${Date.now()}-${dbCounter++}`;
  createdDatabases.push(name);
  return name;
}

/**
 * Schema descriptor passed to {@link createTestDB}.
 */
export interface TestStoreDescriptor {
  /** Object store name. */
  name: string;
  /** Key path or `null` for out-of-line keys. */
  keyPath?: string | string[] | null;
  /** Whether auto-increment is enabled. */
  autoIncrement?: boolean;
  /** Index definitions. */
  indexes?: Array<{
    name: string;
    keyPath: string | string[];
    unique?: boolean;
    multiEntry?: boolean;
  }>;
  /** Seed records. For out-of-line key stores, each item must have `key` and `value`. */
  records?: Array<{ key?: IDBValidKey; value: unknown }>;
}

/**
 * Create (or overwrite) a test database with the specified schema and seed data.
 *
 * @param dbName - The database name.
 * @param version - The database version.
 * @param stores - Descriptors for each object store.
 * @returns The opened {@link IDBDatabase} — the caller must close it when done.
 */
export function createTestDB(
  dbName: string,
  version: number,
  stores: TestStoreDescriptor[],
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, version);

    request.onupgradeneeded = () => {
      const db = request.result;

      for (const descriptor of stores) {
        const store = db.createObjectStore(descriptor.name, {
          keyPath: descriptor.keyPath ?? undefined,
          autoIncrement: descriptor.autoIncrement ?? false,
        });

        for (const idx of descriptor.indexes ?? []) {
          store.createIndex(idx.name, idx.keyPath, {
            unique: idx.unique ?? false,
            multiEntry: idx.multiEntry ?? false,
          });
        }
      }
    };

    request.onsuccess = () => {
      const db = request.result;

      // If no stores need seeding, resolve immediately.
      const storesWithRecords = stores.filter((s) => s.records && s.records.length > 0);

      if (storesWithRecords.length === 0) {
        resolve(db);
        return;
      }

      const storeNames = storesWithRecords.map((s) => s.name);
      const tx = db.transaction(storeNames, 'readwrite');

      for (const descriptor of storesWithRecords) {
        const store = tx.objectStore(descriptor.name);
        for (const record of descriptor.records!) {
          if (descriptor.keyPath === null || descriptor.keyPath === undefined) {
            // Out-of-line keys: pass key explicitly.
            store.add(record.value, record.key);
          } else {
            store.add(record.value);
          }
        }
      }

      tx.oncomplete = () => {
        resolve(db);
      };

      tx.onerror = () => {
        reject(new Error(`Failed to seed database "${dbName}": ${String(tx.error)}`));
      };
    };

    request.onerror = () => {
      reject(new Error(`Failed to open database "${dbName}": ${String(request.error)}`));
    };
  });
}

/**
 * Open a database and read every record from a single object store.
 *
 * @returns An array of `{ key, value }` pairs with raw (deserialized) values.
 */
export function readAllFromStore(
  dbName: string,
  storeName: string,
): Promise<Array<{ key: IDBValidKey; value: unknown }>> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);

    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);
      const cursorReq = store.openCursor();
      const results: Array<{ key: IDBValidKey; value: unknown }> = [];

      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          results.push({ key: cursor.primaryKey, value: cursor.value });
          cursor.continue();
        } else {
          db.close();
          resolve(results);
        }
      };

      cursorReq.onerror = () => {
        db.close();
        reject(new Error(`Failed to read from "${storeName}": ${String(cursorReq.error)}`));
      };
    };

    request.onerror = () => {
      reject(new Error(`Failed to open database "${dbName}": ${String(request.error)}`));
    };
  });
}

/**
 * Register `beforeEach` / `afterEach` hooks that reset the fake IndexedDB
 * state between tests.
 *
 * Call once at the top of each test file that interacts with IndexedDB.
 */
export function setupFakeIDB(): void {
  beforeEach(() => {
    // Reset the counter so each test suite starts fresh.
    dbCounter = 0;
  });

  afterEach(async () => {
    // Delete every database created during the test.
    for (const name of createdDatabases) {
      await new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve();
        req.onerror = () => resolve(); // Best-effort cleanup.
        req.onblocked = () => resolve(); // Avoid hanging cleanup.
      });
    }
    createdDatabases.length = 0;
  });
}
