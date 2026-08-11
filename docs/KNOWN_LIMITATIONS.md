# Known limitations

1. **Confirmation, not semantic extraction.** Custom uploads use conservative
   local parsing. Users must compare all confirmed fields and criteria with the
   original files.
2. **Manual draft judgment.** Custom-project self-checks record what a user
   selected; they do not verify argument quality, facts, citations or grades.
3. **No OCR.** Text PDFs, DOCX and TXT are supported. Scanned, encrypted or
   damaged documents receive a recovery message.
4. **Simple rubric parser.** Explicit lines such as `Analysis | 30%` work best.
   Complex tables may require manual repair in the confirmation screen.
5. **Manual portability only.** There is no account, automatic sync,
   collaboration or multi-project dashboard. A versioned JSON backup can move one
   project between browsers, but it is not encrypted and must be kept private.
6. **English-first.** Date parsing intentionally leaves ambiguous numeric dates
   blank; language, grading and citation conventions are not universal yet.
7. **Fictional sample only.** Sample Draft Check is a deterministic surface-signal
   demo, not semantic evaluation or a predicted grade.
8. **No public Live service.** The optional server adapter lacks the full rate,
   budget, abuse and consent controls required for a public deployment.

These boundaries are shown in the product and should not be hidden by downstream
deployments.
