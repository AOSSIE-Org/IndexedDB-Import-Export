import { describe, test } from 'vitest';

describe('importDB', () => {
  test.todo('imports into a fresh (non-existent) database');
  test.todo('"overwrite" strategy clears existing data before import');
  test.todo('"merge" strategy preserves existing records and adds new ones');
  test.todo('imported records are deserialized correctly (bigint, Date, Uint8Array)');
  test.todo('object stores and indexes are created matching the backup schema');
  test.todo('invalid/corrupt backup data is rejected gracefully');
  test.todo('database version is set correctly from the backup');
});
