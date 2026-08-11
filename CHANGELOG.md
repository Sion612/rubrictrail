# Changelog

All notable changes will be recorded here. Versions follow Semantic Versioning.

## [Unreleased]

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
