# Fictional DOCX regression fixture

`fictional-paragraph-table.docx` is a minimal, synthetic OOXML document reused
unchanged from the 31 October 2026 DOCX follow-up evidence bundle, at
`docx-followup/fixtures/fictional-paragraph-table.docx`. It contains no real
student work, personal information, or private course material.

- Size: 1,609 bytes.
- SHA-256: `0d0256c4dfe272f049dd1f5f8b2a812a5014713f551d569dad3d1090825e2bd2`.
- Assignment: `Fictional DOCX Paragraph & Table Review`, due 24 September 2027,
  1,500 words, APA 7. The course line is `DOCX101 Fictional Evidence`; the current
  intake leaves the course field empty for the user to confirm manually.
- One real two-row Word table contains `Table Analysis | 60%` and
  `Table Evidence 中文 | 40%`, with `TABLE_CELL_ALPHA` and `TABLE_CELL_BETA` in
  the second column. Text is split across XML runs and includes Chinese and `&`.
- The final paragraph, `PRIVATE_UNRETAINED_DOCX_PARAGRAPH_Z9`, is a synthetic
  marker outside the retained excerpts. It must not enter persisted state.

`tests/e2e/docx-intake.spec.ts` uploads these bytes through the real browser
parser without mocking Mammoth. The damaged DOCX payload is generated in memory
from the first 100 bytes of this fixture; no second binary fixture is needed.
It exercises single-file recovery and explicit acceptance of a readable subset.

The production Playwright configuration discovers the spec automatically; the
static-demo configuration includes it in `testMatch`. Both reuse the existing
desktop and narrow-screen projects. Run against a production build and a static
build served under `/rubrictrail/`; set `PLAYWRIGHT_PRODUCTION=true` for the
production run and `PLAYWRIGHT_APP_PATH=/rubrictrail/` for the static run.
