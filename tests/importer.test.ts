import { describe, it, expect } from 'vitest';
import { importDB } from '../src/core/importer.js';
import type { ExportFormat } from '../src/types/index.js';
import {
  setupFakeIDB,
  uniqueDBName,
  createTestDB,
  readAllFromStore,
} from './helpers/idb-helpers.js';

setupFakeIDB();

/**
 * Build a minimal valid {@link ExportFormat} for testing.
 *
 * Callers can override any field via the `overrides` parameter.
 */
function buildBackup(
  overrides: Partial<ExportFormat> & {
    schema?: ExportFormat['schema'];
    stores?: ExportFormat['stores'];
  } = {},
): ExportFormat {
  return {
    backupVersion: 1,
    databaseName: 'test',
    databaseVersion: 1,
    exportedAt: new Date().toISOString(),
    schema: {},
    stores: {},
    ...overrides,
  };
}

describe('importDB', () => {
  // ─── Happy-path tests ──────────────────────────────────────────────

  it('imports into a fresh (non-existent) database', async () => {
    const dbName = uniqueDBName('fresh');

    const backup = buildBackup({
      databaseVersion: 1,
      schema: {
        users: {
          keyPath: 'id',
          autoIncrement: false,
          indexes: [],
        },
      },
      stores: {
        users: [
          { key: 1, value: { id: 1, name: 'Alice' } },
          { key: 2, value: { id: 2, name: 'Bob' } },
        ],
      },
    });

    await importDB({ dbName, backupData: backup, strategy: 'overwrite' });

    const records = await readAllFromStore(dbName, 'users');
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.value)).toContainEqual({
      id: 1,
      name: 'Alice',
    });
    expect(records.map((r) => r.value)).toContainEqual({
      id: 2,
      name: 'Bob',
    });
  });

  it('"overwrite" strategy clears existing data before import', async () => {
    const dbName = uniqueDBName('overwrite');

    // Pre-populate the database with different records
    const db = await createTestDB(dbName, 1, [
      {
        name: 'items',
        keyPath: 'id',
        records: [
          { value: { id: 1, name: 'OldItem1' } },
          { value: { id: 2, name: 'OldItem2' } },
          { value: { id: 3, name: 'OldItem3' } },
        ],
      },
    ]);
    db.close();

    const backup = buildBackup({
      databaseVersion: 2,
      schema: {
        items: { keyPath: 'id', autoIncrement: false, indexes: [] },
      },
      stores: {
        items: [{ key: 'new-1', value: { id: 'new-1', name: 'NewItem' } }],
      },
    });

    await importDB({ dbName, backupData: backup, strategy: 'overwrite' });

    const records = await readAllFromStore(dbName, 'items');
    expect(records).toHaveLength(1);
    expect(records[0]!.value).toEqual({ id: 'new-1', name: 'NewItem' });
  });

  it('"merge" strategy preserves existing records and adds new ones', async () => {
    const dbName = uniqueDBName('merge-add');

    const db = await createTestDB(dbName, 1, [
      {
        name: 'items',
        keyPath: 'id',
        records: [{ value: { id: 1, name: 'Existing' } }],
      },
    ]);
    db.close();

    const backup = buildBackup({
      databaseVersion: 1,
      schema: {
        items: { keyPath: 'id', autoIncrement: false, indexes: [] },
      },
      stores: {
        items: [{ key: 2, value: { id: 2, name: 'New' } }],
      },
    });

    await importDB({ dbName, backupData: backup, strategy: 'merge' });

    const records = await readAllFromStore(dbName, 'items');
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.value)).toContainEqual({
      id: 1,
      name: 'Existing',
    });
    expect(records.map((r) => r.value)).toContainEqual({
      id: 2,
      name: 'New',
    });
  });

  it('imported records are deserialized correctly (bigint, Date, Uint8Array)', async () => {
    const dbName = uniqueDBName('deserialize');

    const backup = buildBackup({
      databaseVersion: 1,
      schema: {
        data: { keyPath: 'id', autoIncrement: false, indexes: [] },
      },
      stores: {
        data: [
          {
            key: 'rec1',
            value: {
              id: 'rec1',
              amount: { __type: 'bigint', value: '42' },
              createdAt: {
                __type: 'date',
                value: '2026-01-15T12:00:00.000Z',
              },
              payload: { __type: 'u8', value: 'AQID' }, // [1, 2, 3] in base64
            },
          },
        ],
      },
    });

    await importDB({ dbName, backupData: backup, strategy: 'overwrite' });

    const records = await readAllFromStore(dbName, 'data');
    expect(records).toHaveLength(1);

    const value = records[0]!.value as Record<string, unknown>;
    expect(value['amount']).toBe(42n);
    expect(value['createdAt']).toBeInstanceOf(Date);
    expect((value['createdAt'] as Date).toISOString()).toBe('2026-01-15T12:00:00.000Z');
    expect(value['payload']).toBeInstanceOf(Uint8Array);
    expect(value['payload']).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('object stores and indexes are created matching the backup schema', async () => {
    const dbName = uniqueDBName('schema-match');

    const backup = buildBackup({
      databaseVersion: 1,
      schema: {
        products: {
          keyPath: 'sku',
          autoIncrement: false,
          indexes: [
            {
              name: 'by_category',
              keyPath: 'category',
              unique: false,
              multiEntry: false,
            },
            {
              name: 'by_tags',
              keyPath: 'tags',
              unique: false,
              multiEntry: true,
            },
          ],
        },
      },
      stores: {
        products: [],
      },
    });

    await importDB({ dbName, backupData: backup, strategy: 'overwrite' });

    // Open the database and inspect the schema
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    expect(db.objectStoreNames.contains('products')).toBe(true);

    const tx = db.transaction('products', 'readonly');
    const store = tx.objectStore('products');

    expect(store.keyPath).toBe('sku');
    expect(store.autoIncrement).toBe(false);
    expect(store.indexNames.contains('by_category')).toBe(true);
    expect(store.indexNames.contains('by_tags')).toBe(true);

    const categoryIdx = store.index('by_category');
    expect(categoryIdx.unique).toBe(false);
    expect(categoryIdx.multiEntry).toBe(false);

    const tagsIdx = store.index('by_tags');
    expect(tagsIdx.multiEntry).toBe(true);

    tx.abort();
    db.close();
  });

  it('database version is set correctly from the backup', async () => {
    const dbName = uniqueDBName('version');

    const backup = buildBackup({
      databaseVersion: 7,
      schema: {
        store: { keyPath: 'id', autoIncrement: false, indexes: [] },
      },
      stores: {
        store: [],
      },
    });

    await importDB({ dbName, backupData: backup, strategy: 'overwrite' });

    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    expect(db.version).toBe(7);
    db.close();
  });

  // ─── Out-of-line key tests ─────────────────────────────────────────

  it('overwrite with out-of-line key store', async () => {
    const dbName = uniqueDBName('ool-overwrite');

    const backup = buildBackup({
      databaseVersion: 1,
      schema: {
        blobs: { keyPath: null, autoIncrement: false, indexes: [] },
      },
      stores: {
        blobs: [
          { key: 'k1', value: { data: 'hello' } },
          { key: 'k2', value: { data: 'world' } },
        ],
      },
    });

    await importDB({ dbName, backupData: backup, strategy: 'overwrite' });

    const records = await readAllFromStore(dbName, 'blobs');
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.key)).toContain('k1');
    expect(records.map((r) => r.key)).toContain('k2');
  });

  // ─── Merge-specific tests ─────────────────────────────────────────

  it('merge upserts existing records (updates by key)', async () => {
    const dbName = uniqueDBName('merge-upsert');

    const db = await createTestDB(dbName, 1, [
      {
        name: 'items',
        keyPath: 'id',
        records: [{ value: { id: 1, name: 'Original', score: 10 } }],
      },
    ]);
    db.close();

    const backup = buildBackup({
      databaseVersion: 1,
      schema: {
        items: { keyPath: 'id', autoIncrement: false, indexes: [] },
      },
      stores: {
        items: [{ key: 1, value: { id: 1, name: 'Updated', score: 99 } }],
      },
    });

    await importDB({ dbName, backupData: backup, strategy: 'merge' });

    const records = await readAllFromStore(dbName, 'items');
    expect(records).toHaveLength(1);
    expect(records[0]!.value).toEqual({
      id: 1,
      name: 'Updated',
      score: 99,
    });
  });

  it('merge with new stores triggers version bump', async () => {
    const dbName = uniqueDBName('merge-new-store');

    const db = await createTestDB(dbName, 1, [
      {
        name: 'existing',
        keyPath: 'id',
        records: [{ value: { id: 1, data: 'keep' } }],
      },
    ]);
    const originalVersion = db.version;
    db.close();

    const backup = buildBackup({
      databaseVersion: 1,
      schema: {
        existing: { keyPath: 'id', autoIncrement: false, indexes: [] },
        brandNew: { keyPath: 'id', autoIncrement: false, indexes: [] },
      },
      stores: {
        existing: [],
        brandNew: [{ key: 1, value: { id: 1, label: 'new-store-record' } }],
      },
    });

    await importDB({ dbName, backupData: backup, strategy: 'merge' });

    const dbAfter = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    expect(dbAfter.version).toBe(originalVersion + 1);
    expect(dbAfter.objectStoreNames.contains('brandNew')).toBe(true);

    dbAfter.close();

    // Verify the new store has the imported record
    const newRecords = await readAllFromStore(dbName, 'brandNew');
    expect(newRecords).toHaveLength(1);
    expect(newRecords[0]!.value).toEqual({
      id: 1,
      label: 'new-store-record',
    });

    // Verify existing store data is preserved
    const existingRecords = await readAllFromStore(dbName, 'existing');
    expect(existingRecords).toHaveLength(1);
    expect(existingRecords[0]!.value).toEqual({ id: 1, data: 'keep' });
  });

  it('merge with no new stores keeps same version', async () => {
    const dbName = uniqueDBName('merge-same-ver');

    const db = await createTestDB(dbName, 1, [
      {
        name: 'items',
        keyPath: 'id',
        records: [{ value: { id: 1, name: 'A' } }],
      },
    ]);
    db.close();

    const backup = buildBackup({
      databaseVersion: 1,
      schema: {
        items: { keyPath: 'id', autoIncrement: false, indexes: [] },
      },
      stores: {
        items: [{ key: 2, value: { id: 2, name: 'B' } }],
      },
    });

    await importDB({ dbName, backupData: backup, strategy: 'merge' });

    const dbAfter = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    expect(dbAfter.version).toBe(1);
    dbAfter.close();
  });

  // ─── Edge cases ────────────────────────────────────────────────────

  it('importing backup with empty stores is a no-op', async () => {
    const dbName = uniqueDBName('empty-stores');

    const db = await createTestDB(dbName, 1, [
      {
        name: 'items',
        keyPath: 'id',
        records: [{ value: { id: 1, name: 'Unchanged' } }],
      },
    ]);
    db.close();

    const backup = buildBackup({
      databaseVersion: 1,
      schema: {
        items: { keyPath: 'id', autoIncrement: false, indexes: [] },
      },
      stores: {},
    });

    await importDB({ dbName, backupData: backup, strategy: 'merge' });

    const records = await readAllFromStore(dbName, 'items');
    expect(records).toHaveLength(1);
    expect(records[0]!.value).toEqual({ id: 1, name: 'Unchanged' });
  });

  it('overwrite correctly recreates stores from schema', async () => {
    const dbName = uniqueDBName('overwrite-recreate');

    // Create a database with a specific schema
    const db = await createTestDB(dbName, 1, [
      {
        name: 'old_store',
        keyPath: 'id',
        records: [{ value: { id: 1, name: 'old' } }],
      },
    ]);
    db.close();

    // Overwrite with a completely different schema
    const backup = buildBackup({
      databaseVersion: 2,
      schema: {
        new_store: {
          keyPath: 'key',
          autoIncrement: true,
          indexes: [
            {
              name: 'by_label',
              keyPath: 'label',
              unique: true,
              multiEntry: false,
            },
          ],
        },
      },
      stores: {
        new_store: [{ key: 1, value: { key: 1, label: 'fresh' } }],
      },
    });

    await importDB({ dbName, backupData: backup, strategy: 'overwrite' });

    const dbAfter = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });

    // Old store should be gone, new store should exist
    expect(dbAfter.objectStoreNames.contains('old_store')).toBe(false);
    expect(dbAfter.objectStoreNames.contains('new_store')).toBe(true);
    dbAfter.close();

    const records = await readAllFromStore(dbName, 'new_store');
    expect(records).toHaveLength(1);
    expect(records[0]!.value).toEqual({ key: 1, label: 'fresh' });
  });

  it('handles backup with multiple stores and mixed key types', async () => {
    const dbName = uniqueDBName('mixed-keys');

    const backup = buildBackup({
      databaseVersion: 1,
      schema: {
        inline: { keyPath: 'id', autoIncrement: false, indexes: [] },
        outline: { keyPath: null, autoIncrement: false, indexes: [] },
        autoInc: { keyPath: 'id', autoIncrement: true, indexes: [] },
      },
      stores: {
        inline: [{ key: 'a', value: { id: 'a', data: 1 } }],
        outline: [{ key: 'ext-key', value: { data: 2 } }],
        autoInc: [{ key: 1, value: { id: 1, data: 3 } }],
      },
    });

    await importDB({ dbName, backupData: backup, strategy: 'overwrite' });

    const inlineRecords = await readAllFromStore(dbName, 'inline');
    expect(inlineRecords).toHaveLength(1);

    const outlineRecords = await readAllFromStore(dbName, 'outline');
    expect(outlineRecords).toHaveLength(1);
    expect(outlineRecords[0]!.key).toBe('ext-key');

    const autoIncRecords = await readAllFromStore(dbName, 'autoInc');
    expect(autoIncRecords).toHaveLength(1);
  });
});
