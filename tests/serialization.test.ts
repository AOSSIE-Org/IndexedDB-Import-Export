import { describe, test } from 'vitest';

describe('serialization', () => {
  test.todo('Uint8Array → tagged → Uint8Array (round-trip)');
  test.todo('bigint → tagged → bigint (round-trip)');
  test.todo('Date → tagged → Date (round-trip)');
  test.todo('nested objects containing mixed tagged types');
  test.todo('plain JSON primitives pass through unchanged');
  test.todo('arrays containing tagged values');
});
