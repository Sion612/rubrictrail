# Known limitations

1. **Confirmation, not semantic extraction.** Custom uploads and pasted text use
   conservative local parsing. Users must compare all confirmed fields and
   criteria with the authoritative assignment source.
2. **Manual draft judgment.** Custom-project self-checks record what a user
   selected; they do not verify argument quality, facts, citations or grades.
3. **No OCR.** Text PDFs, DOCX and TXT are supported. Scanned, encrypted or
   damaged documents receive a recovery path to another file or pasted text;
   RubricTrail does not extract text from the image itself.
4. **Partial recovery replaces the selection.** A mixed batch can continue with
   its readable subset after explicit confirmation. Choosing files again replaces
   the whole batch; it does not append one repaired file to the retained subset.
   Omitted files never contribute detected fields or evidence.
5. **Retained-output limits are not a full sandbox.** Count, byte and
   retained-text limits reduce resource risk, but DOCX decompression and PDF page
   extraction can consume CPU and peak memory before the retained-text limit is
   applied. Do not open deliberately malicious documents.
6. **Weight availability needs human confirmation.** A parser `null` means that
   RubricTrail did not confidently extract a weight; it does not prove that the
   school published no weights. Users must check the authoritative source and
   explicitly choose whether it contains a complete percentage breakdown. A
   published rubric must provide a positive weight for every criterion and total
   100% to weight the plan. An incomplete rubric retains known percentages and
   stores unknown values as `null`, but none of those values weights the plan;
   incomplete and unweighted rubrics use the same neutral planning starting
   point. Missing percentages are never guessed or automatically completed.
7. **Simple rubric parser.** Explicit lines such as `Analysis | 30%` work best.
   Complex tables may require manual repair in the confirmation screen.
8. **Manual portability only.** There is no account, automatic sync,
   collaboration or multi-project dashboard. Simultaneous tabs are detected and
   autosave is paused, but edits are not merged; download either version before
   choosing which one to keep. A versioned JSON backup can move one project
   between browsers, but it is not encrypted and must be kept private. The v3/v2
   lineage fingerprint, value comparisons and readback checks are best effort:
   `localStorage` has no transaction or atomic compare-and-swap across both keys,
   so a narrow race remains possible between separate operations.
9. **English-first.** Date parsing intentionally leaves ambiguous numeric dates
   blank; language, grading and citation conventions are not universal yet.
10. **Fictional sample only.** Sample Draft Check is a deterministic surface-signal
   demo, not semantic evaluation or a predicted grade.
11. **No public Live service.** The optional server adapter lacks the full rate,
   budget, abuse and consent controls required for a public deployment.

These boundaries are shown in the product and should not be hidden by downstream
deployments.
