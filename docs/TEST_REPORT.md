# Verification report

Date: 15 August 2026
Runtime: bundled Node.js 24 locally; the repository remains pinned to pnpm 11.9.0
for CI and contributor installs.
Browser method: local Playwright projects at desktop 1440×900 and narrow
390×844 Chromium sizes against a fresh production build served by `next start`,
plus the generated static demo served at `/rubrictrail`. The bilingual scenario
also narrows the live viewport to 320×700 after restoring a saved project.

This report describes the v0.6.0 branch candidate before remote CI. It is not a
public deployment or release evidence. The last published exact-main
baseline remains the [v0.5.0 run for commit
`b8d80b0`](https://github.com/Sion612/rubrictrail/actions/runs/31593393903);
future v0.6.0 publication must replace this paragraph with the exact merged
candidate SHA and remote run links.

## Automated gates

| Command | Observed result |
| --- | --- |
| `pnpm lint` equivalent local CLI | Passed with zero warnings |
| `pnpm typecheck` equivalent local CLI | Passed with `--incremental false` |
| `pnpm test` equivalent local CLI | 26 files, 298/298 tests passed |
| `pnpm build` equivalent local CLI | Next.js 16.3.0 production build passed |
| `pnpm test:e2e --workers=1` equivalent local CLI | Earlier local v0.6.0 candidate: 30/30 executions passed through `next start` (15 scenarios × 2 Chromium projects); not rerun after the final hardening edits |
| `pnpm build:demo` equivalent local CLI | Static export for `/rubrictrail` completed successfully |
| `pnpm audit:demo` equivalent local CLI | Passed for all 44 exported files; no Live API path, OpenAI endpoint or Live credential/configuration marker found; 14 initial JS/CSS files totalled 1,234,982 raw bytes and 346,655 gzip bytes, below the 357,000-byte gzip budget |
| `pnpm test:e2e:demo --workers=1` equivalent local CLI | Earlier local v0.6.0 candidate: 30/30 executions passed against the static `/rubrictrail` artifact (15 scenarios × 2 Chromium projects); not rerun after the final hardening edits |
| `pnpm audit --audit-level high` | Not rerun for this branch candidate; dependency pins and lockfile are unchanged from the published zero-known-vulnerability baseline |

The final language-preference, notification, narrow-screen, accessibility and
phase-splitting changes were rechecked with unit/component tests, lint, type
checking, the Node build, the static export and the static-artifact audit.
Playwright was not rerun for those final edits, so the two browser rows remain
earlier local-candidate evidence rather than a release gate for the current
working tree.

The initial static JS/CSS measurement fell from the pre-splitting baseline of
1,318,791 raw / 368,095 gzip bytes to 1,234,982 raw / 346,655 gzip bytes: a
6.35% raw and 5.82% gzip reduction. This scoped pass did not meet a separate
10% target, so the report does not claim that it did; the audit budget gives
the measured gzip result about 3% build-to-build headroom while remaining below
the earlier baseline.

## Deployment evidence

[Deploy Pages run 31593580751](https://github.com/Sion612/rubrictrail/actions/runs/31593580751)
checked out, rebuilt and audited the same tagged release SHA `b8d80b0`, then completed
both its build and `github-pages` deployment jobs. The generated artifact, rather
than the live host, is what passed the 28/28 static CI browser executions.

A separate live HTTP smoke check observed:

- `https://sion612.github.io/rubrictrail/` at 200 over HTTPS;
- all 11 static resources linked by the exported HTML at 200;
- the same-origin `/rubrictrail/_next/static/media/pdf.worker*.mjs` at 200 with a
  JavaScript content type;
- both absent `/rubrictrail/api/live/*` routes at 404 for GET and 405 for POST.

GitHub Pages controls the live HTTPS, caching and response-header policy. The
live smoke check does not claim that Pages ran the complete browser suite or
inherits the Node runtime's configured headers.

## Current local candidate browser coverage

The following scenarios describe the earlier local v0.6.0 candidate runs shown
in the automated-gates table. They are not evidence for the currently deployed
v0.5.0 artifact and were not rerun after the final hardening changes.

Fourteen UI scenarios run at 1440×900 and a narrow responsive 390×844 Chromium
viewport, with targeted bilingual checks narrowed to 320×700. One request-only
HTTP-contract scenario runs once per Chromium project without rendering a page.
The narrow project does not emulate a mobile user agent or touch device:

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
- console/page errors and document-level horizontal overflow.

The static suite repeats the 14 browser-local product scenarios above and adds
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
