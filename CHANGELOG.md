# Changelog

All notable changes will be recorded here. Versions follow Semantic Versioning.

## [Unreleased]

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
