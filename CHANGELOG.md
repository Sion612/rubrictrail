# Changelog

All notable changes will be recorded here. Versions follow Semantic Versioning.

## [Unreleased]

## [0.8.2] - 2026-08-31

### Added

- Added GitHub Pages-only sharing and crawler metadata: the exact public-demo
  canonical, Open Graph and Twitter cards, the existing same-origin favicon,
  project-level robots guidance, and a one-URL sitemap.
- Added a deterministic 1200 × 630 social image generated from the repository's
  fictional LumaLane sample during the static-demo build.
- Added a reproducible browser checklist with dated Firefox and Playwright
  WebKit evidence for public revision
  `0d9255bfe7724d1de72a8027ea3b1c9582a33962`. This evidence predates the
  v0.8.2 release target; Playwright WebKit is not Safari and the checklist is
  not a blanket browser-support claim.

### Fixed

- Creating a new assignment or restoring a backup as new now safely reactivates
  a strictly cleared empty workspace after whole-workspace privacy deletion.
  The cleared index remains authoritative until the new project record and
  active target index have passed the existing lock, journal, digest, reserve,
  and readback checks.
- Reflowed the Project Tracker summary at 320 px so its existing metrics sit
  below the title and the task summary retains readable width in English and
  Simplified Chinese without document overflow.

### Privacy / Integrity

- Public-demo metadata and preview assets remain same-origin and use only
  fictional repository material. No account, analytics, telemetry, remote
  storage, or public Live AI runtime was added.
- No persistence schema, project-state version, single-project backup v1
  format, or dependency change was introduced.

### Limitations

- Metadata can improve link previews and crawler clarity but does not guarantee
  preview refresh, indexing, ranking, or adoption. A project-level
  `/rubrictrail/robots.txt` cannot control the user-site origin-root
  `robots.txt`.
- The dated Firefox and Playwright WebKit checklist covers one pre-release
  public revision on Windows. It adds neither browser to CI and provides no
  Safari, macOS, iOS, physical-device, accessibility, or blanket compatibility
  certification.

## [0.8.1] - 2026-08-21

### Fixed

- Calendar **Today** navigation and its distinct marker now follow the actual
  browser-local date, while the planning baseline remains stable and clearly
  labelled.
- Calendar, Project Tracker, Dashboard, and Up Next overdue states now advance
  with real time without automatically moving existing task target dates.
- Existing uploaded projects normalize their already-supported persisted
  creation instant to a stable UTC calendar date; the original browser timezone
  was not historically persisted.

## [0.8.0] - 2026-08-21

### Added

- Added a top-level **My Assignments** Dashboard with assignment cards,
  deadlines, progress, blocked/overdue status, and a cross-assignment **Up
  Next** list derived only from real Action Plan tasks.
- Added a prominent **New assignment** flow for uploaded files, pasted details,
  or restoring an existing single-project backup as a new independent
  assignment.
- Added safe project switching and browser-local multi-assignment persistence
  with one validated record namespace per assignment.
- Added a journaled first-run migration that preserves a valid v0.7.1 project
  as one workspace assignment and retains the legacy values for older-tab
  detection until the user explicitly cleans them up.
- Added explicit project replacement, deletion, storage compaction, legacy
  cleanup, whole-workspace privacy deletion, and index-recovery interfaces with
  exact-scope confirmation and fail-closed recovery.

### Changed

- RubricTrail now opens at workspace scope. The existing per-assignment Brief,
  Rubric, Plan, Check, Progress, Project Tracker, Calendar, and local `.ics`
  workflow remains assignment-level and keeps its existing state semantics.
- Browser persistence now uses a small authoritative workspace index,
  namespaced project records, a bounded operation journal, a storage reserve,
  and a best-effort last-opened preference. Authoritative mutations still
  require the existing exclusive Web Lock.
- Single-project backup format v1 remains unchanged. Restore can add a new
  assignment or explicitly replace the selected assignment; v0.8.0 does not
  introduce a whole-workspace backup format.

### Privacy / Integrity

- All assignment data remains browser-local by default. v0.8.0 adds no account,
  cloud sync, analytics, remote asset, public Live AI, or provider Calendar
  integration.
- Assignment records are isolated by workspace namespace. Normal edits replace
  only the selected assignment record and do not rewrite unrelated projects or
  duplicate Dashboard summaries in the index.
- Original files and full uploaded, pasted, or OCR transcripts are still not
  stored. Existing compact fields, source labels, bounded excerpts, drafts,
  progress, and manual source locators retain their current project-level
  privacy boundary.
- Old v0.7.x data is retained unchanged after migration until separately
  confirmed exact legacy cleanup or whole-workspace privacy deletion. Older-tab
  rewrites are surfaced as conflicts and are never silently adopted or erased.

### Limitations

- The product policy recommends compaction at 64 tombstones, warns at 80 total
  records, blocks growth at 96, and rejects a 101st record beyond the hard
  100-record generation limit. These thresholds are not browser quota
  guarantees; available `localStorage` capacity varies by browser and context.
- Authoritative mutation requires Web Locks. Without them, validated projects
  remain readable/exportable but mutations fail closed.
- v0.8.0 has no global Calendar, reminders, provider sync, cloud/account sync,
  manual task creation, or whole-workspace backup. Calendar and `.ics` remain
  per assignment.
- Simultaneously open v0.7.x tabs can rewrite legacy keys. v0.8.0 detects this
  drift and requires an explicit recovery choice; it cannot prevent older code
  from attempting the write.

## [0.7.1] - 2026-08-18

### Changed

- Promoted Calendar from a Plan-only presentation into a project-wide Project
  Tracker available from Brief, Rubric, Plan, Check and Progress.
- Simplified Plan back to its execution task list while keeping a shortcut to
  the global Tracker.

### Fixed

- Stabilized the rubric-confirmation browser path after adding a criterion by
  asserting focus and exact field values before entering weights.
- Tracker next-target ties now follow the Action Plan task order, and Calendar
  reconciliation preserves intentional empty-month browsing after task changes.
- Improved source-locator save/remove failure recovery and accessibility: the
  panel stays open, entered values remain available, failures are announced,
  and the page field receives focus for invalid PDF pages.

### Privacy / Integrity

- Tracker summaries and open state remain transient React UI state. The
  existing Action Plan remains the only source of Calendar dates and `.ics`
  events; no appointments or dates are invented.
- Source registries, retained evidence and manual locators share the canonical
  `source-1` through `source-10` boundary while preserving valid input-index
  gaps and legacy projects without compact sources.
- CI and Pages builds disable framework telemetry with
  `NEXT_TELEMETRY_DISABLED=1`.

## [0.7.0] - 2026-08-17

### Added

- Added lazy, same-origin, browser-local English and Simplified Chinese OCR for
  PNG, JPEG and WebP assignment screenshots and photos, with visible progress,
  explicit OCR provenance and mixed-batch recovery.
- Added deterministic local OCR asset preparation/integrity auditing and real
  desktop/mobile static-demo coverage that rejects cross-origin and Live-route
  requests while exercising the worker, core and both language models.
- Added a compact source registry and full-flow rubric source traceability from
  intake through backup restore.
- Added post-creation Add, Edit and Remove actions for manual source locators
  without turning Rubric into a general criterion editor.
- Added a Plan Calendar month view and selected-week agenda derived from the
  existing Action Plan.
- Added a browser-local `.ics` export of remaining plan tasks and the
  assignment deadline.

### Changed

- Rubric source buttons now name the available action: add, view/edit, or view
  retained evidence.
- Duplicate source filenames stay distinguishable by canonical source number.
- Rebalancing updates both the task list and Calendar because both views read
  the same Action Plan.

### Fixed

- Fixed rubric confirmation so missing-evidence guidance and aggregate weight
  errors use readable section-level layouts, and newly added criteria scroll
  into view with focus on their name field.
- Clarified that manually added criteria have no retained excerpt, while
  allowing users to save an optional uploaded-source and PDF-page locator for
  checking the original rubric without retaining or inventing source text.
- Saving an unchanged source locator no longer clears a completed Check trail.
- Calendar month navigation now keeps the selected week in the visible month.

### Privacy / Security

- Added image magic-byte/decode validation, 16,384-pixel side and 20,000,000
  decoded-pixel limits, pinned runtime/language assets, worker cleanup and the
  existing selection-wide text budgets for OCR output. Original images and full
  OCR transcripts remain transient and are not added to project storage or
  backups.
- Calendar export is generated locally. Importing the `.ics` file into an
  external calendar provider may cause that provider to store assignment
  metadata. Source documents, excerpts, OCR text, source filenames and drafts
  are excluded.

### Limitations

- Calendar dates are target completion dates, not reserved study appointments.
- There is no provider sync, reminder, subscription URL or exact time block.
- `.ics` export is a one-way snapshot of incomplete tasks plus the deadline.
- Older projects without a source registry cannot add locators until the
  original files are re-imported.

## [0.6.0] - 2026-08-15

### Added

- Added an English and Simplified Chinese interface switcher to the single
  application URL, with first-visit browser-language detection and a separate
  versioned browser preference.
- Added localized navigation, intake and confirmation flows, workspace views,
  deterministic feedback, errors, recovery controls, accessibility labels,
  dates and numbers.
- Added browser coverage for switching languages without losing pasted input or
  an autosave-pending project edit, then restoring both project and language
  state after refresh.
- Added a concise Simplified Chinese README and a language link at the top of
  the primary README so Chinese-speaking visitors can reach the demo, privacy
  boundaries and contribution path without translating the full technical guide.
- Added a static-demo initial-asset gzip budget so later changes cannot silently
  return the first load to the larger pre-splitting baseline.

### Changed

- Keeps the language preference outside the project state and backup schemas, so
  changing or resetting a project does not change the selected interface
  language and changing language does not rewrite project data.
- Uses combined bilingual static metadata on the one canonical URL rather than
  locale-specific server-rendered pages; the active client title, description
  and document language follow the selected locale.
- Uses the browser's first supported preferred language consistently before
  hydration, including when preference storage cannot be read.
- Keeps translated planning notifications semantic while they are visible, so
  changing language cannot leave an English depth label inside Chinese copy.
- Reports when a language change works only for the current tab because the
  preference could not be saved, and clears that warning after a later save.
- Stacks simultaneous persistence and action notices on narrow screens and
  allows long user titles and notification text to wrap without overflowing.
- Loads confirmation, workspace and evidence phases on demand, reducing the
  static demo's initial JS/CSS payload by 21,440 gzip bytes (5.82%) in the
  verified release build without changing project or backup data.
- Uses explicit labels for confirmation fields and exposes short self-check
  guidance to assistive technology when saving is unavailable.
- Raises the transitive `nanoid@3` security override from 3.3.17 to the patched
  3.3.18 release after advisory GHSA-2v37-7h3g-55p8.

### Limitations

- This release localizes the product interface, not user coursework. Uploaded or
  pasted text, project titles, rubric criteria, source excerpts and draft notes
  are never translated.
- Automatic field extraction remains optimized for English materials. Chinese
  source material requires careful manual confirmation, and there is no separate
  Chinese URL or language-specific server-rendered page.

## [0.5.1] - 2026-08-12

### Added

- Added privacy-safe community handoff links so demo users can view the source,
  report a problem or read the contribution guide without including project
  content in the destination URL.
- Added a five-minute contributor orientation and a direct path to scoped
  `good first issue` tasks.

### Documentation

- Corrected the v0.5.0 verification references to the final tagged commit and
  its exact-main CI and Pages deployment runs.

## [0.5.0] - 2026-08-12

### Added

- Added a separate static-export entry point for an account-free, API-key-free
  demo that preserves the default Node runtime and its optional Live routes.
- Added CI coverage that builds the static demo for the `/rubrictrail` Pages
  subpath, audits the exported artifact and runs the complete browser-local UI
  suite against the generated files.
- Added an exact-revision GitHub Pages deployment workflow that publishes
  <https://sion612.github.io/rubrictrail/> only after the same-repository `main`
  CI run succeeds.

### Security

- Fails the static-artifact audit if the export contains a Live API path,
  OpenAI endpoint or Live credential/configuration marker.
- Documents the static-hosting boundary: the demo contains no Live API or Node
  response headers, its host still receives ordinary page and asset request
  metadata, and project storage is shared at browser-origin scope.
- Clarifies that downloaded project backups are neither encrypted nor signed.

## [0.4.1] - 2026-08-12

### Changed

- Builds the app inside the browser CI job and runs the complete Playwright
  suite through `next start`, so browser checks exercise the production
  artifact instead of the development server.
- Fails CI when a focused Playwright test is committed accidentally while
  keeping local browser-test iteration on the development server.

### Security

- Adds production HTTP contract coverage for the configured anti-framing,
  MIME-sniffing, referrer and browser-capability headers and the suppressed
  framework-identification header.
- Verifies that both optional Live API routes return uncached structured `503`
  responses without contacting a provider when Live mode is disabled.

## [0.4.0] - 2026-08-12

### Fixed

- Rejects malformed UTF-8 TXT input with a stable, recoverable error instead of
  silently inserting replacement characters into detected fields or excerpts.
- Cross-validates persisted and restored evidence against the compact source
  list, bounded canonical source labels and retained excerpt offsets, rejecting
  internally inconsistent source labels in saved state and backups.
- Recovers the wider untrimmed-line offset spans written by early releases while
  normalizing them to the retained excerpt, and rejects deceptive control or
  bidirectional formatting characters in restored filenames.
- Drops source-less evidence produced by internal direct-string summaries before
  project persistence and clarifies that retained excerpts must be checked
  against the original source.

## [0.3.9] - 2026-08-12

### Fixed

- Revalidates confirmed reset, sample handoff, backup restore and older-version
  promotion inside the exclusive browser-storage lock, so edits made while an
  operation waits cannot be silently replaced.
- Gives every confirmed project replacement a monotonic intent revision, so a
  later reset, restore, load or keep-this-tab choice supersedes an older queued
  choice instead of leaving lock order to decide the outcome.
- Cancels stale replacement operations without changing browser-storage bytes
  and suppresses obsolete warnings when a newer confirmed choice succeeds.

## [0.3.8] - 2026-08-12

### Fixed

- Made uploaded-project self-check reviews parent-authoritative so loading or
  restoring another project cannot leave stale criterion text in the editor.
- Routed Progress to the actual next unchecked rubric criterion instead of the
  first or previously selected criterion.
- Rejected Live draft-check output that duplicates one rubric criterion while
  omitting another, preventing double-counted coverage.
- Kept responsive Progress table headers available to assistive technology and
  stopped announcing an untouched empty draft as an error.

## [0.3.7] - 2026-08-12

### Added

- Added the authoritative `rubrictrail.project.store.v1` browser record with a
  monotonic revision and explicit active-project or cleared-tombstone value.
- Added exclusive Web Locks coordination for project writes, backup restore and
  reset. Concurrent writes, or a write and clear from the same observed
  revision, serialize so only the first mutation can succeed.

### Changed

- Keeps state and backup payloads at v3 while wrapping browser persistence in a
  separate record format. During normal saves, the legacy v3, v2 and v1 keys
  remain intact; each new record fingerprints their exact values so a parseable
  older-tab change can be offered as an explicit recovery candidate.
- Makes explicit reset perform a verified privacy purge: it serializes under the
  project lock, removes the v3, v2 and v1 project values and leaves only a
  content-free revisioned tombstone. Conflict, invalid-record, coordination and
  storage failures leave the recovery page open with a specific explanation.
- Clarifies conflict actions as downloading this tab, loading the saved version
  or explicitly replacing it, with a named recovery region and non-focus-stealing
  announcement.

### Security

- Fails closed when Web Locks coordination is unavailable: saved state remains
  readable, but changes stay only in the current tab and the interface recommends
  keeping one tab open and downloading a backup before closing.
- Documents that the 250 ms autosave debounce plus `visibilitychange` and
  `pagehide` flush attempts are best effort. Closing or force-killing the browser
  can still lose the final uncommitted edit, and local-first operation is not a
  claim of storage-level atomic compare-and-swap or complete offline startup.

## [0.3.6] - 2026-08-12

### Added

- Added explicit PDF limits of 200 pages per file and 400 pages per selection,
  plus merged extracted-text limits of 2,000,000 normalized characters, 50,000
  merged lines and 100,000 merged whitespace-delimited words.

### Changed

- Allows a PDF above its per-file page limit to enter the existing explicit
  partial-recovery decision, while selection-wide PDF-page and merged-text
  budgets stop the complete batch. Every selected PDF with readable page-count
  metadata contributes to the 400-page budget even when it is subsequently
  offered as a per-file omission.
- Uses the binary units 10 MiB per file and 25 MiB per selection consistently in
  current product and security documentation.

### Security

- Documents that parsing limits reduce resource risk but are not a CPU or
  peak-memory sandbox: PDF metadata, a page's text items and DOCX decompression
  may consume resources before rejection, and parsing is not yet cancellable.

## [0.3.5] - 2026-08-12

### Changed

- Replaced the percentage-labelled target band with `focused`, `standard`,
  `thorough` and `extended` planning depth. Planning depth changes task scope
  and scheduling time allowance only; it does not correspond to or predict a
  grade.
- Retained the existing state-v3 `targetGrade` numbers only as a
  backward-compatible internal encoding for planning depth, with the four
  previously exposed values preserving their task gates and effort multipliers.
- Updated the sample browser flow to select extended planning depth and reject
  percentage-labelled grade or target-band copy.

### Fixed

- Pointed the v0.3.4 verification documentation to the exact main-commit CI run.
- Kept the compact brand navigation accessible when its visible label is hidden
  at narrow responsive widths.

## [0.3.4] - 2026-08-12

### Added

- Added an explicit complete/not-complete weighting choice during rubric
  confirmation. State records `complete`, `incomplete` or `none`; partial
  official percentages remain attached to their criteria and missing values
  remain `null`.
- Added state v3 on the new `rubrictrail.project.v3` key, including validated
  migration from v2 browser state and v2 project backups. Migrated v2 rubrics
  receive `weightingStatus: "complete"`.
- Added a non-cryptographic fingerprint of the retained v2 lineage so a later
  divergent write from an older tab becomes an explicit cross-version conflict.

### Changed

- Never synthesizes or completes missing grading percentages. Only a confirmed
  complete 100% breakdown weights the plan; incomplete and unweighted rubrics
  use the same neutral per-criterion planning baseline.
- Keeps the v2 storage value as a recoverable cross-version candidate. Writes
  compare both observed values and read them back afterward; detected divergence
  pauses the workflow instead of selecting a winner automatically.
- Makes the recovery-page reset compare all observed project keys before
  deletion and verify the cleared state, refusing to delete when another tab
  changed browser storage after the page opened.

## [0.3.3] - 2026-08-12

### Added

- Added persistent multi-tab conflict detection with explicit actions to
  download this tab, load the latest saved version or deliberately keep this
  tab.
- Added cross-tab component and browser regression coverage for autosave,
  page-close flushing, backup restore and conflict resolution.

### Changed

- Autosave, page-close flushing, backup restore and reset now compare the exact
  localStorage value observed by this tab before changing it.
- Pauses all automatic writes after another tab changes the project, preventing
  stale in-memory state from silently replacing newer saved work.
- Makes replacement an explicit, warned choice; RubricTrail never attempts an
  automatic merge between browser tabs.

## [0.3.2] - 2026-08-12

### Added

- Added explicit partial recovery for mixed file batches: readable sources are
  retained while supported per-file problems are listed for review.
- Added a two-stage confirmation that shows ready and omitted files before the
  assignment summary, then repeats the omission warning before project creation.

### Changed

- Keeps file-count, combined-byte, retained-text and parser-availability limits
  atomic even when individual file errors can be skipped.
- Preserves original selection identity in source IDs so a skipped middle file
  cannot renumber later evidence.
- Keeps a partial preview available while switching between file and paste
  intake, and explains that a new file choice replaces the whole selection.

### Security

- Keeps omitted file names and issue metadata transient; only readable source
  names, confirmed fields and short excerpts can enter local state or backups.
- Rejects unsafe or overlong file names before they can enter the persisted
  project, and separates local parser failures from damaged-document errors.
- Adds explicit 320 px overflow and privacy coverage for long, unsupported file
  names in a mixed batch.

## [0.3.1] - 2026-08-12

### Added

- Added permanent upload and paste intake choices for assignment briefs and
  optional rubric text, including pasted-source provenance in confirmation.
- Added actionable recovery controls for unsupported, scanned, encrypted,
  damaged, oversized and empty files.

### Changed

- Preserves unconfirmed pasted text in memory when returning from confirmation
  while keeping file and paste copy source-neutral.
- File failures now identify what happened, confirm that nothing changed and
  route users to another file or pasted text without a dead end.
- Renamed the sample handoff to **Use my assignment** because it now opens both
  file and pasted-text intake.

### Security

- Bounds pasted input to 100,000 UTF-16 characters and 10,000 lines before it
  enters the existing bounded plain-text parser.
- Keeps full pasted text out of localStorage and project backups; only confirmed
  fields, source labels, aggregate word count and short excerpts can persist.

## [0.3.0] - 2026-08-12

### Added

- Added versioned local project backups with portable filenames, strict UTF-8
  decoding and separate backup/state protocol versions.
- Added restore entry points on both the welcome screen and workspace, including
  a privacy summary and replacement preview.
- Added a direct **Use my files** handoff from the fictional sample workspace.

### Changed

- Restores now validate and write the imported project before changing the open
  workspace; cancellation or storage failure preserves the current project.
- Centralized sample and uploaded readiness definitions and removed obsolete
  readiness IDs during state recovery.

### Security

- Bounded nested draft-check strings and collections before accepting persisted
  or imported state, avoiding unbounded deep validation work on untrusted JSON.
- Rejects oversized, malformed, wrong-format, future-version and structurally
  invalid backup files without accepting raw localStorage or legacy JSON.
- Omits editable derived demo-check output from backups so restored files cannot
  inject a fabricated deterministic result; retained draft text can be rechecked.

## [0.2.1] - 2026-08-12

### Changed

- Aligned the fictional sample deadline with the in-app sample data.
- Refreshed repository metadata, dependency automation and issue routing.
- Pinned third-party CI actions, cancelled superseded runs and retained failed
  browser-test diagnostics for seven days.
- Updated release-status and local-persistence wording in the README.
- Made demo-signal freshness and final Progress actions reflect the current
  section, text, plan and human checklist.
- Made custom self-checks autosave drafts but count as complete only after a
  meaningful, explicitly saved review.

### Fixed

- Deep-validates persisted browser state and recovers safely from malformed,
  obsolete or cross-project data instead of entering a startup crash loop.
- Reports browser-storage failures instead of claiming that unsaved work is
  safely persisted.
- Reopens dependent tasks when a prerequisite is unchecked and ignores stale
  task IDs from older plan versions.
- Bounds upload count, combined bytes and extracted text, and keeps retained
  evidence excerpts at 500 characters or fewer.
- Clears source provenance when a detected rubric criterion is edited.
- Keeps rubric-editor rows mounted while provenance changes, preserving keyboard
  focus, and links validation summaries to specific invalid controls.
- Prevents repeated drop or file-input events from starting concurrent parses.
- Validates real calendar dates, planning-window limits and oversized project
  inputs before creating a local project.
- Caps pasted sample drafts at the same size accepted by local persistence.
- Confirms destructive recovery resets before removing browser-local project data.

### Security

- Added default anti-framing, MIME-sniffing, referrer and browser-capability
  response headers.
- Added an explicit App Router recovery boundary that never deletes local data
  without a user action.
- Constrained vulnerable transitive development dependencies to patched releases.

## [0.2.0] - 2026-08-12

### Added

- Real uploaded-file workflow: preview, edit, validate and create a local project.
- Generic rubric-linked plan generation for user-confirmed criteria.
- Manual evidence-trail self-checks that do not claim AI scoring.
- Compact v2 local persistence with migration from the original sample state.
- Source drawer for retained custom-rubric excerpts.
- Apache-2.0 license, community health files, CI and dependency automation.

### Changed

- Renamed the project from Proofline to RubricTrail after a collision check.
- Upgraded Next.js to 16.3.0 and PDF.js to 6.2.108.
- Made workflow completion data-driven instead of navigation-driven.
- Reframed sample Draft Check percentages as deterministic surface signals.

### Security

- Disabled PDF scripting and evaluation.
- Added authenticated, bounded request handling to the disabled-by-default Live
  API routes.
