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
  SERIALIZATION_TAGS.OBJECT,
  SERIALIZATION_TAGS.DEF,
  SERIALIZATION_TAGS.REF,
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
 * Check whether a value is a container that can hold references and form cycles
 * (arrays, plain objects, Set, and Map).
 */
function isReferenceableContainer(value: unknown): value is object {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  return (
    Array.isArray(value) || isPlainObject(value) || value instanceof Set || value instanceof Map
  );
}

/**
 * Pre-scan an object graph to discover which containers appear more than once
 * or participate in a cyclic reference. Returns a set of those shared objects.
 * Cycles are detected safely without stack overflow.
 */
function findSharedObjects(root: unknown): Set<object> {
  const seen = new Set<object>();
  const shared = new Set<object>();

  function scan(val: unknown) {
    if (!isReferenceableContainer(val)) {
      return;
    }
    if (seen.has(val)) {
      shared.add(val);
      return;
    }
    seen.add(val);

    if (Array.isArray(val)) {
      for (let i = 0; i < val.length; i++) {
        scan(val[i]);
      }
    } else if (val instanceof Set) {
      for (const item of val) {
        scan(item);
      }
    } else if (val instanceof Map) {
      for (const [k, v] of val) {
        scan(k);
        scan(v);
      }
    } else if (isPlainObject(val)) {
      for (const key of Object.keys(val)) {
        scan(val[key]);
      }
    }
  }

  scan(root);
  return shared;
}

interface SerializationContext {
  shared: Set<object>;
  idMap: Map<object, number>;
  nextId: number;
}

/**
 * Recursively serialize a value, converting non-JSON-safe types to tagged representations
 * and preserving shared/cyclic references across containers (arrays, plain objects, Set, Map).
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
 * - plain object with its own `__type` key → `{ __type: "object", value: { ...fields } }`
 * - shared/cyclic object definition → `{ __type: "def", id: <id>, value: <contents> }`
 * - reference to an already defined shared object → `{ __type: "ref", id: <id>, value: <id> }`
 *
 * JSON-safe primitives (string, number, boolean, null) pass through unchanged.
 * Plain objects and arrays are recursively processed.
 *
 * @param value - The value to serialize.
 * @returns The serialized value, safe for `JSON.stringify`.
 */
export function serialize(value: unknown): unknown {
  const shared = findSharedObjects(value);
  const context: SerializationContext = {
    shared,
    idMap: new Map<object, number>(),
    nextId: 1,
  };
  return serializeInternal(value, context);
}

function serializeContainerBody(value: object, context: SerializationContext): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => serializeInternal(item, context));
  }

  if (value instanceof Set) {
    return {
      __type: SERIALIZATION_TAGS.SET,
      value: [...value].map((item) => serializeInternal(item, context)),
    } satisfies TaggedValue;
  }

  if (value instanceof Map) {
    return {
      __type: SERIALIZATION_TAGS.MAP,
      value: [...value].map(([k, v]) => [
        serializeInternal(k, context),
        serializeInternal(v, context),
      ]),
    } satisfies TaggedValue;
  }

  if (isPlainObject(value)) {
    const fields = mapFields(value, (item) => serializeInternal(item, context));
    if (Object.prototype.hasOwnProperty.call(value, '__type')) {
      return { __type: SERIALIZATION_TAGS.OBJECT, value: fields } satisfies TaggedValue;
    }
    return fields;
  }

  return value;
}

function serializeInternal(value: unknown, context: SerializationContext): unknown {
  if (typeof value === 'object' && value !== null && context.shared.has(value)) {
    if (context.idMap.has(value)) {
      const refId = context.idMap.get(value)!;
      return {
        __type: SERIALIZATION_TAGS.REF,
        id: refId,
        value: refId,
      } satisfies TaggedValue;
    }

    const defId = context.nextId++;
    context.idMap.set(value, defId);
    const body = serializeContainerBody(value, context);
    return {
      __type: SERIALIZATION_TAGS.DEF,
      id: defId,
      value: body,
    } satisfies TaggedValue;
  }

  // Non-shared or non-container values:
  if (value instanceof Uint8Array) {
    return {
      __type: SERIALIZATION_TAGS.UINT8,
      value: uint8ArrayToBase64(value),
    } satisfies TaggedValue;
  }

  if (ArrayBuffer.isView(value)) {
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
    return {
      __type: SERIALIZATION_TAGS.SET,
      value: [...value].map((item) => serializeInternal(item, context)),
    } satisfies TaggedValue;
  }

  if (value instanceof Map) {
    return {
      __type: SERIALIZATION_TAGS.MAP,
      value: [...value].map(([k, v]) => [
        serializeInternal(k, context),
        serializeInternal(v, context),
      ]),
    } satisfies TaggedValue;
  }

  if (value instanceof RegExp) {
    return {
      __type: SERIALIZATION_TAGS.REG_EXP,
      value: { source: value.source, flags: value.flags },
    } satisfies TaggedValue;
  }

  // Recursively process arrays
  if (Array.isArray(value)) {
    return value.map((item) => serializeInternal(item, context));
  }

  // Recursively process plain objects
  if (isPlainObject(value)) {
    const fields = mapFields(value, (item) => serializeInternal(item, context));
    if (Object.prototype.hasOwnProperty.call(value, '__type')) {
      return { __type: SERIALIZATION_TAGS.OBJECT, value: fields } satisfies TaggedValue;
    }
    return fields;
  }

  // JSON-safe primitives pass through unchanged
  return value;
}

/**
 * Apply `fn` to each own enumerable field, building a null-prototype object
 * (a prototype-pollution defense for keys like `__proto__`).
 */
function mapFields(
  value: Record<string, unknown>,
  fn: (field: unknown) => unknown,
): Record<string, unknown> {
  const result: Record<string, unknown> = Object.create(null);
  for (const key of Object.keys(value)) {
    result[key] = fn(value[key]);
  }
  return result;
}

/**
 * Recursively deserialize a value, converting tagged representations back to native types
 * and resolving shared and cyclic references.
 *
 * Reverses every tag produced by {@link serialize}. A malformed payload for a
 * known tag throws a `TypeError` (or a `RangeError` for an invalid date);
 * unknown tags are returned unchanged with a warning.
 *
 * @param value - The value to deserialize.
 * @returns The deserialized value with native types restored.
 */
export function deserialize(value: unknown): unknown {
  const context = new Map<number, unknown>();
  return deserializeInternal(value, context);
}

function deserializeInternal(value: unknown, context: Map<number, unknown>): unknown {
  // Check for tagged values first
  if (isTaggedValue(value)) {
    const tag = value.__type;

    if (tag === SERIALIZATION_TAGS.REF) {
      const id =
        typeof value.id === 'number'
          ? value.id
          : typeof value.value === 'number'
            ? value.value
            : null;
      if (id === null || !Number.isInteger(id) || id <= 0) {
        throw new TypeError(`Invalid "${tag}" value in backup: missing or invalid id`);
      }
      if (!context.has(id)) {
        throw new ReferenceError(`Unknown reference id: ${id}`);
      }
      return context.get(id);
    }

    if (tag === SERIALIZATION_TAGS.DEF) {
      const id = typeof value.id === 'number' ? value.id : null;
      if (id === null || !Number.isInteger(id) || id <= 0) {
        throw new TypeError(`Invalid "${tag}" value in backup: missing or invalid id`);
      }
      if (context.has(id)) {
        throw new TypeError(`Duplicate definition for reference id: ${id}`);
      }
      if (!('value' in value)) {
        throw new TypeError(`Invalid "${tag}" value in backup: missing value`);
      }

      const inner = value.value;

      if (Array.isArray(inner)) {
        const container: unknown[] = [];
        context.set(id, container);
        for (let i = 0; i < inner.length; i++) {
          container.push(deserializeInternal(inner[i], context));
        }
        return container;
      }

      if (isTaggedValue(inner)) {
        if (inner.__type === SERIALIZATION_TAGS.SET) {
          const container = new Set<unknown>();
          context.set(id, container);
          const items = deserializeInternal(inner.value, context);
          if (!Array.isArray(items)) {
            throw invalidPayload(SERIALIZATION_TAGS.SET, inner.value);
          }
          for (const item of items) {
            container.add(item);
          }
          return container;
        }

        if (inner.__type === SERIALIZATION_TAGS.MAP) {
          const container = new Map<unknown, unknown>();
          context.set(id, container);
          const entries = deserializeInternal(inner.value, context);
          if (
            !Array.isArray(entries) ||
            !entries.every((entry) => Array.isArray(entry) && entry.length === 2)
          ) {
            throw invalidPayload(SERIALIZATION_TAGS.MAP, inner.value);
          }
          for (const [k, v] of entries) {
            container.set(k, v);
          }
          return container;
        }

        if (inner.__type === SERIALIZATION_TAGS.OBJECT) {
          if (!isPlainObject(inner.value)) {
            throw invalidPayload(SERIALIZATION_TAGS.OBJECT, inner.value);
          }
          const container: Record<string, unknown> = Object.create(null);
          context.set(id, container);
          for (const key of Object.keys(inner.value)) {
            container[key] = deserializeInternal(inner.value[key], context);
          }
          return container;
        }

        const result = deserializeTagged(inner, context);
        context.set(id, result);
        return result;
      }

      if (isPlainObject(inner)) {
        const container: Record<string, unknown> = Object.create(null);
        context.set(id, container);
        for (const key of Object.keys(inner)) {
          container[key] = deserializeInternal(inner[key], context);
        }
        return container;
      }

      const result = deserializeInternal(inner, context);
      context.set(id, result);
      return result;
    }

    return deserializeTagged(value, context);
  }

  // Recursively process arrays
  if (Array.isArray(value)) {
    return value.map((item) => deserializeInternal(item, context));
  }

  // Recursively process plain objects
  if (isPlainObject(value)) {
    return mapFields(value, (item) => deserializeInternal(item, context));
  }

  // JSON-safe primitives pass through unchanged
  return value;
}

function deserializeTagged(value: TaggedValue, context: Map<number, unknown>): unknown {
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
        console.warn(`[idb-backup] Unknown typed array type "${type}" — returning an ArrayBuffer.`);
        return buffer;
      }
      return new Ctor(buffer);
    }

    case SERIALIZATION_TAGS.SET: {
      const items = deserializeInternal(value.value, context);
      if (!Array.isArray(items)) {
        throw invalidPayload(tag, value.value);
      }
      return new Set(items);
    }

    case SERIALIZATION_TAGS.MAP: {
      const entries = deserializeInternal(value.value, context);
      if (
        !Array.isArray(entries) ||
        !entries.every((entry) => Array.isArray(entry) && entry.length === 2)
      ) {
        throw invalidPayload(tag, value.value);
      }
      return new Map(entries as [unknown, unknown][]);
    }

    case SERIALIZATION_TAGS.REG_EXP: {
      const { source, flags } = expectStringFields(tag, value.value, ['source', 'flags'] as const);
      return new RegExp(source, flags);
    }

    case SERIALIZATION_TAGS.OBJECT:
      if (!isPlainObject(value.value)) {
        throw invalidPayload(tag, value.value);
      }
      return mapFields(value.value, (item) => deserializeInternal(item, context));

    default:
      console.warn(
        `[idb-backup] Unknown __type tag "${value.__type}" — returning the tagged value unchanged.`,
      );
      return value;
  }
}
