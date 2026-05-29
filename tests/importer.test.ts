// TODO: Tests for importDB()
//
// Test cases to cover:
// - Import into a fresh (non-existent) database
// - "overwrite" strategy clears existing data before import
// - "merge" strategy preserves existing records and adds new ones
// - Imported records are deserialized correctly (bigint, Date, Uint8Array)
// - Object stores and indexes are created matching the backup schema
// - Invalid/corrupt backup data is rejected gracefully
// - Database version is set correctly from the backup
