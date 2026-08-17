# Verification report

Date: 17 August 2026
Runtime: bundled Node.js 24 locally; the repository remains pinned to pnpm
11.9.0 for CI and contributor installs.
Browser method: Playwright projects at desktop 1440×900 and narrow 390×844
Chromium sizes against a fresh production build served by `next start`, plus
the generated static demo served at `/rubrictrail`. Calendar scenarios freeze
Playwright's clock at 2026-08-17 so month expectations do not depend on the
wall-clock date.

## Current v0.7.1 candidate evidence

Date: 17 August 2026
Revision: isolated local candidate on top of the verified v0.7.0 main base.
This section records commands executed locally; it does not claim PR CI,
merged-main CI, or a public Pages deployment.

### Automated gates

| Command | Observed result |
| --- | --- |
| `pnpm check` | ESLint passed with zero warnings; TypeScript passed; 33 Vitest files / 387 tests plus 3 OCR asset-audit Node tests passed; the Next.js 16.3.0 production build passed |
| `pnpm audit --prod` | No known vulnerabilities found |
| `PAGES_BASE_PATH=/rubrictrail pnpm build:demo` | Static export completed successfully |
| `pnpm audit:demo` | Passed for 61 exported files; 14 initial JS/CSS files totalled 1,270,495 raw / 356,993 gzip bytes, below the unchanged 357,000-byte gzip budget; 10 deferred OCR files totalled 16,850,033 bytes and were absent from initial HTML |
| `PLAYWRIGHT_PRODUCTION=true PLAYWRIGHT_APP_PATH=/ pnpm test:e2e --workers=1` | 50/50 desktop and mobile Chromium executions passed through `next start` |
| `PLAYWRIGHT_APP_PATH=/rubrictrail/ pnpm test:e2e:demo --workers=1` | 50/50 desktop and mobile Chromium executions passed against the static `/rubrictrail` artifact |
| `git diff --check` | Passed with no whitespace errors |

The required autofocus regression was also run independently with
`--project=mobile-chrome --repeat-each=10 --workers=1`: 10/10 passed against
the fresh production server and 10/10 passed against the static demo. The
repeated runs used explicit focus and value assertions; no arbitrary sleep,
global timeout increase, or retry was added.

New v0.7.1 coverage includes the global Project Tracker from all five workflow
views, transient tracker state and focus restoration, task completion and
Open-in-task-list focus, empty/all-complete Calendar navigation, local ICS
export, the mobile tracker strip at 320px, and source-locator save/remove
failure accessibility and in-flight close protection. Tracker dates remain
derived from the existing Action Plan only; no new persistence or scheduling
schema was introduced.

The PR, remote CI, merged-main deployment, and public Pages smoke remain
unverified at this point.

This report describes the v0.7.0 release at exact main commit
[`3ee8b76`](https://github.com/Sion612/rubrictrail/commit/3ee8b76ee1c57a45f7ae1352a8c404f65c2ebd79).
[GitHub Actions run 31993864121](https://github.com/Sion612/rubrictrail/actions/runs/31993864121)
completed the quality, production-browser and static-demo gates on that
revision after one failed-job rerun.

Attempt 1 of that run kept `quality` and `pages-static` successful and failed
one production-browser execution: `[mobile-chrome] ›
tests/e2e/rubric-confirmation-hotfix.spec.ts:361` (`a two-page PDF rejects
page 3 before project creation`), with 47 passed and 1 failed. The same test
passed on `desktop-chrome` in that attempt and on both Chromium projects in
the already-successful `pages-static` job. Attempt 2 reran only the failed
browser job against the unchanged SHA
`3ee8b76ee1c57a45f7ae1352a8c404f65c2ebd79` and passed 48/48, including that
test. No third rerun was performed. The first-attempt failure is recorded as
a CI flake; product code was not changed.

## Automated gates

| Command | Observed result |
| --- | --- |
| `pnpm lint` | Exact-main GitHub Actions: passed with zero warnings |
| `pnpm typecheck` | Exact-main GitHub Actions: passed |
| `pnpm test` | Exact-main GitHub Actions: 31 Vitest files / 381 tests plus 3 OCR asset-audit Node tests passed |
| `pnpm test:deployment-smoke` | Exact-main GitHub Actions: 14/14 passed |
| `pnpm build` | Exact-main GitHub Actions: Next.js 16.3.0 production build passed |
| `pnpm test:e2e --workers=1` | Exact-main GitHub Actions attempt 2: 48/48 desktop and mobile Chromium executions passed through `next start` |
| `pnpm build:demo` | Exact-main GitHub Actions: static export for `/rubrictrail` completed successfully |
| `pnpm audit:demo` | Exact-main GitHub Actions: passed for 62 exported files; 14 initial JS/CSS files totalled 1,262,276 raw / 354,590 gzip bytes, below the unchanged 357,000-byte gzip budget |
| `pnpm test:e2e:demo --workers=1` | Exact-main GitHub Actions: 48/48 desktop and mobile Chromium executions passed against the static `/rubrictrail` artifact |
| `pnpm audit --audit-level high` | Exact-main GitHub Actions: no known vulnerabilities found |

New browser coverage in this release:

- post-creation Add / Edit / Remove of a manual source locator without
  confirming Check;
- PDF page bounds after project creation and before project creation;
- sample Calendar month navigation when the assignment deadline is outside
  the current planning month;
- browser-local `.ics` export of remaining tasks and the deadline, with no
  network `.ics` request;
- Calendar remains usable at 320px without document-level overflow;
- Calendar presentation is not persisted across reload;
- Playwright clock is frozen so Calendar month expectations do not depend on
  the wall-clock date;
- completing a Calendar task, rebalancing, and Open in task list focus;
- uploaded-project Chinese Calendar/ICS localization;
- an unchanged locator save does not clear a completed Check trail;
- changing a locator unconfirms only source-traceability and survives backup
  restore.

## Historical v0.6.0 exact-main evidence

Date: 15 August 2026
Runtime: bundled Node.js 24 locally; the repository remains pinned to pnpm 11.9.0
for CI and contributor installs.
Browser method: local Playwright projects at desktop 1440×900 and narrow
390×844 Chromium sizes against a fresh production build served by `next start`,
plus the generated static demo served at `/rubrictrail`. The bilingual scenario
also narrows the live viewport to 320×700 after restoring a saved project.

This report describes the v0.6.0 release candidate at exact main commit
[`67ff04a`](https://github.com/Sion612/rubrictrail/commit/67ff04a5ec77b847a00393c08414efd63ebc1967).
[GitHub Actions run 31880978874](https://github.com/Sion612/rubrictrail/actions/runs/31880978874)
completed the quality, production-browser and static-demo gates successfully on
that revision.

### Historical automated gates

| Command | Observed result |
| --- | --- |
| `pnpm lint` equivalent local CLI | Passed with zero warnings |
| `pnpm typecheck` equivalent local CLI | Passed with `--incremental false` |
| `pnpm test` equivalent local CLI | 26 files, 298/298 tests passed |
| `pnpm build` equivalent local CLI | Next.js 16.3.0 production build passed |
| `pnpm test:e2e --workers=1` | Exact-main GitHub Actions: 30/30 executions passed through `next start` (15 scenarios × 2 Chromium projects) |
| `pnpm build:demo` equivalent local CLI | Static export for `/rubrictrail` completed successfully |
| `pnpm audit:demo` | Exact-main GitHub Actions: passed for all 44 exported files; no Live API path, OpenAI endpoint or Live credential/configuration marker found; 14 initial JS/CSS files totalled 1,235,028 raw bytes and 346,687 gzip bytes, below the 357,000-byte gzip budget |
| `pnpm test:e2e:demo --workers=1` | Exact-main GitHub Actions: 30/30 executions passed against the static `/rubrictrail` artifact (15 scenarios × 2 Chromium projects) |
| `pnpm audit --audit-level high` | Passed after raising the transitive `nanoid@3` override to patched version 3.3.18; no known vulnerabilities found |

### Local image OCR candidate

The local image OCR worktree is intentionally separate from the published
v0.6.0 evidence above. On 16 August 2026 its final local verification observed:

| Command | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Passed with pnpm 11.9.0; deterministic OCR asset preparation also rechecked the pinned upstream files against recorded SHA-256 values |
| `pnpm audit --prod` | No known production dependency vulnerabilities found |
| `pnpm check` | ESLint passed with zero warnings; TypeScript passed; 27 Vitest files / 325 tests plus 3 OCR asset-audit Node tests passed; the Next.js 16.3.0 production build passed |
| `PAGES_BASE_PATH=/rubrictrail pnpm build:demo` | Static export completed successfully with same-origin worker, core and English/Simplified-Chinese language assets |
| `pnpm audit:demo` | Passed for 57 exported files; 14 initial JS/CSS files totalled 1,244,369 raw / 349,595 gzip bytes, below the unchanged 357,000-byte budget; 10 deferred OCR files totalled 16,850,033 bytes and were absent from initial HTML |
| `PLAYWRIGHT_PRODUCTION=true PLAYWRIGHT_APP_PATH=/ pnpm test:e2e --workers=1` | 34/34 desktop/mobile Chromium executions passed through `next start`, including a text-only zero-OCR-request check and real bilingual OCR with mixed-batch recovery |
| `PLAYWRIGHT_APP_PATH=/rubrictrail/ pnpm test:e2e:demo --workers=1` | 34/34 desktop/mobile Chromium executions passed against the static artifact, including same-origin worker/core/language requests and rejection of all cross-origin or API requests |

The exact-main pre-OCR baseline reported above was 1,235,028 raw / 346,687
gzip bytes. The candidate remains inside the unchanged budget at 1,244,369 raw /
349,595 gzip bytes; its separately reported OCR payload is lazy. A complete
fictional PNG OCR E2E took about 2.8–2.9 seconds in the final local Chromium
runs, including UI setup and recovery; this is an observation, not a general
performance benchmark. Tesseract emitted only its known missing legacy-language
parameter diagnostics for the pinned Chinese data; the narrow test allowlist
rejects any other console or page error.

These are local source, build and generated-artifact results. They do not claim
remote PR CI success or a merged/public Pages deployment; those require a future
PR head and post-merge deployment verification.

The final language-preference, notification, narrow-screen, accessibility,
phase-splitting and dependency-security changes were all included in the exact
main revision tested above.

### Issue #23 deployment reliability candidate

The Issue #23 working-tree change is intentionally separate from the exact-main
v0.6.0 evidence above. Its focused local verification on 15 August 2026
observed:

| Command | Observed result |
| --- | --- |
| `pnpm test:deployment-smoke` | 14/14 deterministic Node tests passed for the bounded candidate-created freshness query, exact candidate and workflow identity, `run_number`/rerun semantics, complete pagination without ordering assumptions, lifetime-history isolation, superseded and newer failed runs, workflow structure and least privilege, read-only API failure handling, marker validation, bounded retries, `src`/`href`/`srcset` same-origin assets and disabled Live paths |
| `PAGES_BASE_PATH=/rubrictrail pnpm build:demo` | Static export completed successfully |
| `pnpm audit:demo` | The normal 44-file export passed; the deployment-shaped 45-file export also passed after adding a marker containing only the current 40-character commit SHA |
| `pnpm check` | ESLint, TypeScript, 298/298 Vitest tests and the production build passed |
| `PLAYWRIGHT_APP_PATH=/rubrictrail/ pnpm test:e2e:demo --workers=1` | 30/30 static-demo Chromium executions passed against the generated artifact |

The deployment workflow now queries the read-only Actions API before building.
Successful and unsuccessful CI conclusions use separate concurrency groups,
and successful candidates use GitHub's documented maximum queue instead of the
single-pending default. A successful `main` push candidate can proceed only if
the same CI workflow has no successful run with a larger `run_number`; an older
candidate is recorded as superseded, while a newer failed run cannot replace a
queued successful candidate. The read-only query is bounded to runs created at
or after the triggering candidate, so the repository's lifetime successful-run
count cannot permanently exhaust GitHub's search limit. It reads and
deduplicates every page in that window instead of assuming API ordering, and it
validates the candidate's run ID, workflow ID, SHA, `run_number`, `run_attempt`
and original `created_at`. Because reruns retain `run_number` while incrementing
`run_attempt`, rerunning an older run cannot make it supersede a newer commit.
The check fails closed if the bounded window itself exceeds the documented
1,000-result search limit, or if pagination changes, is incomplete, or omits the
exact candidate. GitHub's paginated REST response is not a transactional
snapshot, so this is conservative consistency checking rather than an atomic
history read. The deployment artifact adds `deployment.txt`, whose complete
contents are the validated 40-character SHA. After `actions/deploy-pages`, a
separate read-only job performs bounded,
cache-busted GET checks for the homepage, marker and same-origin HTML-linked
`src`, `href` and `srcset` assets, plus GET and POST checks that both static Live
paths remain non-2xx.

These are local implementation and generated-artifact results. They do not
claim that the new post-deploy smoke has run against GitHub Pages; that requires
a future exact-main deployment workflow run.

The initial static JS/CSS measurement fell from the pre-splitting baseline of
1,318,791 raw / 368,095 gzip bytes to 1,235,028 raw / 346,687 gzip bytes: a
6.35% raw and 5.82% gzip reduction. This scoped pass did not meet a separate
10% target, so the report does not claim that it did; the audit budget gives
the measured gzip result about 3% build-to-build headroom while remaining below
the earlier baseline.

## Deployment evidence

[Deploy Pages run 31996091011](https://github.com/Sion612/rubrictrail/actions/runs/31996091011)
checked out, rebuilt and audited exact main SHA `3ee8b76`, then completed its
freshness, build, `github-pages` deployment and official live-smoke jobs. The
generated artifact, rather than the live host, is what passed the 48/48 static
CI browser executions.

A separate live HTTP smoke check observed:

- `https://sion612.github.io/rubrictrail/` at 200 over HTTPS;
- `https://sion612.github.io/rubrictrail/deployment.txt` equal to
  `3ee8b76ee1c57a45f7ae1352a8c404f65c2ebd79`;
- official `scripts/smoke-pages.mjs` passed after 1 attempt for that SHA,
  including same-origin HTML-linked assets;
- both absent `/rubrictrail/api/live/*` routes at 404 for GET and 405 for POST;
- a local public Playwright pass of 5/5 desktop Chromium executions against
  the live host for Calendar, local ICS download, empty-month navigation,
  320px Calendar use, and P0 source-locator Add / Edit / Remove.

GitHub Pages controls the live HTTPS, caching and response-header policy. The
live smoke check does not claim that Pages ran the complete browser suite or
inherits the Node runtime's configured headers.

The earlier v0.6.0 Pages record remains
[Deploy Pages run 31881113364](https://github.com/Sion612/rubrictrail/actions/runs/31881113364)
for SHA `67ff04a`.

## Current release browser coverage

The following scenarios describe the exact-main v0.7.0 runs shown in the
automated-gates table, including the inherited v0.6.0 coverage.

Twenty-three UI scenarios run at 1440×900 and a narrow responsive 390×844
Chromium viewport, with targeted bilingual and Calendar checks narrowed to
320×700. One request-only HTTP-contract scenario runs once per Chromium
project without rendering a page. The narrow project does not emulate a
mobile user agent or touch device:

- sample evidence-to-progress flow and honest demo-signal language;
- planning-depth task scope, accessible explanation and refresh persistence
  without percentage-labelled grade targets;
- direct sample-to-own-assignment handoff with focus restoration;
- complete TXT upload, editable confirmation and local project creation;
- malformed UTF-8 TXT rejection before any project is created or saved;
- English/Simplified Chinese switching, independent locale persistence, project
  and draft preservation across language changes and reload, and 320px overflow;
- mixed valid/unsupported file intake, explicit omission review, Back
  restoration and localStorage privacy;
- pasted brief and rubric intake, Back preservation and raw-text privacy;
- 320px paste and recoverable-error states with 16px textarea text;
- complete, partial and unweighted rubric confirmation without synthetic
  percentages, including retained partial values and neutral planning;
- portable project backup download, reset and restore;
- custom rubric source drawer, recorded-evidence trust copy and focus restoration;
- generic plan task completion and dependency behavior;
- custom evidence self-check and refresh persistence;
- explicit self-check Save waits for a confirmed browser write before reporting success;
- two same-revision tabs are serialized by the project lock so only one save wins;
- stale-tab edit, navigation and page-close protection plus explicit recovery;
- divergent v2/v3 browser state, exact older-version load and stable migration;
- missing-rubric manual repair without fabricated or equalized weights;
- unsupported-file and empty-draft recovery;
- production HTTP response headers, suppressed `X-Powered-By` and uncached
  `LIVE_DISABLED` responses from both optional Live routes;
- local image OCR stays deferred for text-only intake and runs same-origin
  bilingual recognition with mixed-batch recovery;
- source locators survive parsing, reload and backup restoration;
- a two-page PDF rejects page 3 before project creation;
- post-creation Add / Edit / Remove of a manual source locator without
  confirming Check;
- sample Calendar stays transient, exports a local `.ics` snapshot, keeps
  empty-month navigation and remains usable at 320px;
- console/page errors and document-level horizontal overflow.

The static suite repeats the 23 browser-local product scenarios above and adds
one static-export boundary scenario per viewport. It verifies that the app and
PDF worker load under `/rubrictrail`, that representative local workflows do
not request an API route or cross-origin resource, and that the exported
artifact can be served as files. It does not verify a public deployment. Static
hosting omits the Live endpoints and the Node runtime's configured response
headers; a future host controls those headers and receives ordinary page and
asset request metadata.

## Security checks

- Next.js upgraded from 16.2.10 to 16.3.0.
- PDF.js upgraded from 6.1.200 to 6.2.108.
- PDF scripting and evaluation are disabled.
- Real-file parsing stops above 200 pages per PDF or 400 discovered pages
  across the selected PDF set, and above 2,000,000 normalized characters,
  50,000 merged lines or 100,000 merged whitespace-delimited words. PDF text
  budgets are checked after each page so later pages are not read after a
  retained-text limit is exhausted.
- Pasted source intake is rejected above 100,000 characters or 10,000 lines
  before entering the existing bounded plain-text parser.
- Live routes reject disabled, unauthenticated, wrong-content-type and oversized
  requests before provider creation.
- Production-runtime smoke tests directly verify the configured anti-framing,
  MIME-sniffing, referrer and browser-capability headers, the absence of
  `X-Powered-By`, and the disabled branch of both Live routes. They do not claim
  CSP, HSTS, HTTPS or comprehensive security validation.
- Authoritative project records use revisions and tombstones under one exclusive
  Web Lock; retained v3/v2/v1 lineage is fingerprinted and divergence pauses
  writes for an explicit choice. Visibility and page-close saving remains
  best-effort, as documented in the security and limitations files.
- TXT parsing is strict UTF-8, and persisted evidence cross-checks bounded source
  IDs, safe filenames and retained excerpt spans while recovering the wider
  untrimmed-line spans written by early releases.
- Source scan found no committed key, token, private key, email or user-specific
  absolute path.

## Production visual evidence

- Local v0.6.0 candidate captures cover the Simplified Chinese welcome and
  sample workspace at 1440×900, 390×844 and 320×700. All six captures reported
  matching viewport/document widths, `lang="zh-CN"`, the localized title and no
  console or page errors. These local files are review evidence, not committed
  release assets.

- `docs/assets/rubrictrail-workspace.png`: 1440×900 production viewport with a
  source-linked rubric and the evidence drawer open.
- `docs/assets/rubrictrail-mobile.png`: 390×844 production viewport with the
  active workflow state, project context, confirmed weight and rubric summary.
- The existing production captures have no development badge, stale toast,
  preserved old scroll position or document-level horizontal overflow. The
  paste, mixed-batch, complete/not-complete weighting and v2/v3 conflict flows
  are functionally covered in CI but were not recaptured locally.

See `docs/VISUAL_QA_REPORT.md` for the concept-to-implementation comparison and
intentional responsive deviations.
