// TODO: Shared TypeScript interfaces
//
// Define the following types:
//
// - ExportFormat: The top-level backup JSON envelope
//   { backupVersion, databaseName, databaseVersion, exportedAt, schema, stores, checksum }
//
// - StoreSchema: Schema for a single object store
//   { keyPath, autoIncrement?, indexes }
//
// - IndexSchema: Schema for a single index
//   { name, keyPath, unique?, multiEntry? }
//
// - TaggedValue: A type-tagged value for serialization
//   { __type: string, value: string }
//
// - ImportOptions: Options for importDB
//   { dbName, backupData, strategy: "overwrite" | "merge" }
//
// - ExportOptions: Options for exportDB
//   { dbName, storeNames?: string[] }
