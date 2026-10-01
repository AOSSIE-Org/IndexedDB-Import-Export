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

describe('reference-aware serialization and cycle preservation', () => {
  const roundTrip = <T>(val: T): T => deserialize(JSON.parse(JSON.stringify(serialize(val)))) as T;

  it('round-trips a self-containing array with cycle intact', () => {
    const arr: unknown[] = [1, 'test'];
    arr.push(arr);
    const restored = roundTrip(arr);
    expect(restored[0]).toBe(1);
    expect(restored[1]).toBe('test');
    expect(restored[2]).toBe(restored);
  });

  it('round-trips a self-containing plain object with cycle intact', () => {
    interface Node {
      name: string;
      self?: Node;
    }
    const node: Node = { name: 'cyclic-node' };
    node.self = node;
    const restored = roundTrip(node);
    expect(restored.name).toBe('cyclic-node');
    expect(restored.self).toBe(restored);
  });

  it('round-trips a self-containing Set with cycle intact', () => {
    const s = new Set<unknown>([1, 2]);
    s.add(s);
    const restored = roundTrip(s);
    expect(restored).toBeInstanceOf(Set);
    expect(restored.size).toBe(3);
    expect(restored.has(1)).toBe(true);
    expect(restored.has(2)).toBe(true);
    expect(restored.has(restored)).toBe(true);
  });

  it('round-trips a self-containing Map with cycle intact', () => {
    const m = new Map<unknown, unknown>();
    m.set('self', m);
    m.set(m, 'keySelf');
    const restored = roundTrip(m);
    expect(restored).toBeInstanceOf(Map);
    expect(restored.get('self')).toBe(restored);
    expect(restored.get(restored)).toBe('keySelf');
  });

  it('preserves shared object identity across multiple container positions', () => {
    const shared = { id: 'user-1', name: 'Alice' };
    const data = {
      primary: shared,
      secondary: shared,
      list: [shared],
      set: new Set([shared]),
    };
    const restored = roundTrip(data);
    expect(restored.primary).toEqual(shared);
    expect(restored.primary).toBe(restored.secondary);
    expect(restored.primary).toBe(restored.list[0]);
    expect([...restored.set][0]).toBe(restored.primary);
  });

  it('preserves shared object identity when used as both key and value in a Map', () => {
    const shared = { key: 'unique' };
    const m = new Map<unknown, unknown>([[shared, shared]]);
    const restored = roundTrip(m);
    expect(restored).toBeInstanceOf(Map);
    const keys = [...restored.keys()];
    const values = [...restored.values()];
    expect(keys[0]).toEqual(shared);
    expect(keys[0]).toBe(values[0]);
    expect(restored.get(keys[0])).toBe(keys[0]);
  });

  it('round-trips mutually recursive structures', () => {
    interface Parent {
      name: string;
      child?: Child;
    }
    interface Child {
      name: string;
      parent: Parent;
    }
    const parent: Parent = { name: 'parent' };
    const child: Child = { name: 'child', parent };
    parent.child = child;

    const restored = roundTrip(parent);
    expect(restored.name).toBe('parent');
    expect(restored.child?.name).toBe('child');
    expect(restored.child?.parent).toBe(restored);
    expect(restored.child?.parent.child).toBe(restored.child);
  });

  it('round-trips escaped user objects with __type in cycles', () => {
    interface EscapedNode {
      __type: string;
      label: string;
      loop?: EscapedNode;
    }
    const item: EscapedNode = { __type: 'custom', label: 'test' };
    item.loop = item;
    const restored = roundTrip(item);
    expect(restored.__type).toBe('custom');
    expect(restored.label).toBe('test');
    expect(restored.loop).toBe(restored);
  });
});

describe('reference validation and error handling', () => {
  it('throws on unknown reference id', () => {
    expect(() => deserialize({ __type: 'ref', id: 999, value: 999 })).toThrow(ReferenceError);
  });

  it('throws on missing or non-integer ref id', () => {
    expect(() => deserialize({ __type: 'ref', value: null })).toThrow(TypeError);
    expect(() => deserialize({ __type: 'ref', id: 'not-a-number', value: null })).toThrow(
      TypeError,
    );
    expect(() => deserialize({ __type: 'ref', id: 1.5, value: 1.5 })).toThrow(TypeError);
    expect(() => deserialize({ __type: 'ref', id: -1, value: -1 })).toThrow(TypeError);
  });

  it('throws on missing or invalid def id', () => {
    expect(() => deserialize({ __type: 'def', value: [] })).toThrow(TypeError);
    expect(() => deserialize({ __type: 'def', id: 0, value: [] })).toThrow(TypeError);
    expect(() => deserialize({ __type: 'def', id: 'abc', value: [] })).toThrow(TypeError);
  });

  it('throws on duplicate def id', () => {
    const payload = [
      { __type: 'def', id: 1, value: [1] },
      { __type: 'def', id: 1, value: [2] },
    ];
    expect(() => deserialize(payload)).toThrow(TypeError);
  });
});
