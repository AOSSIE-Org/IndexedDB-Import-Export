import { describe, it, expect } from 'vitest';
import { exportDB } from '../src/core/exporter.js';
import { BACKUP_VERSION } from '../src/serialization/index.js';
import { setupFakeIDB, uniqueDBName, createTestDB } from './helpers/idb-helpers.js';

setupFakeIDB();

describe('exportDB', () => {
  it('exports a single object store with simple records', async () => {
    const dbName = uniqueDBName('single-store');
    const db = await createTestDB(dbName, 1, [
      {
        name: 'users',
        keyPath: 'id',
        records: [{ value: { id: 1, name: 'Alice' } }, { value: { id: 2, name: 'Bob' } }],
      },
    ]);
    db.close();

    const result = await exportDB({ dbName });

    expect(result.stores['users']).toHaveLength(2);

    const values = result.stores['users']!.map((r) => r.value);
    expect(values).toContainEqual({ id: 1, name: 'Alice' });
    expect(values).toContainEqual({ id: 2, name: 'Bob' });
  });

  it('exports multiple stores with selective storeNames filter', async () => {
    const dbName = uniqueDBName('multi-store');
    const db = await createTestDB(dbName, 1, [
      {
        name: 'users',
        keyPath: 'id',
        records: [{ value: { id: 1, name: 'Alice' } }],
      },
      {
        name: 'posts',
        keyPath: 'id',
        records: [{ value: { id: 10, title: 'Hello' } }],
      },
      {
        name: 'comments',
        keyPath: 'id',
        records: [{ value: { id: 100, body: 'Nice' } }],
      },
    ]);
    db.close();

    const result = await exportDB({ dbName, storeNames: ['users', 'posts'] });

    expect(Object.keys(result.stores)).toEqual(expect.arrayContaining(['users', 'posts']));
    expect(Object.keys(result.stores)).not.toContain('comments');
    expect(Object.keys(result.schema)).not.toContain('comments');
  });

  it('matches schema (keyPaths, indexes)', async () => {
    const dbName = uniqueDBName('schema');
    const db = await createTestDB(dbName, 1, [
      {
        name: 'products',
        keyPath: 'sku',
        indexes: [
          { name: 'by_category', keyPath: 'category', unique: false },
          { name: 'by_name', keyPath: 'name', unique: true },
          {
            name: 'by_tags',
            keyPath: 'tags',
            unique: false,
            multiEntry: true,
          },
        ],
      },
    ]);
    db.close();

    const result = await exportDB({ dbName });
    const schema = result.schema['products']!;

    expect(schema.keyPath).toBe('sku');
    expect(schema.autoIncrement).toBe(false);
    expect(schema.indexes).toHaveLength(3);

    const categoryIdx = schema.indexes.find((i) => i.name === 'by_category')!;
    expect(categoryIdx.keyPath).toBe('category');
    expect(categoryIdx.unique).toBe(false);
    expect(categoryIdx.multiEntry).toBe(false);

    const nameIdx = schema.indexes.find((i) => i.name === 'by_name')!;
    expect(nameIdx.unique).toBe(true);

    const tagsIdx = schema.indexes.find((i) => i.name === 'by_tags')!;
    expect(tagsIdx.multiEntry).toBe(true);
  });

  it('serializes bigint/Date/Uint8Array correctly', async () => {
    const dbName = uniqueDBName('special-types');
    const db = await createTestDB(dbName, 1, [
      {
        name: 'data',
        keyPath: 'id',
        records: [
          {
            value: {
              id: 'rec1',
              amount: 999999999999999999n,
              createdAt: new Date('2026-01-15T12:00:00Z'),
              payload: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
            },
          },
        ],
      },
    ]);
    db.close();

    const result = await exportDB({ dbName });
    const record = result.stores['data']![0]!.value as Record<string, unknown>;

    // bigint → tagged
    expect(record['amount']).toEqual({
      __type: 'bigint',
      value: '999999999999999999',
    });

    // Date → tagged
    expect(record['createdAt']).toEqual({
      __type: 'date',
      value: '2026-01-15T12:00:00.000Z',
    });

    // Uint8Array → tagged base64
    expect(record['payload']).toEqual({
      __type: 'u8',
      value: expect.any(String),
    });
  });

  it('includes backupVersion/databaseName/databaseVersion/exportedAt', async () => {
    const dbName = uniqueDBName('envelope');
    const db = await createTestDB(dbName, 3, [{ name: 'store', keyPath: 'id' }]);
    db.close();

    const result = await exportDB({ dbName });

    expect(result.backupVersion).toBe(BACKUP_VERSION);
    expect(result.databaseName).toBe(dbName);
    expect(result.databaseVersion).toBe(3);
    expect(result.exportedAt).toBeDefined();
    expect(typeof result.exportedAt).toBe('string');
  });

  it('exports empty databases cleanly', async () => {
    const dbName = uniqueDBName('empty');
    const db = await createTestDB(dbName, 1, [{ name: 'empty_store', keyPath: 'id' }]);
    db.close();

    const result = await exportDB({ dbName });

    expect(result.stores['empty_store']).toEqual([]);
    expect(result.schema['empty_store']).toBeDefined();
  });

  it('exports a store with out-of-line keys', async () => {
    const dbName = uniqueDBName('out-of-line');
    const db = await createTestDB(dbName, 1, [
      {
        name: 'blobs',
        keyPath: null,
        records: [
          { key: 'key-a', value: { data: 'hello' } },
          { key: 'key-b', value: { data: 'world' } },
        ],
      },
    ]);
    db.close();

    const result = await exportDB({ dbName });
    const records = result.stores['blobs']!;

    expect(records).toHaveLength(2);

    // Keys should be serialized alongside values
    const keys = records.map((r) => r.key);
    expect(keys).toContain('key-a');
    expect(keys).toContain('key-b');
  });

  it('exports a store with autoIncrement', async () => {
    const dbName = uniqueDBName('auto-inc');
    const db = await createTestDB(dbName, 1, [
      {
        name: 'logs',
        keyPath: 'id',
        autoIncrement: true,
        records: [{ value: { message: 'first' } }, { value: { message: 'second' } }],
      },
    ]);
    db.close();

    const result = await exportDB({ dbName });

    expect(result.schema['logs']!.autoIncrement).toBe(true);
    expect(result.stores['logs']).toHaveLength(2);
  });

  it('ignores non-existent storeNames in filter', async () => {
    const dbName = uniqueDBName('filter-ignore');
    const db = await createTestDB(dbName, 1, [
      {
        name: 'real',
        keyPath: 'id',
        records: [{ value: { id: 1, name: 'exists' } }],
      },
    ]);
    db.close();

    const result = await exportDB({ dbName, storeNames: ['real', 'fake'] });

    expect(Object.keys(result.stores)).toEqual(['real']);
    expect(Object.keys(result.schema)).toEqual(['real']);
  });

  it('exports with no storeNames → all stores', async () => {
    const dbName = uniqueDBName('all-stores');
    const db = await createTestDB(dbName, 1, [
      {
        name: 'alpha',
        keyPath: 'id',
        records: [{ value: { id: 1 } }],
      },
      {
        name: 'beta',
        keyPath: 'id',
        records: [{ value: { id: 2 } }],
      },
    ]);
    db.close();

    const result = await exportDB({ dbName });

    expect(Object.keys(result.stores)).toEqual(expect.arrayContaining(['alpha', 'beta']));
    expect(Object.keys(result.stores)).toHaveLength(2);
  });

  it('returns empty schema and stores when all storeNames are invalid', async () => {
    const dbName = uniqueDBName('all-invalid');
    const db = await createTestDB(dbName, 1, [{ name: 'real', keyPath: 'id' }]);
    db.close();

    const result = await exportDB({ dbName, storeNames: ['nope', 'nada'] });

    expect(result.schema).toEqual({});
    expect(result.stores).toEqual({});
  });

  it('exportedAt is a valid ISO 8601 timestamp', async () => {
    const dbName = uniqueDBName('iso-ts');
    const db = await createTestDB(dbName, 1, [{ name: 'store', keyPath: 'id' }]);
    db.close();

    const before = new Date();
    const result = await exportDB({ dbName });
    const after = new Date();

    // Validate ISO 8601 format
    const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect(result.exportedAt).toMatch(iso8601Regex);

    // Verify it's a reasonable timestamp (between before and after)
    const exportedDate = new Date(result.exportedAt);
    expect(exportedDate.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(exportedDate.getTime()).toBeLessThanOrEqual(after.getTime());
  });
});
