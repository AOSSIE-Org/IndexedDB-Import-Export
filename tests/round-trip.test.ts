import { describe, it, expect } from 'vitest';
import { exportDB } from '../src/core/exporter.js';
import { importDB } from '../src/core/importer.js';
import {
  setupFakeIDB,
  uniqueDBName,
  createTestDB,
  readAllFromStore,
} from './helpers/idb-helpers.js';

setupFakeIDB();

describe('exportDB → importDB round-trip', () => {
  it('export → overwrite import → re-export produces identical data', async () => {
    const sourceDB = uniqueDBName('rt-source');
    const targetDB = uniqueDBName('rt-target');

    const db = await createTestDB(sourceDB, 1, [
      {
        name: 'users',
        keyPath: 'id',
        records: [
          { value: { id: 1, name: 'Alice', active: true } },
          { value: { id: 2, name: 'Bob', active: false } },
        ],
      },
    ]);
    db.close();

    // Export from source
    const backup = await exportDB({ dbName: sourceDB });

    // Import into target
    await importDB({
      dbName: targetDB,
      backupData: backup,
      strategy: 'overwrite',
    });

    // Re-export from target
    const reExport = await exportDB({ dbName: targetDB });

    // Compare data (ignore dynamic fields)
    expect(reExport.backupVersion).toBe(backup.backupVersion);
    expect(reExport.databaseVersion).toBe(backup.databaseVersion);
    expect(reExport.schema).toEqual(backup.schema);
    expect(reExport.stores).toEqual(backup.stores);
  });

  it('round-trip preserves bigint, Date, and Uint8Array values', async () => {
    const sourceDB = uniqueDBName('rt-types-src');
    const targetDB = uniqueDBName('rt-types-tgt');

    const originalDate = new Date('2026-06-15T10:30:00Z');
    const originalBigint = 123456789012345678901234567890n;
    const originalBytes = new Uint8Array([0xff, 0x00, 0xab, 0xcd]);

    const db = await createTestDB(sourceDB, 1, [
      {
        name: 'typed',
        keyPath: 'id',
        records: [
          {
            value: {
              id: 'rec1',
              amount: originalBigint,
              createdAt: originalDate,
              payload: originalBytes,
            },
          },
        ],
      },
    ]);
    db.close();

    const backup = await exportDB({ dbName: sourceDB });
    await importDB({
      dbName: targetDB,
      backupData: backup,
      strategy: 'overwrite',
    });

    const records = await readAllFromStore(targetDB, 'typed');
    expect(records).toHaveLength(1);

    const value = records[0]!.value as Record<string, unknown>;
    expect(value['amount']).toBe(originalBigint);
    expect(value['createdAt']).toBeInstanceOf(Date);
    expect((value['createdAt'] as Date).getTime()).toBe(originalDate.getTime());
    expect(value['payload']).toBeInstanceOf(Uint8Array);
    expect(value['payload']).toEqual(originalBytes);
  });

  it('round-trip preserves multiple stores with indexes', async () => {
    const sourceDB = uniqueDBName('rt-schema-src');
    const targetDB = uniqueDBName('rt-schema-tgt');

    const db = await createTestDB(sourceDB, 2, [
      {
        name: 'products',
        keyPath: 'sku',
        indexes: [
          { name: 'by_category', keyPath: 'category', unique: false },
          {
            name: 'by_tags',
            keyPath: 'tags',
            unique: false,
            multiEntry: true,
          },
        ],
        records: [
          {
            value: {
              sku: 'ABC-001',
              category: 'electronics',
              tags: ['sale', 'new'],
            },
          },
        ],
      },
      {
        name: 'orders',
        keyPath: 'orderId',
        autoIncrement: true,
        indexes: [{ name: 'by_customer', keyPath: 'customerId', unique: false }],
        records: [{ value: { customerId: 'cust-1', total: 99.99 } }],
      },
    ]);
    db.close();

    const backup = await exportDB({ dbName: sourceDB });
    await importDB({
      dbName: targetDB,
      backupData: backup,
      strategy: 'overwrite',
    });

    // Verify schema via re-export
    const reExport = await exportDB({ dbName: targetDB });

    expect(reExport.schema['products']!.keyPath).toBe('sku');
    expect(reExport.schema['products']!.indexes).toHaveLength(2);
    expect(reExport.schema['products']!.indexes.find((i) => i.name === 'by_tags')!.multiEntry).toBe(
      true,
    );

    expect(reExport.schema['orders']!.autoIncrement).toBe(true);
    expect(reExport.schema['orders']!.indexes).toHaveLength(1);

    // Verify data
    expect(reExport.stores['products']).toHaveLength(1);
    expect(reExport.stores['orders']).toHaveLength(1);
  });

  it('export → merge import into empty DB matches overwrite', async () => {
    const sourceDB = uniqueDBName('rt-merge-src');
    const overwriteDB = uniqueDBName('rt-merge-ow');
    const mergeDB = uniqueDBName('rt-merge-mg');

    const db = await createTestDB(sourceDB, 1, [
      {
        name: 'items',
        keyPath: 'id',
        records: [{ value: { id: 1, name: 'Item1' } }, { value: { id: 2, name: 'Item2' } }],
      },
    ]);
    db.close();

    const backup = await exportDB({ dbName: sourceDB });

    // Import via overwrite into one DB
    await importDB({
      dbName: overwriteDB,
      backupData: backup,
      strategy: 'overwrite',
    });

    // Import via merge into a fresh (empty) DB
    await importDB({
      dbName: mergeDB,
      backupData: backup,
      strategy: 'merge',
    });

    const overwriteRecords = await readAllFromStore(overwriteDB, 'items');
    const mergeRecords = await readAllFromStore(mergeDB, 'items');

    // Same data in both (key + value), order-independent
    const normalize = (records: Array<{ key: unknown; value: unknown }>) =>
      [...records]
        .map((r) => ({ key: r.key, value: r.value }))
        .sort((a, b) => JSON.stringify(a.key).localeCompare(JSON.stringify(b.key)));

    expect(normalize(mergeRecords)).toEqual(normalize(overwriteRecords));
  });
});
