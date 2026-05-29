// TODO: SSR environment guards for Next.js / server-side compatibility
//
// Responsibilities:
// - isBrowser(): Check if code is running in a browser environment (typeof window !== 'undefined')
// - guardBrowser(): Throw or no-op when called outside a browser context
// - All core functions (exportDB, importDB) should use these guards
//   so the library safely no-ops during Next.js Server-Side Rendering
