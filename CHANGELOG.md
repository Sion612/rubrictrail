# Changelog

All notable changes will be recorded here. Versions follow Semantic Versioning.

## [Unreleased]

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
