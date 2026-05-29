// TODO: Implement importDB() — restore/merge data from JSON backup
//
// Responsibilities:
// - Accept a database name and parsed ExportFormat JSON
// - Support "overwrite" and "merge" import strategies
// - Create/upgrade the database using the schema from the export
// - Create object stores and indexes matching the backup schema
// - Deserialize type-tagged records back to native JS types
// - Insert all records into the appropriate stores
