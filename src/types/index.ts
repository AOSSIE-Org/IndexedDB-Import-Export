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
 * Canonical `__type` tag names used by the serialization layer.
 *
 * Centralised here so encode/decode reference the same constants instead of
 * scattered string literals (avoids typos and eases adding new tags).
 */
export const SERIALIZATION_TAGS = {
  UINT8: 'u8',
  BIGINT: 'bigint',
  DATE: 'date',
} as const;

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
 * A stable, envelope-independent summary of a backup, passed to the
 * {@link ImportOptions.onBeforeImport} hook so a caller can inspect a backup
 * before any data is written.
 *
 * Derived from the {@link ExportFormat} rather than exposing it directly, so the
 * hook contract survives future changes to the envelope shape.
 */
export interface ImportSummary {
  /** The names of the object stores contained in the backup. */
  storeNames: string[];
  /** The number of records in each store, keyed by store name. */
  recordCounts: Record<string, number>;
  /** The backup format version of the envelope. */
  backupVersion: number;
  /** The name of the database the backup was exported from. */
  databaseName: string;
  /** ISO 8601 timestamp of when the backup was created. */
  exportedAt: string;
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
  /**
   * Optional list of object store names to restore.
   * If omitted, every store in the backup is restored.
   *
   * The selection scopes both schema and records, mirroring
   * {@link ExportOptions.storeNames}: an excluded store is neither populated nor
   * created. Under `"merge"` an excluded store that already exists is left
   * untouched, and one that is missing stays missing. Under `"overwrite"` — which
   * recreates the database from scratch — an excluded store is absent afterwards
   * even if it existed before, so prefer `"merge"` for a partial restore unless
   * the selected stores are meant to be the whole database.
   *
   * Store names absent from the backup are ignored. Passing an empty array
   * restores nothing.
   */
  storeNames?: string[];
  /**
   * Optional hook invoked with a {@link ImportSummary} of the backup **before**
   * any data is written or deleted. Return `false` (or a promise resolving to
   * `false`) to abort the import: nothing is written and, under `"overwrite"`,
   * the existing database is left untouched. Return `true` to proceed.
   *
   * When `storeNames` is set, the summary reflects the selected stores, so it
   * describes exactly what will be written.
   *
   * Use this to confirm a destructive restore with the user, or to reject a
   * backup that does not belong to the current context (for example, a backup
   * for a different wallet or account). The hook receives a stable summary, not
   * the raw backup envelope, so validation logic stays decoupled from the
   * envelope shape. If the hook throws, the error propagates and the import is
   * aborted with nothing written.
   */
  onBeforeImport?: (summary: ImportSummary) => boolean | Promise<boolean>;
}
