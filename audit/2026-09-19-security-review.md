# Security Review — 2026-09-19

**Scope:** Full repository review, covering `src/` (the library source), CI/CD
workflows in `.github/workflows/`, and configuration files.

**Project type detected:** Plain TypeScript library (no framework signals for
Next.js, Svelte, Python, Go, Flutter, or Solidity/ErgoScript were found), so
only the general security checklist applies.

**Commit reviewed:** `9a9dc4b112c11306824d9c14ce2d5c600d7cd865` (HEAD of `main`)

## Files examined

- `src/core/exporter.ts`
- `src/core/importer.ts`
- `src/core/migrations.ts`
- `src/serialization/index.ts`
- `src/types/index.ts`
- `src/utils/file.ts`
- `src/utils/ssr.ts`
- `.github/workflows/*.yml` (all workflows, with particular attention to the
  three using `pull_request_target`: `danger.yml`, `label-merge-conflicts.yml`,
  `sync-pr-labels.yml`)
- `dangerfile.js`, `package.json`
- Repo-wide grep for hardcoded secrets/credentials

## Findings

No findings met the 0.7 confidence threshold used by this review. Details:

- **Deserialization / prototype pollution:** The serializer builds objects
  with `Object.create(null)`, and `deserialize` recurses into `Object.keys`,
  so a malicious backup JSON containing a `"__proto__"` key cannot pollute
  `Object.prototype` — assignment to a null-prototype object's `"__proto__"`
  key is a plain data property, not the accessor on `Object.prototype`. This
  is a deliberate, correctly implemented defense
  (`src/serialization/index.ts:43-46`).
- **`JSON.parse` usage** (`src/utils/file.ts:66`) is inherently safe against
  prototype pollution (`CreateDataProperty` semantics), and there is no
  `eval`/`Function`/`vm` usage anywhere in the codebase.
- **`src/core/migrations.ts`** is an empty TODO stub — there is no runtime
  schema validation on imported backups. This only affects the same
  user's own IndexedDB via a file they choose to import themselves; there is
  no cross-privilege or cross-origin exploit path, so this is a robustness
  gap rather than a vulnerability.
- **CI workflows using `pull_request_target`:** All three checkout only the
  base branch (or don't check out code at all) and never execute
  PR-supplied code. `github-script` steps read `context.payload.pull_request.*`
  via runtime JS rather than splicing untrusted values into `${{ }}` template
  expressions or shell `run:` blocks, so there is no script-injection path
  despite the elevated token permissions.
- No hardcoded secrets, no unsafe `subprocess`/shell execution, and no
  install-time scripts in `package.json`.

## Limitations

This review is a targeted, automated pass using the `security-review` skill's
general checklist. It does not replace a full manual audit or a penetration
test, particularly for how consuming applications might misuse this
library's outputs.
