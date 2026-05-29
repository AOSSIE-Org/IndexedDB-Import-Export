// TODO: Implement exportDB() — dump IndexedDB stores to generic JSON format
//
// Responsibilities:
// - Accept a database name (or IDBDatabase reference) and optional store filter
// - Extract database schema (object store names, key paths, autoIncrement, indexes)
// - Read all records from each store
// - Serialize records using type-tagged serialization (bigint, Date, Uint8Array)
// - Return the generic ExportFormat JSON object
