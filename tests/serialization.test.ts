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
});

describe('Structured Clone native types serialization', () => {
  it('round-trips Set', () => {
    const data = new Set([1, 'two', 3n, new Date('2026-01-01T00:00:00Z')]);
    const restored = deserialize(serialize(data)) as Set<any>;
    expect(restored).toBeInstanceOf(Set);
    expect([...restored]).toEqual([...data]);
  });

  it('round-trips Map', () => {
    const data = new Map<string, any>([
      ['a', 1],
      ['b', new Set([1, 2, 3])],
      ['c', 42n]
    ]);
    const restored = deserialize(serialize(data)) as Map<string, any>;
    expect(restored).toBeInstanceOf(Map);
    expect([...restored.entries()]).toEqual([...data.entries()]);
  });

  it('round-trips ArrayBuffer', () => {
    const buffer = new Uint16Array([1, 2, 3]).buffer;
    const restored = deserialize(serialize(buffer)) as ArrayBuffer;
    expect(restored).toBeInstanceOf(ArrayBuffer);
    expect(new Uint16Array(restored)).toEqual(new Uint16Array([1, 2, 3]));
  });

  it('round-trips TypedArrays', () => {
    const data = {
      f32: new Float32Array([1.5, 2.5]),
      u16: new Uint16Array([1, 2, 3]),
      i8: new Int8Array([-1, 0, 1])
    };
    const restored = deserialize(serialize(data)) as typeof data;
    expect(restored.f32).toBeInstanceOf(Float32Array);
    expect(restored.f32).toEqual(new Float32Array([1.5, 2.5]));
    
    expect(restored.u16).toBeInstanceOf(Uint16Array);
    expect(restored.u16).toEqual(new Uint16Array([1, 2, 3]));
    
    expect(restored.i8).toBeInstanceOf(Int8Array);
    expect(restored.i8).toEqual(new Int8Array([-1, 0, 1]));
  });

  it('round-trips RegExp', () => {
    const regex = /hello/gi;
    const restored = deserialize(serialize(regex)) as RegExp;
    expect(restored).toBeInstanceOf(RegExp);
    expect(restored.source).toBe(regex.source);
    expect(restored.flags).toBe(regex.flags);
  });
});

