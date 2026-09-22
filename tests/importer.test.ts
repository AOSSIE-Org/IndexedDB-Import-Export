import { describe, it, expect, vi } from 'vitest';
import { importDB } from '../src/core/importer.js';
import type { ExportFormat, ImportSummary } from '../src/types/index.js';
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

  // ─── Selective restore via `storeNames` ────────────────────────────

  /** Open a database and report its version and store names. */
  async function describeDB(dbName: string): Promise<{ version: number; stores: string[] }> {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(dbName);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const described = { version: db.version, stores: Array.from(db.objectStoreNames).sort() };
    db.close();
    return described;
  }

  /**
   * Backup with one store of durable user data and two derived cache
   * stores — the shape the `storeNames` option exists to serve.
   */
  function buildSelectiveBackup(): ExportFormat {
    return buildBackup({
      databaseVersion: 1,
      schema: {
        users: { keyPath: 'id', autoIncrement: false, indexes: [] },
        cache: { keyPath: 'id', autoIncrement: false, indexes: [] },
        logs: { keyPath: 'id', autoIncrement: false, indexes: [] },
      },
      stores: {
        users: [
          { key: 1, value: { id: 1, name: 'Alice' } },
          { key: 2, value: { id: 2, name: 'Bob' } },
        ],
        cache: [{ key: 'c1', value: { id: 'c1', stale: true } }],
        logs: [{ key: 'l1', value: { id: 'l1', line: 'boot' } }],
      },
    });
  }

  it('"merge" with storeNames does not create the excluded stores', async () => {
    const dbName = uniqueDBName('selective-merge-no-create');

    // The database holds only the user-data store; the cache stores are absent.
    const db = await createTestDB(dbName, 1, [
      { name: 'users', keyPath: 'id', records: [{ value: { id: 1, name: 'Stale' } }] },
    ]);
    db.close();

    await importDB({
      dbName,
      backupData: buildSelectiveBackup(),
      strategy: 'merge',
      storeNames: ['users'],
    });

    // The excluded stores stay absent, and their absence does not bump the version.
    expect(await describeDB(dbName)).toEqual({ version: 1, stores: ['users'] });

    const users = await readAllFromStore(dbName, 'users');
    expect(users).toHaveLength(2);
    expect(users.map((r) => r.value)).toContainEqual({ id: 1, name: 'Alice' });
  });

  it('"merge" with storeNames leaves excluded stores that already exist untouched', async () => {
    const dbName = uniqueDBName('selective-merge');

    const db = await createTestDB(dbName, 1, [
      { name: 'users', keyPath: 'id', records: [{ value: { id: 1, name: 'Stale' } }] },
      { name: 'cache', keyPath: 'id', records: [{ value: { id: 'c1', stale: false } }] },
      { name: 'logs', keyPath: 'id', records: [] },
    ]);
    db.close();

    await importDB({
      dbName,
      backupData: buildSelectiveBackup(),
      strategy: 'merge',
      storeNames: ['users'],
    });

    // `users` is upserted from the backup...
    const users = await readAllFromStore(dbName, 'users');
    expect(users).toHaveLength(2);
    expect(users.map((r) => r.value)).toContainEqual({ id: 1, name: 'Alice' });

    // ...while the excluded stores keep exactly what they already had.
    const cache = await readAllFromStore(dbName, 'cache');
    expect(cache).toHaveLength(1);
    expect(cache[0]!.value).toEqual({ id: 'c1', stale: false });
    expect(await readAllFromStore(dbName, 'logs')).toHaveLength(0);
  });

  it('"overwrite" with storeNames recreates only the listed stores', async () => {
    const dbName = uniqueDBName('selective-overwrite');

    await importDB({
      dbName,
      backupData: buildSelectiveBackup(),
      strategy: 'overwrite',
      storeNames: ['users'],
    });

    // Overwrite rebuilds the database from the selected subset alone.
    expect(await describeDB(dbName)).toEqual({ version: 1, stores: ['users'] });
    expect(await readAllFromStore(dbName, 'users')).toHaveLength(2);
  });

  it('storeNames is equivalent to importing a pre-filtered backup envelope', async () => {
    const viaOption = uniqueDBName('selective-equivalence-option');
    const viaEnvelope = uniqueDBName('selective-equivalence-envelope');
    const full = buildSelectiveBackup();

    await importDB({
      dbName: viaOption,
      backupData: full,
      strategy: 'overwrite',
      storeNames: ['users', 'logs'],
    });

    // The envelope-reaching workaround the option is meant to replace.
    await importDB({
      dbName: viaEnvelope,
      strategy: 'overwrite',
      backupData: {
        ...full,
        schema: { users: full.schema.users!, logs: full.schema.logs! },
        stores: { users: full.stores.users!, logs: full.stores.logs! },
      },
    });

    expect(await describeDB(viaOption)).toEqual(await describeDB(viaEnvelope));
    expect(await readAllFromStore(viaOption, 'users')).toEqual(
      await readAllFromStore(viaEnvelope, 'users'),
    );
    expect(await readAllFromStore(viaOption, 'logs')).toEqual(
      await readAllFromStore(viaEnvelope, 'logs'),
    );
  });

  it('omitting storeNames restores every store in the backup', async () => {
    const dbName = uniqueDBName('selective-omitted');

    await importDB({
      dbName,
      backupData: buildSelectiveBackup(),
      strategy: 'overwrite',
    });

    expect(await describeDB(dbName)).toEqual({ version: 1, stores: ['cache', 'logs', 'users'] });
    expect(await readAllFromStore(dbName, 'users')).toHaveLength(2);
    expect(await readAllFromStore(dbName, 'cache')).toHaveLength(1);
    expect(await readAllFromStore(dbName, 'logs')).toHaveLength(1);
  });

  it('"overwrite" with an empty storeNames array yields an empty database', async () => {
    const dbName = uniqueDBName('selective-empty-overwrite');

    await importDB({
      dbName,
      backupData: buildSelectiveBackup(),
      strategy: 'overwrite',
      storeNames: [],
    });

    expect(await describeDB(dbName)).toEqual({ version: 1, stores: [] });
  });

  it('"merge" with an empty storeNames array changes nothing', async () => {
    const dbName = uniqueDBName('selective-empty-merge');

    const db = await createTestDB(dbName, 1, [
      { name: 'users', keyPath: 'id', records: [{ value: { id: 1, name: 'Stale' } }] },
      { name: 'cache', keyPath: 'id', records: [{ value: { id: 'c1', stale: false } }] },
    ]);
    db.close();

    await importDB({
      dbName,
      backupData: buildSelectiveBackup(),
      strategy: 'merge',
      storeNames: [],
    });

    // Nothing is selected, so no store is created — `logs` stays absent — and the
    // version is not bumped.
    expect(await describeDB(dbName)).toEqual({ version: 1, stores: ['cache', 'users'] });

    // Existing records are left exactly as they were.
    const users = await readAllFromStore(dbName, 'users');
    expect(users).toHaveLength(1);
    expect(users[0]!.value).toEqual({ id: 1, name: 'Stale' });

    const cache = await readAllFromStore(dbName, 'cache');
    expect(cache).toHaveLength(1);
    expect(cache[0]!.value).toEqual({ id: 'c1', stale: false });
  });

  it('storeNames entries missing from the backup are ignored', async () => {
    const dbName = uniqueDBName('selective-unknown');

    await importDB({
      dbName,
      backupData: buildSelectiveBackup(),
      strategy: 'overwrite',
      storeNames: ['users', 'not_in_backup'],
    });

    expect(await describeDB(dbName)).toEqual({ version: 1, stores: ['users'] });
    expect(await readAllFromStore(dbName, 'users')).toHaveLength(2);
  });

  it('storeNames listing only unknown stores restores nothing and does not throw', async () => {
    const dbName = uniqueDBName('selective-all-unknown');

    await expect(
      importDB({
        dbName,
        backupData: buildSelectiveBackup(),
        strategy: 'overwrite',
        storeNames: ['not_in_backup'],
      }),
    ).resolves.toBeUndefined();

    expect(await describeDB(dbName)).toEqual({ version: 1, stores: [] });
  });

  it('duplicate storeNames entries do not insert records twice', async () => {
    const dbName = uniqueDBName('selective-duplicates');

    // `overwrite` inserts with `add()`, so a double pass would fail with a
    // ConstraintError rather than silently duplicating.
    await importDB({
      dbName,
      backupData: buildSelectiveBackup(),
      strategy: 'overwrite',
      storeNames: ['users', 'users'],
    });

    expect(await readAllFromStore(dbName, 'users')).toHaveLength(2);
  });
});

describe('importDB — onBeforeImport hook', () => {
  it('imports normally when no hook is provided', async () => {
    const dbName = uniqueDBName('hook-absent');

    const backup = buildBackup({
      databaseVersion: 1,
      schema: {
        users: { keyPath: 'id', autoIncrement: false, indexes: [] },
      },
      stores: {
        users: [{ key: 1, value: { id: 1, name: 'Alice' } }],
      },
    });

    await importDB({ dbName, backupData: backup, strategy: 'overwrite' });

    const records = await readAllFromStore(dbName, 'users');
    expect(records).toHaveLength(1);
    expect(records[0]!.value).toEqual({ id: 1, name: 'Alice' });
  });

  it('proceeds with the import when the hook returns true', async () => {
    const dbName = uniqueDBName('hook-true');

    const backup = buildBackup({
      databaseVersion: 1,
      schema: {
        users: { keyPath: 'id', autoIncrement: false, indexes: [] },
      },
      stores: {
        users: [{ key: 1, value: { id: 1, name: 'Alice' } }],
      },
    });

    const onBeforeImport = vi.fn(() => true);

    await importDB({ dbName, backupData: backup, strategy: 'overwrite', onBeforeImport });

    expect(onBeforeImport).toHaveBeenCalledTimes(1);
    const records = await readAllFromStore(dbName, 'users');
    expect(records).toHaveLength(1);
    expect(records[0]!.value).toEqual({ id: 1, name: 'Alice' });
  });

  it('aborts without writing or deleting when the hook returns false', async () => {
    const dbName = uniqueDBName('hook-false');

    // Pre-populate the database so we can prove the overwrite delete never ran.
    const db = await createTestDB(dbName, 1, [
      {
        name: 'items',
        keyPath: 'id',
        records: [
          { value: { id: 1, name: 'Original1' } },
          { value: { id: 2, name: 'Original2' } },
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
        items: [{ key: 99, value: { id: 99, name: 'ShouldNotAppear' } }],
      },
    });

    const onBeforeImport = vi.fn(() => false);

    await importDB({ dbName, backupData: backup, strategy: 'overwrite', onBeforeImport });

    expect(onBeforeImport).toHaveBeenCalledTimes(1);

    // The original database and its data must be untouched.
    const records = await readAllFromStore(dbName, 'items');
    expect(records).toHaveLength(2);
    expect(records.map((r) => r.value)).toContainEqual({ id: 1, name: 'Original1' });
    expect(records.map((r) => r.value)).toContainEqual({ id: 2, name: 'Original2' });
  });

  it('aborts when the hook returns a promise resolving to false', async () => {
    const dbName = uniqueDBName('hook-async-false');

    const db = await createTestDB(dbName, 1, [
      {
        name: 'items',
        keyPath: 'id',
        records: [{ value: { id: 1, name: 'Original' } }],
      },
    ]);
    db.close();

    const backup = buildBackup({
      databaseVersion: 2,
      schema: {
        items: { keyPath: 'id', autoIncrement: false, indexes: [] },
      },
      stores: {
        items: [{ key: 99, value: { id: 99, name: 'ShouldNotAppear' } }],
      },
    });

    const onBeforeImport = vi.fn(() => Promise.resolve(false));

    await importDB({ dbName, backupData: backup, strategy: 'overwrite', onBeforeImport });

    expect(onBeforeImport).toHaveBeenCalledTimes(1);
    const records = await readAllFromStore(dbName, 'items');
    expect(records).toHaveLength(1);
    expect(records[0]!.value).toEqual({ id: 1, name: 'Original' });
  });

  it('receives a summary matching the backup contents', async () => {
    const dbName = uniqueDBName('hook-summary');

    const exportedAt = '2026-02-01T09:30:00.000Z';
    const backup = buildBackup({
      backupVersion: 1,
      databaseName: 'FatePoolsDB',
      databaseVersion: 3,
      exportedAt,
      schema: {
        portfolioPositions: { keyPath: 'id', autoIncrement: false, indexes: [] },
        portfolioTransactions: { keyPath: 'id', autoIncrement: false, indexes: [] },
      },
      stores: {
        portfolioPositions: [
          { key: 1, value: { id: 1 } },
          { key: 2, value: { id: 2 } },
        ],
        portfolioTransactions: [{ key: 1, value: { id: 1 } }],
      },
    });

    let captured: ImportSummary | undefined;
    const onBeforeImport = vi.fn((summary: ImportSummary) => {
      captured = summary;
      return true;
    });

    await importDB({ dbName, backupData: backup, strategy: 'overwrite', onBeforeImport });

    expect(captured).toBeDefined();
    expect(captured!.storeNames).toEqual(['portfolioPositions', 'portfolioTransactions']);
    expect(captured!.recordCounts).toEqual({
      portfolioPositions: 2,
      portfolioTransactions: 1,
    });
    expect(captured!.backupVersion).toBe(1);
    expect(captured!.databaseName).toBe('FatePoolsDB');
    expect(captured!.exportedAt).toBe(exportedAt);
  });

  it('summary reflects the storeNames selection, not the whole backup', async () => {
    const dbName = uniqueDBName('hook-summary-selective');

    const backup = buildBackup({
      databaseVersion: 1,
      schema: {
        users: { keyPath: 'id', autoIncrement: false, indexes: [] },
        cache: { keyPath: 'id', autoIncrement: false, indexes: [] },
      },
      stores: {
        users: [
          { key: 1, value: { id: 1 } },
          { key: 2, value: { id: 2 } },
        ],
        cache: [{ key: 'c1', value: { id: 'c1' } }],
      },
    });

    let captured: ImportSummary | undefined;
    const onBeforeImport = vi.fn((summary: ImportSummary) => {
      captured = summary;
      return true;
    });

    await importDB({
      dbName,
      backupData: backup,
      strategy: 'overwrite',
      storeNames: ['users'],
      onBeforeImport,
    });

    expect(captured!.storeNames).toEqual(['users']);
    expect(captured!.recordCounts).toEqual({ users: 2 });
  });

  it('propagates the error and writes nothing when the hook throws', async () => {
    const dbName = uniqueDBName('hook-throws');

    const db = await createTestDB(dbName, 1, [
      {
        name: 'items',
        keyPath: 'id',
        records: [{ value: { id: 1, name: 'Original' } }],
      },
    ]);
    db.close();

    const backup = buildBackup({
      databaseVersion: 2,
      schema: {
        items: { keyPath: 'id', autoIncrement: false, indexes: [] },
      },
      stores: {
        items: [{ key: 99, value: { id: 99, name: 'ShouldNotAppear' } }],
      },
    });

    const onBeforeImport = () => {
      throw new Error('rejected by caller');
    };

    await expect(
      importDB({ dbName, backupData: backup, strategy: 'overwrite', onBeforeImport })
    ).rejects.toThrow('rejected by caller');

    // The original database and its data must be untouched.
    const records = await readAllFromStore(dbName, 'items');
    expect(records).toHaveLength(1);
    expect(records[0]!.value).toEqual({ id: 1, name: 'Original' });
  });
});
