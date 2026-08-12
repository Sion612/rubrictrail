# Verification report

Date: 12 August 2026
Runtime: Node.js 24 in CI, pnpm 11.9.0
Browser method: GitHub Actions Playwright projects at desktop and narrow
responsive Chromium sizes against a fresh production build served by
`next start`, plus the generated static demo served at `/rubrictrail`; see the
[v0.5.0 release-candidate verification run for commit
`4bcf77c`](https://github.com/Sion612/rubrictrail/actions/runs/31590279114)
and the [main-branch CI history](https://github.com/Sion612/rubrictrail/actions/workflows/ci.yml?query=branch%3Amain).

## Automated gates

| Command | Observed result |
| --- | --- |
| `pnpm lint` | Passed with zero warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 19 files, 261/261 tests passed |
| `pnpm build` | Next.js 16.3.0 production build passed independently in both CI jobs |
| `pnpm test:e2e --workers=1` | GitHub Actions: 28/28 executions passed through `next start` (14 scenarios × 2 Chromium projects) |
| `pnpm build:demo` | Static export for `/rubrictrail` completed successfully |
| `pnpm audit:demo` | Passed for all 29 exported files; no Live API path, OpenAI endpoint or Live credential/configuration marker found |
| `pnpm test:e2e:demo --workers=1` | GitHub Actions: 28/28 executions passed against the static `/rubrictrail` artifact (14 scenarios × 2 Chromium projects) |
| `pnpm audit --audit-level high` | No known vulnerabilities found |

Thirteen UI scenarios run at 1440×900 and a narrow responsive 390×844 Chromium
viewport, with targeted responsive checks narrowed to 320×700. One request-only
HTTP-contract scenario runs once per Chromium project without rendering a page.
The narrow project does not emulate a mobile user agent or touch device:

- sample evidence-to-progress flow and honest demo-signal language;
- planning-depth task scope, accessible explanation and refresh persistence
  without percentage-labelled grade targets;
- direct sample-to-own-assignment handoff with focus restoration;
- complete TXT upload, editable confirmation and local project creation;
- malformed UTF-8 TXT rejection before any project is created or saved;
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

The static suite repeats the 13 browser-local product scenarios above and adds
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
