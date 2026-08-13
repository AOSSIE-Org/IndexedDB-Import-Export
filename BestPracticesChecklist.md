# AOSSIE Best Practices Checklist

> Criteria adapted from the [OpenSSF Best Practices Badge](https://github.com/coreinfrastructure/best-practices-badge)
> (MIT / CC BY 3.0) by OpenSSF contributors. Modified for AOSSIE multi-repo template use.
>
> **Purpose:** Covers OpenSSF Best Practices criteria that are NOT auto-detected by OpenSSF Scorecard.
> Scorecard already handles: License, SAST tools, CI tests, Security Policy file, Branch Protection,
> Pinned Dependencies, Signed Releases, Maintained status, and Known Vulnerabilities.
>
> **How to use:**
> 1. Fill in checkboxes below — tick `[x]` for Met, leave `[ ]` for Unmet, use `[~]` for N/A
> 2. Add a brief note or URL after each item as evidence
> 3. Run the checklist-score workflow to update the badge automatically
>
> **Legend:**
> - 🔴 MUST — Required for passing
> - 🟡 SHOULD — Required unless documented rationale given
> - 🔵 SUGGESTED — Optional but recommended
> - ⚪ N/A — Mark `[~]` if not applicable, add justification

---

## Score Summary

<!-- Auto-updated by checklist-score.yml workflow — do not edit manually -->

| Category           | Met | Total | Status |
|--------------------|-----|-------|--------|
| Basics             | 8   | 8     | ✅     |
| Change Control     | 5   | 6     | 🟡     |
| Reporting          | 5   | 8     | 🟡     |
| Quality            | 5   | 11     | 🔴     |
| Security           | 6   | 9     | 🟡     |
| Analysis           | 3   | 7     | 🔴     |
| **Total**          | **32** | **49** | **65%** |

---

## 🏗️ Basics

### Project Website & Documentation

- [x] 🔴 **description_good** — The project README/website clearly describes what the software does and what problem it solves.
  - *Evidence URL:* `README.md` — "What is this?" section

- [x] 🔴 **interact** — The project provides information on how to obtain the software, submit bug reports, and contribute.
  - *Evidence URL:* `README.md` (npm install), GitHub Issues, `CONTRIBUTING.md`

- [x] 🔴 **contribution** — `CONTRIBUTING.md` explains the contribution process (e.g., PRs are used, how to open one).
  - *Evidence URL:* `CONTRIBUTING.md` "Development Workflow" / "Pull Request Guidelines"

- [x] 🟡 **contribution_requirements** — `CONTRIBUTING.md` references acceptable contribution standards (coding style, tests required, etc.).
  - *Evidence URL:* `CONTRIBUTING.md` "Code Style Guidelines", "Test Your Changes"

- [x] 🔴 **documentation_basics** — Basic documentation exists for the software (README, Wiki, or docs folder).
  - *Evidence URL:* `README.md`, `AGENTS.md`

- [x] 🔴 **documentation_interface** — Reference documentation describes the external interface (API inputs/outputs, CLI flags, config schema, etc.).
  - *Evidence URL:* `README.md` "Usage" section documents `exportDB`, `importDB`, `downloadJSON`, and `readFileAsJSON` with working code examples.

### Other Basics

- [x] 🔴 **discussion** — Project has a searchable, URL-addressable discussion mechanism (GitHub Issues, Discord with archive, mailing list, etc.) that doesn't require proprietary client software.
  - *Evidence URL:* GitHub Issues; [#indexeddb-import-export Discord channel](https://discord.com/channels/1022871757289422898/1509409386102259803)

- [x] 🟡 **english** — Documentation is provided in English and English bug reports/comments are accepted.
  - *Note:* All docs and issues are in English.

---

## 🔄 Change Control

### Version Control

- [x] 🔵 **repo_distributed** — Project uses a distributed VCS (e.g., git). *(SUGGESTED)*
  - *Evidence URL:* GitHub repo, git history

### Version Numbering

- [x] 🔴 **version_unique** — Each release has a unique version identifier (e.g., v1.0.0).
  - *Evidence URL:* Git tags `v1.0.0`, `v1.0.1`; GitHub Releases

- [x] 🔵 **version_semver** — Project uses [SemVer](https://semver.org) or [CalVer](https://calver.org/) format. *(SUGGESTED)*
  - *Note:* Tags follow strict SemVer (`v1.0.0`, `v1.0.1`).

- [x] 🔵 **version_tags** — Releases are tagged in the VCS (e.g., `git tag v1.0.0`). *(SUGGESTED)*
  - *Evidence URL:* `git tag` output

### Release Notes

- [x] 🔴 **release_notes** — Each release includes human-readable release notes summarizing major changes. Raw `git log` output is NOT acceptable.
  - *Evidence URL:* `.github/release-drafter.yml` + `.github/workflows/release-drafter.yml` auto-generate categorized release notes from PR titles/labels.

- [ ] 🔴 **release_notes_vulns** — Release notes identify every publicly known vulnerability (with CVE) fixed in that release.
  - *Evidence URL:* `[~]` N/A — Justification: no publicly known/disclosed vulnerabilities to date.

---

## 🐛 Reporting

### Bug Reporting

- [x] 🔴 **report_process** — A bug-reporting process exists (e.g., GitHub Issues link in README).
  - *Evidence URL:* GitHub Issues; `.github/workflows/create-initial-issues.yml`

- [x] 🟡 **report_tracker** — An issue tracker (e.g., GitHub Issues) is used to track individual bugs.
  - *Evidence URL:* GitHub Issues

- [ ] 🔴 **report_responses** — A majority of bug reports submitted in the last 2–12 months have been acknowledged (response ≠ fix).
  - *Self-certification note:* Not yet assessed — needs maintainer review of issue history.

- [ ] 🟡 **enhancement_responses** — More than 50% of enhancement requests in the last 2–12 months have received a response.
  - *Self-certification note:* Not yet assessed.

- [x] 🔴 **report_archive** — Reports and responses are publicly archived and searchable (GitHub Issues satisfies this).
  - *Evidence URL:* GitHub Issues

### Vulnerability Reporting

- [ ] 🔴 **vulnerability_report_process** — A vulnerability reporting process is documented (e.g., `SECURITY.md`).
  - *Evidence URL:* Not present — no `SECURITY.md` in repo.

- [~] 🟡 **vulnerability_report_private** — If private vulnerability reporting is supported, the method for private submission is documented.
  - *Evidence URL:* N/A — Justification: no `SECURITY.md`/private channel documented yet.

- [~] 🔴 **vulnerability_report_response** — Initial response to any vulnerability report received in the last 6 months was within 14 days.
  - *Self-certification note:* N/A — Justification: no reports received (no vulnerability reporting process exists yet).

---

## ✅ Quality

### Build System

- [x] 🔴 **build** — If the project requires building, a working build system exists that can auto-rebuild from source.
  - *Evidence URL:* `package.json` — `npm run build` (tsup, ESM+CJS+d.ts)

- [x] 🔵 **build_common_tools** — Common build tools are used (npm, pip, cargo, make, gradle, etc.). *(SUGGESTED)*
  - *Evidence URL:* npm, tsup

- [x] 🟡 **build_floss_tools** — The project can be built using only FLOSS tools.
  - *Note:* npm/tsup/vitest are all FLOSS.

### Automated Testing

- [x] 🔵 **test_invocation** — The test suite can be invoked in a standard way for the language (e.g., `npm test`, `pytest`, `cargo test`). *(SUGGESTED)*
  - *Evidence URL:* `npm test` (Vitest) — real test suite exists: `tests/exporter.test.ts`, `tests/importer.test.ts`, `tests/round-trip.test.ts`, `tests/serialization.test.ts`, `tests/utils/file.test.ts`, `tests/utils/ssr.test.ts` (~1,100+ lines total).

- [ ] 🔵 **test_most** — The test suite covers most code branches, input fields, and functionality. *(SUGGESTED)*
  - *Estimated coverage %:* Not measured/published — no coverage script or reporting configured.

### New Functionality Testing Policy

- [ ] 🔴 **test_policy** — The project has a general policy that new functionality must include tests in the automated test suite.
  - *Evidence (CONTRIBUTING reference or informal policy):* Not formally documented — `CONTRIBUTING.md` describes how to run tests but doesn't mandate adding them for new functionality.

- [ ] 🔴 **tests_are_added** — Evidence exists that the test policy has been followed in recent major changes (e.g., PRs include tests).
  - *Evidence URL (recent PR with tests):* Not yet compiled — needs a sample PR link.

- [ ] 🔵 **tests_documented_added** — The test policy is documented in contribution instructions. *(SUGGESTED)*
  - *Evidence URL:* Not documented (see `test_policy` above).

### Linting / Warning Flags

- [x] 🔴 **warnings** — At least one linter or compiler warning flag is enabled (ESLint, Pylint, clippy, golangci-lint, Slither for Solidity, etc.).
  - *Tool used:* ESLint (`eslint.config.js`, `npm run lint` → `eslint src/ tests/`), with `@typescript-eslint/no-explicit-any: error`.

- [ ] 🔴 **warnings_fixed** — Warnings from the linter are addressed (not suppressed without reason).
  - *Note:* Not verified — no CI workflow currently runs `npm run lint` on PRs.

- [ ] 🔵 **warnings_strict** — Project uses maximum strictness in linter config where practical. *(SUGGESTED)*
  - *Note:* Not assessed.

---

## 🔐 Security

### Secure Development Knowledge

- [ ] 🔴 **know_secure_design** — At least one primary developer knows how to design secure software (familiar with OWASP, threat modeling, secure-by-default principles).
  - *Self-certification note:* To be self-certified by a maintainer.

- [ ] 🔴 **know_common_errors** — At least one primary developer knows common vulnerability types for this software's category and how to mitigate them (e.g., injection, XSS, reentrancy for Solidity, prompt injection for AI).
  - *Self-certification note:* To be self-certified by a maintainer.

### Cryptography (mark N/A if project does not handle cryptography)

- [~] 🔴 **crypto_published** — Only publicly reviewed cryptographic protocols/algorithms are used by default.
  - *Note:* N/A — This library does not implement or claim any cryptography; it serializes IndexedDB data to/from type-tagged JSON. Verified: no `encrypt`/`crypto`/`hash`/`password` references anywhere in `src/` or `README.md`.

- [~] 🟡 **crypto_call** — Project calls an established crypto library rather than reimplementing crypto functions.
  - *Library used:* N/A — no cryptography involved.

- [~] 🔴 **crypto_working** — No broken algorithms (MD4, MD5, single DES, RC4, Dual_EC_DRBG) used unless required for interoperability (must be documented).
  - *Note:* N/A — no cryptography involved.

- [~] 🔴 **crypto_keylength** — Key lengths meet [NIST 2030 minimums](https://www.keylength.com/en/4/) by default.
  - *Note:* N/A — no cryptography involved.

- [~] 🔴 **crypto_password_storage** — Passwords for external users are stored as iterated salted hashes (Argon2id, bcrypt, scrypt, PBKDF2).
  - *Note:* N/A — Justification: project doesn't handle user accounts or passwords.

- [~] 🔴 **crypto_random** — Cryptographic keys and nonces are generated using a CSPRNG; insecure generators (Math.random, rand()) are NOT used for security purposes.
  - *Note:* N/A — Justification: project doesn't generate any cryptographic keys or nonces.

- [ ] 🟡 **delivery_unsigned** — Cryptographic hashes are NOT retrieved over plain HTTP without a signature check.
  - *Note:* Not assessed.

---

## 🔬 Analysis

### Static Code Analysis

- [ ] 🔴 **static_analysis_fixed** — All medium+ severity vulnerabilities found by static analysis are fixed in a timely manner after confirmation.
  - *Note:* Not yet assessed — needs maintainer review of CodeQL alert history.

- [x] 🔵 **static_analysis_common_vulnerabilities** — The static analysis tool includes checks for common vulnerabilities in the language/environment (e.g., eslint-plugin-security, bandit, Slither). *(SUGGESTED)*
  - *Tool + ruleset:* CodeQL (`.github/workflows/codeql.yml`), default security query pack.

- [x] 🔵 **static_analysis_often** — Static analysis runs on every commit or at least daily (CI integration). *(SUGGESTED)*
  - *Evidence URL:* `.github/workflows/codeql.yml` — runs on every push/PR to `main` plus a weekly schedule.

### Dynamic Code Analysis

- [ ] 🔵 **dynamic_analysis** — At least one dynamic analysis tool is applied before major releases (fuzzer, web app scanner like OWASP ZAP, etc.). *(SUGGESTED)*
  - *Tool used:* Not currently used.

- [ ] 🔵 **dynamic_analysis_enable_assertions** — Dynamic analysis / testing runs with assertions enabled (not just production mode). *(SUGGESTED)*
  - *Note:* Not assessed.

- [ ] 🔴 **dynamic_analysis_fixed** — Medium+ severity vulnerabilities found by dynamic analysis are fixed in a timely manner.
  - *Note:* Not applicable yet — no dynamic analysis tool configured.

- [~] 🔵 **dynamic_analysis_unsafe** — If the project uses memory-unsafe languages (C/C++), memory safety tools (Valgrind, AddressSanitizer) are used. *(SUGGESTED)*
  - *Note:* N/A — Justification: project uses a memory-safe language (TypeScript).

---

## 📎 Project-Specific Notes

> Add domain-specific notes here for Web3, Full-Stack, or AI projects.

### SDK / Library Notes

- This is a browser-storage utility library with no cryptography surface — all `crypto_*` criteria are genuinely N/A, not just assumed.
- Biggest current gaps: no `SECURITY.md`, no CI step running `npm run lint` or `npm test` on every PR (tests currently only run as part of `version-release.yml`), and no test coverage measurement.
- No project-specific logo exists yet (see `README.md`'s `<!-- TODO: Replace with project logo once available -->` comment) — Project Branding requirements are tracked separately and are not yet satisfied.

---

*This checklist complements [OpenSSF Scorecard](https://scorecard.dev/) (auto-detected checks) and is
inspired by the [OpenSSF Best Practices Badge](https://www.bestpractices.dev/en/criteria/0) passing criteria.*
