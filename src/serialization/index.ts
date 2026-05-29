// TODO: Type-tagged serialization for JSON round-trips
//
// JSON.stringify cannot represent every type stored in IndexedDB.
// This module uses a __type tag convention for special values:
//
// | JS Type      | Encoded Format                                        |
// |--------------|-------------------------------------------------------|
// | bigint       | { "__type": "bigint", "value": "100000" }             |
// | Date         | { "__type": "date",  "value": "2026-05-25T10:00:00Z" }|
// | Uint8Array   | { "__type": "u8",    "value": "<base64>" }            |
// | Everything   | Stored as standard JSON                               |
//
// Responsibilities:
// - serialize(value: unknown): unknown — recursively encode non-JSON-safe values
// - deserialize(value: unknown): unknown — inverse of serialize
// - Ensure export → import round-trip reproduces original objects accurately
