# AGENTS.md

Instructions for AI coding agents working in this repository.

## Project Overview

`@aossie-org/idb-backup` is a framework-agnostic TypeScript library for exporting and importing IndexedDB databases via type-tagged JSON. It wraps the native IndexedDB API using [`idb`](https://github.com/jakearchibald/idb).

## Repository Layout

- `src/` — library source (TypeScript)
- `tests/` — Vitest test suite (`happy-dom` + `fake-indexeddb` for browser-API emulation)
- `public/` — org logo assets referenced by README (no project-specific logo exists yet)
- `dist/` — build output (generated, not committed source)

## Build, Test & Lint

```bash
npm install
npm run build          # tsup — builds ESM + CJS with type declarations
npm test                # vitest run
npm run test:watch      # vitest watch mode
npm run lint            # eslint src/ tests/
npm run format           # prettier --write
npm run format:check     # prettier --check
```

## Conventions

- The only runtime dependency is `idb` — don't add another runtime dependency without discussing it in an issue first; devDependencies for build/test tooling are fine.
- The package ships both ESM and CJS builds with TypeScript declarations (via `tsup`) — don't introduce APIs that only work in one module format.
- New functionality needs tests in `tests/` using Vitest; use `fake-indexeddb`/`happy-dom` to emulate the browser APIs rather than requiring a real browser.
