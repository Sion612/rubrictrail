# Verification report

Date: 12 August 2026
Runtime: Node.js 24 in CI, pnpm 11.9.0
Browser method: GitHub Actions Playwright projects at desktop and narrow
responsive Chromium sizes; see the [v0.3.4 exact-main verification run](https://github.com/Sion612/rubrictrail/actions/runs/31543389199)
and the [main-branch CI history](https://github.com/Sion612/rubrictrail/actions/workflows/ci.yml?query=branch%3Amain).

## Automated gates

| Command | Observed result |
| --- | --- |
| `pnpm lint` | Passed with zero warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 14 files, 157/157 tests passed |
| `pnpm build` | Next.js 16.3.0 production build passed |
| `pnpm test:e2e --workers=1` | GitHub Actions: 22/22 executions passed (11 scenarios × 2 Chromium viewports) |
| `pnpm audit --audit-level high` | No known vulnerabilities found |

The browser suite runs each scenario at 1440×900 and a narrow responsive
390×844 Chromium viewport, with targeted responsive checks narrowed to 320×700.
The narrow projects do not emulate a mobile user agent or touch device:

- sample evidence-to-progress flow and honest demo-signal language;
- direct sample-to-own-assignment handoff with focus restoration;
- complete TXT upload, editable confirmation and local project creation;
- mixed valid/unsupported file intake, explicit omission review, Back
  restoration and localStorage privacy;
- pasted brief and rubric intake, Back preservation and raw-text privacy;
- 320px paste and recoverable-error states with 16px textarea text;
- complete, partial and unweighted rubric confirmation without synthetic
  percentages, including retained partial values and neutral planning;
- portable project backup download, reset and restore;
- custom rubric source drawer and focus restoration;
- generic plan task completion and dependency behavior;
- custom evidence self-check and refresh persistence;
- stale-tab edit, navigation and page-close protection plus explicit recovery;
- divergent v2/v3 browser state, exact older-version load and stable migration;
- missing-rubric manual repair without fabricated or equalized weights;
- unsupported-file and empty-draft recovery;
- console/page errors and document-level horizontal overflow.

## Security checks

- Next.js upgraded from 16.2.10 to 16.3.0.
- PDF.js upgraded from 6.1.200 to 6.2.108.
- PDF scripting and evaluation are disabled.
- Pasted source intake is rejected above 100,000 characters or 10,000 lines
  before entering the existing bounded plain-text parser.
- Live routes reject disabled, unauthenticated, wrong-content-type and oversized
  requests before provider creation.
- State-v3 autosave, page-close flushing, restore and reset compare observed v3
  and retained-v2 values; detected divergence pauses writes for an explicit
  choice. Web Storage remains non-transactional, as documented in the security
  and limitations files.
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
