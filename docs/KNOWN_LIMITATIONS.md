# Known limitations

1. **Calendar dates are targets, not appointments.** The Plan Calendar and `.ics`
   export use each task's target completion date. RubricTrail does not invent
   study-time blocks, reminders, provider sync or subscription URLs. Importing
   an `.ics` file may cause an external calendar provider to store assignment
   metadata.

   The Project Tracker is an execution surface, not a sixth workflow stage. It
   stays available across the five workflow views, but its summary, drawer
   state, visible month, selected date and temporary task focus are not saved in
   the project or backup. It derives dates only from the existing Action Plan
   and assignment deadline.
2. **Older projects cannot guess sources.** Projects saved before the compact
   source registry cannot add a locator until the original files are re-imported.
3. **Confirmation, not semantic extraction.** Custom uploads and pasted text use
   conservative local parsing. Users must compare all confirmed fields and
   criteria with the authoritative assignment source.
4. **Manual draft judgment.** Custom-project self-checks record what a user
   selected; they do not verify argument quality, facts, citations or grades.
5. **Planning depth is not a grade goal.** Choosing `focused`, `standard`,
   `thorough` or `extended` changes task scope and scheduling time allowance
   only. It does not express a target mark, estimate the likelihood of an
   outcome or predict a grade. State v3 retains the old numeric `targetGrade`
   field only as a backward-compatible internal encoding for that choice.
6. **Image OCR is bounded and probabilistic.** PNG, JPEG and WebP files use
   local English and Simplified Chinese OCR. Results can be wrong, especially
   for handwriting, low contrast, unusual layouts or other scripts, so every
   OCR-derived field and excerpt must be checked against the original image.
   Scanned PDFs are not rasterized for OCR; export only the relevant page as a
   supported image or paste the text. Encrypted or damaged documents receive a
   recovery path to another file or pasted text.
   HEIC/HEIF, AVIF, GIF, TIFF, BMP and SVG are not accepted. There is no
   handwriting, equation, diagram, chart or semantic-image understanding
   guarantee, and Chinese OCR does not make field extraction fully optimized
   for Chinese assignments.
   TXT files must be valid UTF-8; files saved in another encoding are rejected
   with instructions to save a UTF-8 copy or paste the text.
7. **Partial recovery is explicit and per-file.** A mixed batch can continue
   with its readable subset only after explicit confirmation. This includes
   omitting one PDF above the 200-page per-file limit. Choosing files again
   replaces the whole batch; it does not append one repaired file to the
   retained subset. Omitted files never contribute detected fields or evidence.
   The 400-page selection limit and merged-text limits are fatal to the complete
   batch and never select later files for omission based on their order. Every
   selected PDF with readable page-count metadata contributes to the 400-page
   total, including one later offered for omission because it exceeds 200 pages.
8. **Retained excerpts are not the authoritative source.** RubricTrail validates
   the compact source label and excerpt shape when saving or restoring, but it
   discards full source text and cannot later re-verify the excerpt against the
   original document. Re-check the original before relying on it.
9. **Resource limits are not a full sandbox.** Real-file intake is limited to 10
   files, 10 MiB each and 25 MiB combined; PDFs are limited to 200 pages each and
   400 pages per selection; merged text is limited to 2,000,000 normalized
   characters, 50,000 merged lines and 100,000 merged whitespace-delimited
   words. These checks reduce resource risk but do not cap CPU or peak memory.
   Images are limited to 16,384 pixels per side and 20,000,000 decoded pixels,
   but decoding and recognition still use substantial CPU and memory. PDF
   metadata, one page's text items, and DOCX decompression may consume
   resources before the relevant limit is available. Parsing is currently not
   cancellable. The internal direct-string summary overload also applies the
   2,000,000-character ceiling to raw input before normalization. Do not open
   deliberately malicious documents.
10. **Weight availability needs human confirmation.** A parser `null` means that
   RubricTrail did not confidently extract a weight; it does not prove that the
   school published no weights. Users must check the authoritative source and
   explicitly choose whether it contains a complete percentage breakdown. A
   published rubric must provide a positive weight for every criterion and total
   100% to weight the plan. An incomplete rubric retains known percentages and
   stores unknown values as `null`, but none of those values weights the plan;
   incomplete and unweighted rubrics use the same neutral planning starting
   point. Missing percentages are never guessed or automatically completed.
11. **Simple rubric parser.** Explicit lines such as `Analysis | 30%` work best.
   Complex tables may require manual repair in the confirmation screen.
12. **Multi-assignment remains manual, browser-local portability.** The My
    Assignments Dashboard and cross-assignment Up Next list work only with this
    browser's validated local records. There is no account, automatic sync,
    collaboration, cross-device workspace, reminder service, provider sync, or
    whole-workspace backup. A versioned JSON backup moves one selected assignment
    at a time and may be restored as new or used to replace the explicitly
    selected assignment. It is neither encrypted nor signed; validation checks
    format and structure, not authorship.

    Current-version authoritative mutations require the exclusive
    `rubrictrail.project.store.v1` Web Lock. Same-project conflicts are surfaced,
    not merged; different-project writes serialize through the global lock but
    preserve separate records. This is an application protocol, not a
    `localStorage` transaction. Without Web Locks, projects remain readable and
    exportable but mutation fails closed and edits stay only in that tab.

    Existing v0.7.x values remain after first migration until separately
    confirmed exact cleanup. A still-open old tab can rewrite one of those keys;
    v0.8.0 detects the changed fingerprint and requires an explicit conflict
    choice, but cannot stop already-running old code. Close older tabs before
    migration or privacy cleanup.
13. **Workspace limits are policy, not quota guarantees.** v0.8.0 recommends
    generation compaction at 64 tombstones, shows a persistent warning at 80
    total records, blocks create/restore-as-new at 96, and rejects a 101st record
    beyond the 100-record hard limit. `localStorage` quota, accounting, eviction,
    partitioning and private-mode behavior vary by browser, so a project within
    product character limits may still fail to save. A quota failure does not
    evict or truncate another assignment. When the verified reserve cannot be
    re-established, the workspace enters a degraded read/export mode.
14. **Close-time saving is best effort.** Autosave waits 250 ms, while hidden-page
    and `pagehide` handlers start an asynchronous flush. A close during the
    debounce, browser shutdown or force-kill may stop that work and lose the last
    uncommitted edit. Download a backup before closing when the interface reports
    tab-only changes.
15. **Local-first is not complete offline support.** Files and project content are
    processed in the browser after the app loads, but there is no service worker
    guarantee that the application can be loaded or reopened without its host.
16. **Bilingual interface is not source translation.** The single application
    URL supports English and Simplified Chinese product controls and stores that
    preference separately from projects and backups. Uploaded or pasted source
    content, project titles, course names, criteria, excerpts and draft notes
    remain exactly as entered. Automatic field extraction is still optimized
    for English materials, and date parsing intentionally leaves ambiguous
    numeric dates blank. Chinese materials require manual confirmation. There is
    no separate `/zh-CN` route or language-specific server-rendered page, and the
    optional Live API's machine-readable errors remain English.
17. **Fictional sample only.** Sample Draft Check is a deterministic surface-signal
    demo, not semantic evaluation or a predicted grade.
18. **No global Calendar or manually created tasks.** Calendar, `.ics`, Project
    Tracker, task completion and backups remain assignment-level. Up Next derives
    only from real Action Plan tasks and deadlines. v0.8.0 does not add arbitrary
    manual tasks, study-time appointments, a cross-assignment month view,
    reminders, subscription feeds, or provider integration.
19. **No public Live service.** The optional server adapter lacks the full rate,
    budget, abuse and consent controls required for a public deployment.
20. **The public demo is static-only.** It is deployed at
    <https://sion612.github.io/rubrictrail/>, omits the Live API and Node
    response-header configuration, and is subject to GitHub Pages' HTTPS,
    caching and response-header policy. GitHub still receives ordinary page and
    asset request metadata. The dated
    [Firefox and Playwright WebKit checklist](./BROWSER_COMPATIBILITY.md) is
    narrow evidence rather than a blanket support claim; Playwright WebKit is
    not Safari.
21. **Browser storage is origin-scoped.** `localStorage` is shared by scripts on
    the same origin; the `/rubrictrail` path is not an isolation boundary. Do not
    colocate the demo with unrelated or untrusted scripts when project content is
    sensitive.

These boundaries are shown in the product and should not be hidden by downstream
deployments.
