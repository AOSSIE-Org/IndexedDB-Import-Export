// TODO: Tests for exportDB()
//
// Test cases to cover:
// - Export a single object store with simple records
// - Export multiple stores with selective storeNames filter
// - Exported schema matches the database structure (keyPaths, indexes)
// - Records containing tagged types (bigint, Date, Uint8Array) are serialized correctly
// - Export format includes backupVersion, databaseName, databaseVersion, exportedAt
// - Empty database exports cleanly
