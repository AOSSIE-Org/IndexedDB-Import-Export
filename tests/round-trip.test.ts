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

  it('round-trip preserves Set, Map, RegExp, ArrayBuffer, and typed array values', async () => {
    const sourceDB = uniqueDBName('rt-clone-src');
    const targetDB = uniqueDBName('rt-clone-tgt');

    const original = {
      id: 'rec1',
      tags: new Set(['a', 'b']),
      scores: new Map<string, bigint>([['alice', 10n]]),
      pattern: /^id-\d+$/i,
      raw: new Uint8Array([1, 2, 3]).buffer,
      samples: new Float32Array([0.5, 1.5]),
    };

    const db = await createTestDB(sourceDB, 1, [
      { name: 'clones', keyPath: 'id', records: [{ value: original }] },
    ]);
    db.close();

    // Go through JSON text, as a real backup file would.
    const backup = JSON.parse(JSON.stringify(await exportDB({ dbName: sourceDB })));
    await importDB({ dbName: targetDB, backupData: backup, strategy: 'overwrite' });

    const records = await readAllFromStore(targetDB, 'clones');
    const value = records[0]!.value as typeof original;
    expect(value.tags).toEqual(original.tags);
    expect(value.scores).toEqual(original.scores);
    expect(value.pattern).toEqual(original.pattern);
    expect(value.raw).toBeInstanceOf(ArrayBuffer);
    expect(new Uint8Array(value.raw)).toEqual(new Uint8Array([1, 2, 3]));
    expect(value.samples).toEqual(original.samples);
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

  it('exportDB → JSON stringify/parse → importDB preserves circular references in records', async () => {
    const sourceDB = uniqueDBName('rt-cycle-src');
    const targetDB = uniqueDBName('rt-cycle-tgt');

    // Create cyclic structures
    const cyclicObj: Record<string, unknown> = { id: 1, name: 'cyclic-node' };
    cyclicObj.self = cyclicObj;

    const cyclicArr: unknown[] = ['start'];
    cyclicArr.push(cyclicArr);

    const cyclicSet = new Set<unknown>();
    cyclicSet.add(cyclicSet);

    const cyclicMap = new Map<unknown, unknown>();
    cyclicMap.set(cyclicMap, cyclicMap);

    const db = await createTestDB(sourceDB, 1, [
      {
        name: 'cycles',
        keyPath: 'id',
        records: [
          {
            value: {
              id: 'rec1',
              obj: cyclicObj,
              arr: cyclicArr,
              set: cyclicSet,
              map: cyclicMap,
            },
          },
        ],
      },
    ]);
    db.close();

    // Export -> serialize to JSON text -> parse JSON text -> import
    const exported = await exportDB({ dbName: sourceDB });
    const jsonString = JSON.stringify(exported);
    const parsedBackup = JSON.parse(jsonString);

    await importDB({
      dbName: targetDB,
      backupData: parsedBackup,
      strategy: 'overwrite',
    });

    const records = await readAllFromStore(targetDB, 'cycles');
    expect(records).toHaveLength(1);

    const restored = records[0]!.value as {
      id: string;
      obj: Record<string, unknown>;
      arr: unknown[];
      set: Set<unknown>;
      map: Map<unknown, unknown>;
    };

    // Verify cyclic plain object
    expect(restored.obj.name).toBe('cyclic-node');
    expect(restored.obj.self).toBe(restored.obj);

    // Verify cyclic array
    expect(restored.arr[0]).toBe('start');
    expect(restored.arr[1]).toBe(restored.arr);

    // Verify cyclic Set
    expect(restored.set).toBeInstanceOf(Set);
    expect(restored.set.has(restored.set)).toBe(true);

    // Verify cyclic Map
    expect(restored.map).toBeInstanceOf(Map);
    expect(restored.map.get(restored.map)).toBe(restored.map);

    // Re-exporting from target should produce identical structure
    const reExport = await exportDB({ dbName: targetDB });
    expect(reExport.stores['cycles']).toHaveLength(1);
    expect(reExport.backupVersion).toBe(exported.backupVersion);
  });

  it('exportDB → JSON stringify/parse → importDB preserves shared references across record fields', async () => {
    const sourceDB = uniqueDBName('rt-shared-src');
    const targetDB = uniqueDBName('rt-shared-tgt');

    const sharedUser = { userId: 'u123', role: 'admin' };
    const sharedConfig = [10, 20, 30];

    const mapWithSharedKeyVal = new Map<unknown, unknown>();
    mapWithSharedKeyVal.set(sharedUser, sharedUser);

    const db = await createTestDB(sourceDB, 1, [
      {
        name: 'sharedStore',
        keyPath: 'id',
        records: [
          {
            value: {
              id: 'doc1',
              author: sharedUser,
              editor: sharedUser,
              configA: sharedConfig,
              configB: sharedConfig,
              userMap: mapWithSharedKeyVal,
            },
          },
        ],
      },
    ]);
    db.close();

    const exported = await exportDB({ dbName: sourceDB });
    const jsonString = JSON.stringify(exported);
    const parsedBackup = JSON.parse(jsonString);

    await importDB({
      dbName: targetDB,
      backupData: parsedBackup,
      strategy: 'overwrite',
    });

    const records = await readAllFromStore(targetDB, 'sharedStore');
    expect(records).toHaveLength(1);

    const doc = records[0]!.value as {
      id: string;
      author: typeof sharedUser;
      editor: typeof sharedUser;
      configA: number[];
      configB: number[];
      userMap: Map<unknown, unknown>;
    };

    // Shared plain object identity preserved
    expect(doc.author).toBe(doc.editor);
    expect(doc.author.userId).toBe('u123');

    // Shared array identity preserved
    expect(doc.configA).toBe(doc.configB);
    expect(doc.configA).toEqual([10, 20, 30]);

    // Map key and value identity preserved
    const mapKeys = [...doc.userMap.keys()];
    const mapValues = [...doc.userMap.values()];
    expect(mapKeys[0]).toBe(doc.author);
    expect(mapValues[0]).toBe(doc.author);
    expect(mapKeys[0]).toBe(mapValues[0]);
    expect(doc.userMap.get(mapKeys[0])).toBe(mapKeys[0]);
  });
});
