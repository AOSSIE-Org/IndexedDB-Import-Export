/**
 * Schema definition for a single IndexedDB index.
 */
export interface IndexSchema {
  /** The name of the index. */
  name: string;
  /** The key path of the index. Can be a string or an array of strings for compound indexes. */
  keyPath: string | string[];
  /** Whether the index enforces unique values. */
  unique: boolean;
  /** Whether the index uses multi-entry mode for array key paths. */
  multiEntry: boolean;
}

/**
 * Schema definition for a single IndexedDB object store.
 */
export interface StoreSchema {
  /** The key path of the object store, or `null` if using out-of-line keys. */
  keyPath: string | string[] | null;
  /** Whether the object store uses auto-incrementing keys. */
  autoIncrement: boolean;
  /** The indexes defined on this object store. */
  indexes: IndexSchema[];
}

/**
 * A type-tagged value used to preserve types that JSON.stringify cannot handle natively.
 *
 * Supported `__type` values:
 * - `"u8"` — Uint8Array (value is a base64-encoded string)
 * - `"bigint"` — bigint (value is the string representation)
 * - `"date"` — Date (value is an ISO 8601 string)
 */
export interface TaggedValue {
  __type: string;
  value: string;
}

/**
 * The top-level backup JSON envelope produced by `exportDB()`.
 */
export interface ExportFormat {
  /** The version of the backup format (currently 1). */
  backupVersion: number;
  /** The name of the exported IndexedDB database. */
  databaseName: string;
  /** The version number of the exported database. */
  databaseVersion: number;
  /** ISO 8601 timestamp of when the export was created. */
  exportedAt: string;
  /** Schema definitions for each object store, keyed by store name. */
  schema: Record<string, StoreSchema>;
  /** Serialized records for each object store, keyed by store name. */
  stores: Record<string, Array<{ key: unknown; value: unknown }>>;
}

/**
 * Options for the `exportDB()` function.
 */
export interface ExportOptions {
  /** The name of the IndexedDB database to export. */
  dbName: string;
  /**
   * Optional list of object store names to export.
   * If omitted, all stores in the database are exported.
   */
  storeNames?: string[];
}

/**
 * Options for the `importDB()` function.
 */
export interface ImportOptions {
  /** The name of the IndexedDB database to import into. */
  dbName: string;
  /** The parsed backup data to import. */
  backupData: ExportFormat;
  /**
   * The import strategy to use:
   * - `"overwrite"` — Delete the existing database and recreate it from the backup.
   * - `"merge"` — Keep existing data and add/update records from the backup.
   */
  strategy: 'overwrite' | 'merge';
}
