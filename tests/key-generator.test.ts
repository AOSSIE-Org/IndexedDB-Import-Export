import { describe, it, expect } from 'vitest';
import { exportDB } from '../src/core/exporter.js';
import { importDB } from '../src/core/importer.js';
import type { ExportFormat } from '../src/types/index.js';
import {
  setupFakeIDB,
  uniqueDBName,
  createTestDB,
  readAllFromStore,
} from './helpers/idb-helpers.js';

setupFakeIDB();

function openDB(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Add one record without a key and return the key the generator assigned. */
async function addAndGetKey(
  dbName: string,
  storeName: string,
  value: object,
): Promise<IDBValidKey> {
  const db = await openDB(dbName);
  try {
    return await run(db.transaction(storeName, 'readwrite').objectStore(storeName).add(value));
  } finally {
    db.close();
  }
}

async function deleteKeys(dbName: string, storeName: string, range: IDBKeyRange): Promise<void> {
  const db = await openDB(dbName);
  try {
    await run(db.transaction(storeName, 'readwrite').objectStore(storeName).delete(range));
  } finally {
    db.close();
  }
}

/** Export through JSON, as a real backup file would be. */
async function exportAsJSON(dbName: string): Promise<ExportFormat> {
  return JSON.parse(JSON.stringify(await exportDB({ dbName }))) as ExportFormat;
}

/**
 * Create an autoIncrement store with keys 1..5 whose two newest records were
 * deleted, so its generator is at 6 while its largest key is 3. The unique index
 * checks that the placeholder record never violates an index constraint.
 */
async function createStoreWithDeletedTail(dbName: string, keyPath: string | null): Promise<void> {
  const db = await createTestDB(dbName, 1, [
    {
      name: 'notes',
      keyPath,
      autoIncrement: true,
      indexes: [{ name: 'by-text', keyPath: 'text', unique: true }],
    },
  ]);
  db.close();
  for (let i = 1; i <= 5; i++) {
    await addAndGetKey(dbName, 'notes', { text: `note ${i}` });
  }
  await deleteKeys(dbName, 'notes', IDBKeyRange.bound(4, 5));
}

describe('autoIncrement key generator', () => {
  describe('exportDB', () => {
    it('records the next generated key, which can be above the largest stored key', async () => {
      const dbName = uniqueDBName('kg-export');
      await createStoreWithDeletedTail(dbName, 'id');

      const backup = await exportDB({ dbName });

      expect(backup.schema['notes']!.keyGeneratorNext).toBe(6);
      expect(backup.stores['notes']).toHaveLength(3);
    });

    it('leaves the database unchanged', async () => {
      const dbName = uniqueDBName('kg-unchanged');
      await createStoreWithDeletedTail(dbName, 'id');

      await exportDB({ dbName });
      await exportDB({ dbName });

      expect(await readAllFromStore(dbName, 'notes')).toHaveLength(3);
      // The probe was rolled back, so the generator did not move.
      expect(await addAndGetKey(dbName, 'notes', { text: 'after export' })).toBe(6);
    });

    it('omits keyGeneratorNext for stores without autoIncrement', async () => {
      const dbName = uniqueDBName('kg-plain');
      const db = await createTestDB(dbName, 1, [
        { name: 'users', keyPath: 'id', records: [{ value: { id: 1 } }] },
      ]);
      db.close();

      const backup = await exportDB({ dbName });

      expect(backup.schema['users']).not.toHaveProperty('keyGeneratorNext');
    });
  });

  describe('importDB', () => {
    for (const keyPath of ['id', 'meta.id', null]) {
      it(`does not reuse keys of deleted records (keyPath: ${String(keyPath)})`, async () => {
        const source = uniqueDBName('kg-src');
        const target = uniqueDBName('kg-dst');
        await createStoreWithDeletedTail(source, keyPath);

        await importDB({
          dbName: target,
          backupData: await exportAsJSON(source),
          strategy: 'overwrite',
        });

        expect(await readAllFromStore(target, 'notes')).toEqual(
          await readAllFromStore(source, 'notes'),
        );
        expect(await addAndGetKey(target, 'notes', { text: 'new' })).toBe(6);
      });
    }

    it('does not replace a record that already uses the placeholder key', async () => {
      const source = uniqueDBName('kg-keep-src');
      const target = uniqueDBName('kg-keep-dst');
      const db = await createTestDB(source, 1, [
        { name: 'notes', keyPath: 'id', autoIncrement: true },
      ]);
      db.close();
      for (let i = 1; i <= 3; i++) {
        await addAndGetKey(source, 'notes', { text: `note ${i}` });
      }

      const backup = await exportAsJSON(source);
      expect(backup.schema['notes']!.keyGeneratorNext).toBe(4);
      await importDB({ dbName: target, backupData: backup, strategy: 'overwrite' });

      expect(await readAllFromStore(target, 'notes')).toEqual(
        await readAllFromStore(source, 'notes'),
      );
      expect(await addAndGetKey(target, 'notes', { text: 'new' })).toBe(4);
    });

    it('never moves a generator that is already further ahead backwards (merge)', async () => {
      const source = uniqueDBName('kg-merge-src');
      const target = uniqueDBName('kg-merge-dst');
      await createStoreWithDeletedTail(source, 'id');
      const backup = await exportAsJSON(source);

      const db = await createTestDB(target, 1, [
        { name: 'notes', keyPath: 'id', autoIncrement: true },
      ]);
      db.close();
      for (let i = 1; i <= 10; i++) {
        await addAndGetKey(target, 'notes', { text: `existing ${i}` });
      }

      await importDB({ dbName: target, backupData: backup, strategy: 'merge' });

      expect(await addAndGetKey(target, 'notes', { text: 'new' })).toBe(11);
      const records = await readAllFromStore(target, 'notes');
      expect(records.map((r) => r.key)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    });

    it('raises the generator of an existing store that is behind (merge)', async () => {
      const source = uniqueDBName('kg-merge-behind-src');
      const target = uniqueDBName('kg-merge-behind-dst');
      await createStoreWithDeletedTail(source, 'id');
      const backup = await exportAsJSON(source);
      const db = await createTestDB(target, 1, [
        { name: 'notes', keyPath: 'id', autoIncrement: true },
      ]);
      db.close();

      await importDB({ dbName: target, backupData: backup, strategy: 'merge' });

      expect(await readAllFromStore(target, 'notes')).toHaveLength(3);
      expect(await addAndGetKey(target, 'notes', { text: 'new' })).toBe(6);
    });

    it('still imports backups made before keyGeneratorNext existed', async () => {
      const source = uniqueDBName('kg-old-src');
      const target = uniqueDBName('kg-old-dst');
      await createStoreWithDeletedTail(source, 'id');
      const backup = await exportAsJSON(source);
      delete backup.schema['notes']!.keyGeneratorNext;

      await importDB({ dbName: target, backupData: backup, strategy: 'overwrite' });

      expect(await readAllFromStore(target, 'notes')).toHaveLength(3);
      // Previous behavior: the generator is rebuilt from the largest stored key.
      expect(await addAndGetKey(target, 'notes', { text: 'new' })).toBe(4);
    });

    for (const invalid of [0, -1, 1.5, '6', Number.MAX_SAFE_INTEGER + 1]) {
      it(`rejects keyGeneratorNext ${JSON.stringify(invalid)} before touching the database`, async () => {
        const source = uniqueDBName('kg-invalid-src');
        const target = uniqueDBName('kg-invalid-dst');
        await createStoreWithDeletedTail(source, 'id');
        await createStoreWithDeletedTail(target, 'id');
        const backup = await exportAsJSON(source);
        (backup.schema['notes'] as { keyGeneratorNext?: unknown }).keyGeneratorNext = invalid;

        await expect(
          importDB({ dbName: target, backupData: backup, strategy: 'overwrite' }),
        ).rejects.toThrow(/Invalid keyGeneratorNext for store "notes"/);
        expect(await readAllFromStore(target, 'notes')).toHaveLength(3);
      });
    }
  });
});
