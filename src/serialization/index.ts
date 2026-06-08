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
    typeof value['value'] === 'string'
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
    return { __type: 'u8', value: uint8ArrayToBase64(value) } satisfies TaggedValue;
  }

  if (typeof value === 'bigint') {
    return { __type: 'bigint', value: value.toString() } satisfies TaggedValue;
  }

  if (value instanceof Date) {
    return { __type: 'date', value: value.toISOString() } satisfies TaggedValue;
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
      case 'u8':
        return base64ToUint8Array(value.value);

      case 'bigint':
        return BigInt(value.value);

      case 'date':
        return new Date(value.value);

      default:
        // Unknown tag — return as-is (forward compatibility)
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
