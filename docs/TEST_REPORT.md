# Verification report

Date: 12 August 2026  
Runtime: Node.js 24.14.0, pnpm 11.16.0  
Browser method: GitHub Actions Playwright projects at desktop and mobile sizes;
see the [v0.3.1 verification run](https://github.com/Sion612/rubrictrail/actions/runs/31530109157)

## Automated gates

| Command | Observed result |
| --- | --- |
| `pnpm lint` | Passed with zero warnings |
| `pnpm typecheck` | Passed |
| `pnpm test` | 14 files, 99/99 tests passed |
| `pnpm build` | Next.js 16.3.0 production build passed |
| `pnpm test:e2e --workers=1` | GitHub Actions: 14/14 desktop/mobile flows passed |
| `pnpm audit --audit-level high` | No known vulnerabilities found |

The browser suite runs each scenario at 1440×900 and 390×844:

- sample evidence-to-progress flow and honest demo-signal language;
- direct sample-to-own-assignment handoff with focus restoration;
- complete TXT upload, editable confirmation and local project creation;
- pasted brief and rubric intake, Back preservation and raw-text privacy;
- 320px paste and recoverable-error states with 16px textarea text;
- portable project backup download, reset and restore;
- custom rubric source drawer and focus restoration;
- generic plan task completion and dependency behavior;
- custom evidence self-check and refresh persistence;
- missing-rubric manual repair with an enforced 100% total;
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
- Source scan found no committed key, token, private key, email or user-specific
  absolute path.

## Production visual evidence

- `docs/assets/rubrictrail-workspace.png`: 1440×900 production viewport with a
  source-linked rubric and the evidence drawer open.
- `docs/assets/rubrictrail-mobile.png`: 390×844 production viewport with the
  active workflow state, project context, confirmed weight and rubric summary.
- The existing production captures have no development badge, stale toast,
  preserved old scroll position or document-level horizontal overflow. The new
  paste flow is functionally covered in CI but was not recaptured locally.

See `docs/VISUAL_QA_REPORT.md` for the concept-to-implementation comparison and
intentional responsive deviations.
