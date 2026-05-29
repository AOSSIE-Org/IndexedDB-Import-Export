import { describe, test } from 'vitest';

describe('exportDB', () => {
  test.todo('exports a single object store with simple records');
  test.todo('exports multiple stores with selective storeNames filter');
  test.todo('matches schema (keyPaths, indexes)');
  test.todo('serializes bigint/Date/Uint8Array correctly');
  test.todo('includes backupVersion/databaseName/databaseVersion/exportedAt');
  test.todo('exports empty databases cleanly');
});
