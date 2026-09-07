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
 * Check whether a value matches the TaggedValue shape.
 */
function isTaggedValue(value: unknown): value is TaggedValue {
  return (
    isPlainObject(value) &&
    typeof value['__type'] === 'string' &&
    'value' in value
  );
}

/**
 * Recursively serialize a value, converting non-JSON-safe types to tagged representations.
 *
 * Currently handles:
 * - `Uint8Array` → `{ __type: "u8", value: "<base64>" }`
 * - `bigint` → `{ __type: "bigint", value: "<digits>" }`
 * - `Date` → `{ __type: "date", value: "<ISO 8601>" }`
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
    } as any;
  }

  if (ArrayBuffer.isView(value)) {
    return {
      __type: SERIALIZATION_TAGS.TYPED_ARRAY,
      value: {
        type: value.constructor.name,
        data: uint8ArrayToBase64(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)),
      },
    } as any;
  }

  if (value instanceof ArrayBuffer) {
    return {
      __type: SERIALIZATION_TAGS.ARRAY_BUFFER,
      value: uint8ArrayToBase64(new Uint8Array(value)),
    } as any;
  }

  if (typeof value === 'bigint') {
    return { __type: SERIALIZATION_TAGS.BIGINT, value: value.toString() } as any;
  }

  if (value instanceof Date) {
    return { __type: SERIALIZATION_TAGS.DATE, value: value.toISOString() } as any;
  }

  if (value instanceof Set) {
    return {
      __type: SERIALIZATION_TAGS.SET,
      value: serialize([...value]),
    } as any;
  }

  if (value instanceof Map) {
    return {
      __type: SERIALIZATION_TAGS.MAP,
      value: serialize([...value.entries()]),
    } as any;
  }

  if (value instanceof RegExp) {
    return {
      __type: SERIALIZATION_TAGS.REG_EXP,
      value: { source: value.source, flags: value.flags },
    } as any;
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
 * Currently handles:
 * - `{ __type: "u8", value: "<base64>" }` → `Uint8Array`
 * - `{ __type: "bigint", value: "<digits>" }` → `bigint`
 * - `{ __type: "date", value: "<ISO 8601>" }` → `Date`
 *
 * @param value - The value to deserialize.
 * @returns The deserialized value with native types restored.
 */
export function deserialize(value: unknown): unknown {
  // Check for tagged values first
  if (isTaggedValue(value)) {
    switch (value.__type) {
      case SERIALIZATION_TAGS.UINT8:
        return base64ToUint8Array(value.value as string);

      case SERIALIZATION_TAGS.BIGINT:
        return BigInt(value.value as string);

      case SERIALIZATION_TAGS.DATE: {
        const date = new Date(value.value as string);
        if (Number.isNaN(date.getTime())) {
          throw new RangeError(`Invalid date value in backup: "${value.value}"`);
        }
        return date;
      }

      case SERIALIZATION_TAGS.ARRAY_BUFFER:
        return base64ToUint8Array(value.value as string).buffer;

      case SERIALIZATION_TAGS.TYPED_ARRAY: {
        const payload = value.value as { type: string; data: string };
        const buffer = base64ToUint8Array(payload.data).buffer;
        const ctor = (globalThis as any)[payload.type];
        if (ctor) {
          return new ctor(buffer);
        }
        console.warn(`[idb-backup] Unknown typed array type "${payload.type}". Returning ArrayBuffer.`);
        return buffer;
      }

      case SERIALIZATION_TAGS.SET:
        return new Set(deserialize(value.value) as any[]);

      case SERIALIZATION_TAGS.MAP:
        return new Map(deserialize(value.value) as any[]);

      case SERIALIZATION_TAGS.REG_EXP: {
        const payload = value.value as { source: string; flags: string };
        return new RegExp(payload.source, payload.flags);
      }

      default:
        // Unknown tag — likely written by a newer serializer. Warn so the caller
        // knows the value wasn't decoded, then return as-is (forward compatibility).
        console.warn(
          `[idb-backup] Unknown __type tag "${value.__type}" — returning the tagged value unchanged.`
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
