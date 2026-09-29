import { SERIALIZATION_TAGS } from '../types/index.js';
import type { TaggedValue } from '../types/index.js';

/**
 * The current backup format version.
 * Increment this when the serialization format changes.
 */
export const BACKUP_VERSION = 1;

/**
 * Convert a Uint8Array to a base64-encoded string.
 *
 * Uses the browser-native `btoa` function with a binary string intermediate.
 * This approach avoids external dependencies and works in all modern browsers.
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

/**
 * Convert a base64-encoded string back to a Uint8Array.
 */
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Copy a view's bytes into a fresh, exactly-sized ArrayBuffer.
 */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

/**
 * Check whether a value is a plain object (not an array, Date, Uint8Array, etc.).
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  // Accept both standard and null-prototype objects. `serialize` builds
  // records with `Object.create(null)` as a prototype-pollution defense, so
  // `deserialize` must also recurse into them — otherwise nested tagged values
  // are left encoded on a direct `serialize` -> `deserialize` round-trip.
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Tags whose `value` is a JSON array or object rather than a string.
 */
const STRUCTURED_TAGS: ReadonlySet<string> = new Set([
  SERIALIZATION_TAGS.SET,
  SERIALIZATION_TAGS.MAP,
  SERIALIZATION_TAGS.REG_EXP,
  SERIALIZATION_TAGS.TYPED_ARRAY,
]);

type ArrayBufferViewConstructor = new (buffer: ArrayBuffer) => ArrayBufferView;

/**
 * Allowlist of view constructors that may be rebuilt from a backup. The `type`
 * name in a backup file is untrusted input, so it is never used to look up
 * arbitrary globals.
 */
const TYPED_ARRAY_CONSTRUCTORS: Readonly<Record<string, ArrayBufferViewConstructor>> =
  Object.assign(Object.create(null) as Record<string, ArrayBufferViewConstructor>, {
    Int8Array,
    Uint8ClampedArray,
    Int16Array,
    Uint16Array,
    Int32Array,
    Uint32Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array,
    DataView,
  });

/**
 * Check whether a value matches the TaggedValue shape.
 *
 * String payloads are always treated as tags (the original format, and the
 * forward-compatibility path for unknown tags). Non-string payloads are only
 * treated as tags for the structured tags this version knows about, so user
 * records shaped like `{ __type, value: {...} }` are still recursed into and
 * their nested tagged values decoded.
 */
function isTaggedValue(value: unknown): value is TaggedValue {
  return (
    isPlainObject(value) &&
    typeof value['__type'] === 'string' &&
    'value' in value &&
    (typeof value['value'] === 'string' || STRUCTURED_TAGS.has(value['__type']))
  );
}

function invalidPayload(tag: string, value: unknown): TypeError {
  return new TypeError(`Invalid "${tag}" value in backup: ${JSON.stringify(value)}`);
}

function expectString(tag: string, value: unknown): string {
  if (typeof value !== 'string') {
    throw invalidPayload(tag, value);
  }
  return value;
}

function expectStringFields<K extends string>(
  tag: string,
  value: unknown,
  keys: readonly K[],
): Record<K, string> {
  if (!isPlainObject(value) || !keys.every((key) => typeof value[key] === 'string')) {
    throw invalidPayload(tag, value);
  }
  return value as Record<K, string>;
}

/**
 * Recursively serialize a value, converting non-JSON-safe types to tagged representations.
 *
 * Currently handles:
 * - `Uint8Array` → `{ __type: "u8", value: "<base64>" }`
 * - `bigint` → `{ __type: "bigint", value: "<digits>" }`
 * - `Date` → `{ __type: "date", value: "<ISO 8601>" }`
 * - `ArrayBuffer` → `{ __type: "buffer", value: "<base64>" }`
 * - other typed arrays and `DataView` → `{ __type: "typed_array", value: { type, data: "<base64>" } }`
 * - `Set` → `{ __type: "set", value: [...values] }`
 * - `Map` → `{ __type: "map", value: [[key, value], ...] }`
 * - `RegExp` → `{ __type: "regex", value: { source, flags } }`
 *
 * JSON-safe primitives (string, number, boolean, null) pass through unchanged.
 * Plain objects and arrays are recursively processed.
 *
 * @param value - The value to serialize.
 * @returns The serialized value, safe for `JSON.stringify`.
 */
export function serialize(value: unknown): unknown {
  // Uint8Array → tagged base64
  if (value instanceof Uint8Array) {
    return {
      __type: SERIALIZATION_TAGS.UINT8,
      value: uint8ArrayToBase64(value),
    } satisfies TaggedValue;
  }

  if (ArrayBuffer.isView(value)) {
    // The built-in toStringTag gives the base type name even for subclasses
    // and minified code, unlike `constructor.name`.
    const type = Object.prototype.toString.call(value).slice(8, -1);
    const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return {
      __type: SERIALIZATION_TAGS.TYPED_ARRAY,
      value: { type, data: uint8ArrayToBase64(bytes) },
    } satisfies TaggedValue;
  }

  if (value instanceof ArrayBuffer) {
    return {
      __type: SERIALIZATION_TAGS.ARRAY_BUFFER,
      value: uint8ArrayToBase64(new Uint8Array(value)),
    } satisfies TaggedValue;
  }

  if (typeof value === 'bigint') {
    return { __type: SERIALIZATION_TAGS.BIGINT, value: value.toString() } satisfies TaggedValue;
  }

  if (value instanceof Date) {
    return { __type: SERIALIZATION_TAGS.DATE, value: value.toISOString() } satisfies TaggedValue;
  }

  if (value instanceof Set) {
    return { __type: SERIALIZATION_TAGS.SET, value: serialize([...value]) } satisfies TaggedValue;
  }

  if (value instanceof Map) {
    return { __type: SERIALIZATION_TAGS.MAP, value: serialize([...value]) } satisfies TaggedValue;
  }

  if (value instanceof RegExp) {
    return {
      __type: SERIALIZATION_TAGS.REG_EXP,
      value: { source: value.source, flags: value.flags },
    } satisfies TaggedValue;
  }

  // Recursively process arrays
  if (Array.isArray(value)) {
    return value.map((item) => serialize(item));
  }

  // Recursively process plain objects
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(value)) {
      result[key] = serialize(value[key]);
    }
    return result;
  }

  // JSON-safe primitives pass through unchanged
  return value;
}

/**
 * Recursively deserialize a value, converting tagged representations back to native types.
 *
 * Reverses every tag produced by {@link serialize}. A malformed payload for a
 * known tag throws a `TypeError` (or a `RangeError` for an invalid date);
 * unknown tags are returned unchanged with a warning.
 *
 * @param value - The value to deserialize.
 * @returns The deserialized value with native types restored.
 */
export function deserialize(value: unknown): unknown {
  // Check for tagged values first
  if (isTaggedValue(value)) {
    const tag = value.__type;
    switch (tag) {
      case SERIALIZATION_TAGS.UINT8:
        return base64ToUint8Array(expectString(tag, value.value));

      case SERIALIZATION_TAGS.BIGINT:
        return BigInt(expectString(tag, value.value));

      case SERIALIZATION_TAGS.DATE: {
        const date = new Date(expectString(tag, value.value));
        if (Number.isNaN(date.getTime())) {
          throw new RangeError(`Invalid date value in backup: "${value.value}"`);
        }
        return date;
      }

      case SERIALIZATION_TAGS.ARRAY_BUFFER:
        return toArrayBuffer(base64ToUint8Array(expectString(tag, value.value)));

      case SERIALIZATION_TAGS.TYPED_ARRAY: {
        const { type, data } = expectStringFields(tag, value.value, ['type', 'data'] as const);
        const buffer = toArrayBuffer(base64ToUint8Array(data));
        const Ctor = TYPED_ARRAY_CONSTRUCTORS[type];
        if (!Ctor) {
          console.warn(
            `[idb-backup] Unknown typed array type "${type}" — returning an ArrayBuffer.`,
          );
          return buffer;
        }
        return new Ctor(buffer);
      }

      case SERIALIZATION_TAGS.SET: {
        const items = deserialize(value.value);
        if (!Array.isArray(items)) {
          throw invalidPayload(tag, value.value);
        }
        return new Set(items);
      }

      case SERIALIZATION_TAGS.MAP: {
        const entries = deserialize(value.value);
        if (
          !Array.isArray(entries) ||
          !entries.every((entry) => Array.isArray(entry) && entry.length === 2)
        ) {
          throw invalidPayload(tag, value.value);
        }
        return new Map(entries as [unknown, unknown][]);
      }

      case SERIALIZATION_TAGS.REG_EXP: {
        const { source, flags } = expectStringFields(tag, value.value, [
          'source',
          'flags',
        ] as const);
        return new RegExp(source, flags);
      }

      default:
        // Unknown tag — likely written by a newer serializer. Warn so the caller
        // knows the value wasn't decoded, then return as-is (forward compatibility).
        console.warn(
          `[idb-backup] Unknown __type tag "${value.__type}" — returning the tagged value unchanged.`,
        );
        return value;
    }
  }

  // Recursively process arrays
  if (Array.isArray(value)) {
    return value.map((item) => deserialize(item));
  }

  // Recursively process plain objects
  if (isPlainObject(value)) {
    const result: Record<string, unknown> = Object.create(null);
    for (const key of Object.keys(value)) {
      result[key] = deserialize(value[key]);
    }
    return result;
  }

  // JSON-safe primitives pass through unchanged
  return value;
}
