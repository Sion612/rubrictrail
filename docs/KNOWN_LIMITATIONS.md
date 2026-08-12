# Known limitations

1. **Confirmation, not semantic extraction.** Custom uploads and pasted text use
   conservative local parsing. Users must compare all confirmed fields and
   criteria with the authoritative assignment source.
2. **Manual draft judgment.** Custom-project self-checks record what a user
   selected; they do not verify argument quality, facts, citations or grades.
3. **Planning depth is not a grade goal.** Choosing `focused`, `standard`,
   `thorough` or `extended` changes task scope and scheduling time allowance
   only. It does not express a target mark, estimate the likelihood of an
   outcome or predict a grade. State v3 retains the old numeric `targetGrade`
   field only as a backward-compatible internal encoding for that choice.
4. **No OCR.** Text PDFs, DOCX and TXT are supported. Scanned, encrypted or
   damaged documents receive a recovery path to another file or pasted text;
   RubricTrail does not extract text from the image itself.
5. **Partial recovery is explicit and per-file.** A mixed batch can continue
   with its readable subset only after explicit confirmation. This includes
   omitting one PDF above the 200-page per-file limit. Choosing files again
   replaces the whole batch; it does not append one repaired file to the
   retained subset. Omitted files never contribute detected fields or evidence.
   The 400-page selection limit and merged-text limits are fatal to the complete
   batch and never select later files for omission based on their order. Every
   selected PDF with readable page-count metadata contributes to the 400-page
   total, including one later offered for omission because it exceeds 200 pages.
6. **Resource limits are not a full sandbox.** Real-file intake is limited to 10
   files, 10 MiB each and 25 MiB combined; PDFs are limited to 200 pages each and
   400 pages per selection; merged text is limited to 2,000,000 normalized
   characters, 50,000 merged lines and 100,000 merged whitespace-delimited
   words. These checks reduce resource risk but do not cap CPU or peak memory.
   PDF metadata, one page's text items, and DOCX decompression may consume
   resources before the relevant limit is available. Parsing is currently not
   cancellable. The internal direct-string summary overload also applies the
   2,000,000-character ceiling to raw input before normalization. Do not open
   deliberately malicious documents.
7. **Weight availability needs human confirmation.** A parser `null` means that
   RubricTrail did not confidently extract a weight; it does not prove that the
   school published no weights. Users must check the authoritative source and
   explicitly choose whether it contains a complete percentage breakdown. A
   published rubric must provide a positive weight for every criterion and total
   100% to weight the plan. An incomplete rubric retains known percentages and
   stores unknown values as `null`, but none of those values weights the plan;
   incomplete and unweighted rubrics use the same neutral planning starting
   point. Missing percentages are never guessed or automatically completed.
8. **Simple rubric parser.** Explicit lines such as `Analysis | 30%` work best.
   Complex tables may require manual repair in the confirmation screen.
9. **Manual portability only.** There is no account, automatic sync,
    collaboration or multi-project dashboard. Simultaneous tabs are detected and
    autosave is paused, but edits are not merged; download either version before
    choosing which one to keep. A versioned JSON backup can move one project
    between browsers, but it is not encrypted and must be kept private. Current
    mutations use an exclusive Web Lock and monotonic authoritative-record
    revision, so two writes or a write and clear from one baseline cannot both
    win. This remains an application protocol, not a `localStorage` transaction
    or atomic compare-and-swap; older releases can still change compatibility
    keys, which fingerprint checks surface as conflicts or recovery candidates.
    An explicit reset removes the observed v3, v2 and v1 project values and keeps
    only a content-free tombstone, but a still-open older tab can write its key
    again afterward. Close older tabs before resetting sensitive work.
    Without Web Locks, mutation fails closed and edits remain only in that tab.
10. **Close-time saving is best effort.** Autosave waits 250 ms, while hidden-page
    and `pagehide` handlers start an asynchronous flush. A close during the
    debounce, browser shutdown or force-kill may stop that work and lose the last
    uncommitted edit. Download a backup before closing when the interface reports
    tab-only changes.
11. **Local-first is not complete offline support.** Files and project content are
    processed in the browser after the app loads, but there is no service worker
    guarantee that the application can be loaded or reopened without its host.
12. **English-first.** Date parsing intentionally leaves ambiguous numeric dates
    blank; language, grading and citation conventions are not universal yet.
13. **Fictional sample only.** Sample Draft Check is a deterministic surface-signal
    demo, not semantic evaluation or a predicted grade.
14. **No public Live service.** The optional server adapter lacks the full rate,
    budget, abuse and consent controls required for a public deployment.

These boundaries are shown in the product and should not be hidden by downstream
deployments.
