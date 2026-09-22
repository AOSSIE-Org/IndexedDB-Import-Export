// Public API
export { exportDB } from './core/exporter.js';
export { importDB } from './core/importer.js';

// Serialization utilities
export { serialize, deserialize, BACKUP_VERSION } from './serialization/index.js';

// Types
export type {
  ExportFormat,
  ExportOptions,
  ImportOptions,
  ImportSummary,
  StoreSchema,
  IndexSchema,
  TaggedValue,
} from './types/index.js';

// Browser utilities
export { isBrowser, assertBrowser } from './utils/ssr.js';
export { downloadJSON, readFileAsJSON } from './utils/file.js';
