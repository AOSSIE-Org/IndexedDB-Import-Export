import { describe, it, expect, vi } from 'vitest';
import { serialize, deserialize } from '../src/serialization/index.js';

describe('bigint serialization', () => {
  it('round-trips zero', () => {
    expect(deserialize(serialize(0n))).toBe(0n);
  });

  it('round-trips positive bigint', () => {
    expect(deserialize(serialize(100000n))).toBe(100000n);
  });

  it('round-trips negative bigint', () => {
    expect(deserialize(serialize(-42n))).toBe(-42n);
  });

  it('round-trips very large bigint (18-decimal wei range)', () => {
    const wei = 123456789012345678901234567890n;
    expect(deserialize(serialize(wei))).toBe(wei);
  });

  it('encodes as tagged value with string value', () => {
    expect(serialize(100n)).toEqual({ __type: 'bigint', value: '100' });
  });
});

describe('Date serialization', () => {
  it('round-trips current date preserving the instant', () => {
    const now = new Date();
    const restored = deserialize(serialize(now)) as Date;
    expect(restored).toBeInstanceOf(Date);
    expect(restored.getTime()).toBe(now.getTime());
  });

  it('round-trips epoch (0)', () => {
    expect((deserialize(serialize(new Date(0))) as Date).getTime()).toBe(0);
  });

  it('encodes as tagged value with ISO 8601 string', () => {
    const d = new Date('2026-05-25T10:00:00Z');
    expect(serialize(d)).toEqual({
      __type: 'date',
      value: '2026-05-25T10:00:00.000Z',
    });
  });

  it('throws on invalid Date input', () => {
    expect(() => serialize(new Date('not-a-date'))).toThrow(RangeError);
  });

  it('throws on a malformed date value when deserializing a backup', () => {
    expect(() => deserialize({ __type: 'date', value: 'not-a-date' })).toThrow(RangeError);
  });
});

describe('bigint deserialization (corrupt input)', () => {
  it('throws on a malformed bigint value when deserializing a backup', () => {
    expect(() => deserialize({ __type: 'bigint', value: '7.2' })).toThrow(SyntaxError);
  });
});

describe('nested round-trips', () => {
  it('round-trips bigint inside an object', () => {
    const data = { mint_fee: 100000n, name: 'pool' };
    expect(deserialize(serialize(data))).toEqual(data);
  });

  it('round-trips bigint and Date inside an array', () => {
    const data = [100n, new Date('2026-01-01T00:00:00Z')];
    const restored = deserialize(serialize(data)) as [bigint, Date];
    expect(restored[0]).toBe(100n);
    expect(restored[1].toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('round-trips a Fate-shaped TokenDetails fixture', () => {
    const token = {
      id: '0xabc:bull',
      mint_fee: 1000n,
      burn_fee: 2000n,
      creator_fee: 500n,
      treasury_fee: 100n,
      updatedAt: 1716624000000,
    };
    expect(deserialize(serialize(token))).toEqual(token);
  });

  it('preserves Uint8Array alongside bigint (no regression on #11)', () => {
    const data = { bytes: new Uint8Array([1, 2, 3]), n: 42n };
    const restored = deserialize(serialize(data)) as typeof data;
    expect(restored.bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(restored.n).toBe(42n);
  });

  it('recurses into null-prototype object inputs (isPlainObject fix)', () => {
    // `serialize` emits records via `Object.create(null)`; `deserialize` must
    // still recurse into them and decode nested tags. Without the fix,
    // `isPlainObject` rejects the null-proto object and the tag stays encoded.
    const nullProto: Record<string, unknown> = Object.create(null);
    nullProto['n'] = { __type: 'bigint', value: '7' };
    const restored = deserialize(nullProto) as { n: bigint };
    expect(restored.n).toBe(7n);
  });
});

describe('forward compatibility', () => {
  it('returns an unknown tag unchanged and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unknown = { __type: 'future-type', value: 'x' };
    expect(deserialize(unknown)).toEqual(unknown);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('treats a tagged-like object missing its value field as a plain object', () => {
    const taggedLike: Record<string, unknown> = { __type: 'bigint' };
    expect(deserialize(taggedLike)).toEqual(taggedLike);
  });

  it('recurses into user objects with an unknown tag and a non-string value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const record = { __type: 'note', value: { at: new Date('2026-01-01T00:00:00Z') } };
    const restored = deserialize(serialize(record)) as typeof record;
    expect(restored.value.at).toBeInstanceOf(Date);
    expect(restored.value.at).toEqual(record.value.at);
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('user records with a __type key', () => {
  const roundTrip = (value: unknown) => deserialize(JSON.parse(JSON.stringify(serialize(value))));

  it.each([
    { __type: 'map', value: [['a', 1]] },
    { __type: 'set', value: 'not an array' },
    { __type: 'date', value: '2026-01-01' },
    { __type: 'object', value: { nested: true } },
    { __type: 'u8' },
    { __type: 'ref', value: 1 },
    { __type: 'array', value: [1, 2] },
  ])('round-trips %j unchanged', (record) => {
    expect(roundTrip(record)).toEqual(record);
  });

  it('still decodes tagged values nested inside an escaped record', () => {
    const record = { __type: 'event', value: 5n, at: new Date('2026-01-01T00:00:00Z') };
    expect(roundTrip(record)).toEqual(record);
  });

  it('throws on a malformed escape envelope', () => {
    expect(() => deserialize({ __type: 'object', value: ['x'] })).toThrow(TypeError);
  });
});

describe('Set and Map serialization', () => {
  it('round-trips a Set with nested tagged values', () => {
    const data = new Set<unknown>([1, 'two', 3n, new Date('2026-01-01T00:00:00Z')]);
    const restored = deserialize(serialize(data)) as Set<unknown>;
    expect(restored).toBeInstanceOf(Set);
    expect([...restored]).toEqual([...data]);
  });

  it('round-trips a Map with non-string keys and nested Sets', () => {
    const data = new Map<unknown, unknown>([
      ['a', 1],
      [2n, new Set([1, 2, 3])],
      [new Date('2026-01-01T00:00:00Z'), 'dated'],
    ]);
    const restored = deserialize(serialize(data)) as Map<unknown, unknown>;
    expect(restored).toBeInstanceOf(Map);
    expect([...restored]).toEqual([...data]);
  });

  it('survives a JSON round-trip inside a record', () => {
    const record = { tags: new Set(['x', 'y']), index: new Map([['k', 1n]]) };
    const restored = deserialize(JSON.parse(JSON.stringify(serialize(record)))) as typeof record;
    expect(restored.tags).toEqual(record.tags);
    expect(restored.index).toEqual(record.index);
  });

  it('throws on a malformed Set or Map payload', () => {
    expect(() => deserialize({ __type: 'set', value: { not: 'an array' } })).toThrow(TypeError);
    expect(() => deserialize({ __type: 'map', value: [['only-key']] })).toThrow(TypeError);
  });
});

describe('binary serialization', () => {
  it('round-trips an ArrayBuffer', () => {
    const buffer = new Uint16Array([1, 2, 3]).buffer;
    const restored = deserialize(serialize(buffer)) as ArrayBuffer;
    expect(restored).toBeInstanceOf(ArrayBuffer);
    expect(new Uint16Array(restored)).toEqual(new Uint16Array([1, 2, 3]));
  });

  it('round-trips typed arrays and DataView', () => {
    const data = {
      f32: new Float32Array([1.5, 2.5]),
      u16: new Uint16Array([1, 2, 3]),
      i8: new Int8Array([-1, 0, 1]),
      big: new BigInt64Array([-1n, 2n ** 62n]),
      view: new DataView(new Uint8Array([9, 8, 7]).buffer),
    };
    const restored = deserialize(serialize(data)) as typeof data;
    expect(restored.f32).toEqual(data.f32);
    expect(restored.u16).toEqual(data.u16);
    expect(restored.i8).toEqual(data.i8);
    expect(restored.big).toEqual(data.big);
    expect(restored.view).toBeInstanceOf(DataView);
    expect(restored.view.getUint8(2)).toBe(7);
  });

  it('keeps only the bytes of a view into a larger buffer', () => {
    const view = new Uint16Array(new Uint16Array([10, 20, 30, 40]).buffer, 2, 2);
    const restored = deserialize(serialize(view)) as Uint16Array;
    expect(restored).toEqual(new Uint16Array([20, 30]));
    expect(restored.buffer.byteLength).toBe(4);
  });

  it('records the base type name for typed array subclasses', () => {
    class Samples extends Float64Array {}
    const tagged = serialize(new Samples([0.5])) as { value: { type: string } };
    expect(tagged.value.type).toBe('Float64Array');
    expect(deserialize(tagged)).toEqual(new Float64Array([0.5]));
  });

  it('never constructs a non-allowlisted global named in the backup', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const restored = deserialize({
      __type: 'typed_array',
      value: { type: 'Function', data: 'AQI=' },
    });
    expect(restored).toBeInstanceOf(ArrayBuffer);
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it('throws on a malformed typed array payload', () => {
    expect(() => deserialize({ __type: 'typed_array', value: { type: 'Int8Array' } })).toThrow(
      TypeError,
    );
  });
});

describe('RegExp serialization', () => {
  it('round-trips source and flags', () => {
    const restored = deserialize(serialize(/hel+o\//gi)) as RegExp;
    expect(restored).toBeInstanceOf(RegExp);
    expect(restored.source).toBe('hel+o\\/');
    expect(restored.flags).toBe('gi');
  });

  it('throws on a malformed payload', () => {
    expect(() => deserialize({ __type: 'regex', value: { source: 'a' } })).toThrow(TypeError);
  });
});

describe('circular reference serialization', () => {
  const roundTrip = <T>(value: T): T =>
    deserialize(JSON.parse(JSON.stringify(serialize(value)))) as T;

  it('round-trips a self-referencing array', () => {
    const arr: unknown[] = [];
    arr.push(arr);
    const restored = roundTrip(arr);
    expect(Array.isArray(restored)).toBe(true);
    expect(restored).toHaveLength(1);
    expect(restored[0]).toBe(restored);
  });

  it('round-trips a self-referencing plain object', () => {
    const obj: Record<string, unknown> = { name: 'self' };
    obj.self = obj;
    const restored = roundTrip(obj);
    expect(restored.name).toBe('self');
    expect(restored.self).toBe(restored);
  });

  it('round-trips a self-referencing Set', () => {
    const set = new Set<unknown>();
    set.add(set);
    const restored = roundTrip(set);
    expect(restored).toBeInstanceOf(Set);
    expect(restored.size).toBe(1);
    expect(restored.has(restored)).toBe(true);
  });

  it('round-trips a self-referencing Map', () => {
    const map = new Map<unknown, unknown>();
    map.set(map, map);
    const restored = roundTrip(map);
    expect(restored).toBeInstanceOf(Map);
    expect(restored.size).toBe(1);
    expect(restored.get(restored)).toBe(restored);
  });

  it('round-trips mutual circular references between plain objects', () => {
    interface NodeA {
      name: string;
      b?: NodeB;
    }
    interface NodeB {
      name: string;
      a?: NodeA;
    }
    const a: NodeA = { name: 'nodeA' };
    const b: NodeB = { name: 'nodeB', a };
    a.b = b;

    const restored = roundTrip(a);
    expect(restored.name).toBe('nodeA');
    expect(restored.b?.name).toBe('nodeB');
    expect(restored.b?.a).toBe(restored);
  });

  it('round-trips mutual circular references between arrays', () => {
    const arrA: unknown[] = ['A'];
    const arrB: unknown[] = ['B', arrA];
    arrA.push(arrB);

    const restored = roundTrip(arrA) as [string, [string, unknown[]]];
    expect(restored[0]).toBe('A');
    expect(restored[1][0]).toBe('B');
    expect(restored[1][1]).toBe(restored);
  });

  it('round-trips mutual circular references between Sets', () => {
    const setA = new Set<unknown>(['A']);
    const setB = new Set<unknown>(['B', setA]);
    setA.add(setB);

    const restored = roundTrip(setA);
    expect(restored.has('A')).toBe(true);
    const items = [...restored];
    const restoredB = items.find((x) => x instanceof Set && x.has('B')) as Set<unknown>;
    expect(restoredB).toBeDefined();
    expect(restoredB.has(restored)).toBe(true);
  });

  it('round-trips mutual circular references between Maps', () => {
    const mapA = new Map<string, unknown>([['name', 'A']]);
    const mapB = new Map<string, unknown>([
      ['name', 'B'],
      ['mapA', mapA],
    ]);
    mapA.set('mapB', mapB);

    const restored = roundTrip(mapA);
    expect(restored.get('name')).toBe('A');
    const restoredB = restored.get('mapB') as Map<string, unknown>;
    expect(restoredB.get('name')).toBe('B');
    expect(restoredB.get('mapA')).toBe(restored);
  });

  it('round-trips a ring buffer / cycle of three nodes (A -> B -> C -> A)', () => {
    interface RingNode {
      val: number;
      next?: RingNode;
    }
    const node1: RingNode = { val: 1 };
    const node2: RingNode = { val: 2 };
    const node3: RingNode = { val: 3 };
    node1.next = node2;
    node2.next = node3;
    node3.next = node1;

    const restored = roundTrip(node1);
    expect(restored.val).toBe(1);
    expect(restored.next?.val).toBe(2);
    expect(restored.next?.next?.val).toBe(3);
    expect(restored.next?.next?.next).toBe(restored);
  });

  it('round-trips heterogeneous cycles (object -> array -> Set -> Map -> object)', () => {
    const rootObj: Record<string, unknown> = { label: 'root' };
    const arr: unknown[] = [];
    const set = new Set<unknown>();
    const map = new Map<unknown, unknown>();

    rootObj.list = arr;
    arr.push(set);
    set.add(map);
    map.set('backToRoot', rootObj);

    const restored = roundTrip(rootObj);
    expect(restored.label).toBe('root');
    const restoredArr = restored.list as unknown[];
    const restoredSet = restoredArr[0] as Set<unknown>;
    const restoredMap = [...restoredSet][0] as Map<unknown, unknown>;
    expect(restoredMap.get('backToRoot')).toBe(restored);
  });
});

describe('shared reference and identity preservation', () => {
  const roundTrip = <T>(value: T): T =>
    deserialize(JSON.parse(JSON.stringify(serialize(value)))) as T;

  it('preserves shared object identity in multiple array positions', () => {
    const shared = { id: 1, name: 'shared' };
    const root = [shared, 'middle', shared];

    const restored = roundTrip(root);
    expect(restored[0]).toEqual(shared);
    expect(restored[0]).toBe(restored[2]);
  });

  it('preserves shared object identity across multiple object properties', () => {
    const shared = { count: 42 };
    const root = { a: shared, b: shared, nested: { c: shared } };

    const restored = roundTrip(root);
    expect(restored.a).toBe(restored.b);
    expect(restored.a).toBe(restored.nested.c);
  });

  it('preserves shared identity when the same object is both a Map key and value', () => {
    const shared = { token: 'xyz' };
    const map = new Map<unknown, unknown>();
    map.set(shared, shared);

    const restored = roundTrip(map);
    const keys = [...restored.keys()];
    const values = [...restored.values()];

    expect(keys).toHaveLength(1);
    expect(values).toHaveLength(1);
    expect(keys[0]).toBe(values[0]);
    expect(restored.get(keys[0])).toBe(keys[0]);
  });

  it('preserves shared array identity across multiple containers', () => {
    const sharedArr = [1, 2, 3];
    const root = { x: sharedArr, y: sharedArr, inSet: new Set([sharedArr]) };

    const restored = roundTrip(root);
    expect(restored.x).toBe(restored.y);
    const setArr = [...restored.inSet][0];
    expect(restored.x).toBe(setArr);
  });

  it('preserves shared Set and Map instances', () => {
    const sharedSet = new Set(['alpha', 'beta']);
    const sharedMap = new Map([['k', 'v']]);
    const root = {
      s1: sharedSet,
      s2: sharedSet,
      m1: sharedMap,
      m2: sharedMap,
    };

    const restored = roundTrip(root);
    expect(restored.s1).toBe(restored.s2);
    expect(restored.m1).toBe(restored.m2);
  });

  it('preserves user objects containing their own id field alongside reference id', () => {
    const user = { id: 'user_100', name: 'Alice' };
    const root = { primary: user, backup: user };

    const restored = roundTrip(root);
    expect(restored.primary.id).toBe('user_100');
    expect(restored.primary.name).toBe('Alice');
    expect(restored.primary).toBe(restored.backup);
  });

  it('preserves prototype pollution defenses on restored objects with null prototype', () => {
    const obj: Record<string, unknown> = { normal: 'value' };
    obj.self = obj;

    const restored = roundTrip(obj);
    expect(Object.getPrototypeOf(restored)).toBeNull();
    // Setting __proto__ property does not pollute Object.prototype
    restored['__proto__'] = { polluted: true };
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
  });
});

describe('reference validation and malformed payload defense', () => {
  it('throws on a dangling reference ID', () => {
    expect(() => deserialize({ __type: 'ref', value: 999 })).toThrow(TypeError);
    expect(() => deserialize({ __type: 'ref', value: 999 })).toThrow(/Dangling reference ID/);
  });

  it('throws on duplicate container IDs in backup payload', () => {
    const malformed = [
      { __type: 'object', id: 1, value: { name: 'first' } },
      { __type: 'object', id: 1, value: { name: 'second' } },
    ];
    expect(() => deserialize(malformed)).toThrow(TypeError);
    expect(() => deserialize(malformed)).toThrow(/Duplicate container ID/);
  });

  it('throws on forward reference (reference encountered before definition)', () => {
    const forwardRef = {
      first: { __type: 'ref', value: 1 },
      second: { __type: 'object', id: 1, value: { name: 'late' } },
    };
    expect(() => deserialize(forwardRef)).toThrow(TypeError);
    expect(() => deserialize(forwardRef)).toThrow(/Dangling reference ID/);
  });

  it.each([-1, 0, 1.5, '1', NaN, Infinity, null, undefined, {}, Number.MAX_SAFE_INTEGER + 1])(
    'throws on invalid reference ID: %j',
    (invalidId) => {
      expect(() => deserialize({ __type: 'ref', value: invalidId })).toThrow(TypeError);
      expect(() => deserialize({ __type: 'ref', value: invalidId })).toThrow(/Invalid "ref" id/);
    },
  );

  it.each([-1, 0, 1.5, '1', NaN, Infinity, null, {}, Number.MAX_SAFE_INTEGER + 1])(
    'throws on invalid container id in tagged object: %j',
    (invalidId) => {
      expect(() => deserialize({ __type: 'object', id: invalidId, value: { a: 1 } })).toThrow(
        TypeError,
      );
      expect(() => deserialize({ __type: 'object', id: invalidId, value: { a: 1 } })).toThrow(
        /Invalid "object" id/,
      );
    },
  );

  it('throws on unsafe integer reference ID', () => {
    const unsafeId = 2 ** 53 + 1;
    expect(() => deserialize({ __type: 'ref', value: unsafeId })).toThrow(TypeError);
    expect(() => deserialize({ __type: 'ref', value: unsafeId })).toThrow(/Invalid "ref" id/);
  });

  it('throws on unsafe integer container ID', () => {
    const unsafeId = 2 ** 53 + 1;
    expect(() => deserialize({ __type: 'object', id: unsafeId, value: { a: 1 } })).toThrow(
      TypeError,
    );
    expect(() => deserialize({ __type: 'object', id: unsafeId, value: { a: 1 } })).toThrow(
      /Invalid "object" id/,
    );
  });

  it('throws on malformed array payload', () => {
    expect(() => deserialize({ __type: 'array', id: 1, value: 'not-an-array' })).toThrow(TypeError);
  });

  it('throws on malformed object payload', () => {
    expect(() => deserialize({ __type: 'object', id: 1, value: 42 })).toThrow(TypeError);
  });

  it('deserializes legacy backups without id fields seamlessly', () => {
    const legacyBackup = {
      name: 'legacy',
      tags: { __type: 'set', value: ['a', 'b'] },
      dict: { __type: 'map', value: [['k', 'v']] },
      date: { __type: 'date', value: '2026-01-01T00:00:00.000Z' },
    };
    const restored = deserialize(legacyBackup) as typeof legacyBackup;
    expect(restored.name).toBe('legacy');
    expect(restored.tags).toEqual(new Set(['a', 'b']));
    expect(restored.dict).toEqual(new Map([['k', 'v']]));
    expect(restored.date).toEqual(new Date('2026-01-01T00:00:00.000Z'));
  });
});
