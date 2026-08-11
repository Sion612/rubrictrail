# Changelog

All notable changes will be recorded here. Versions follow Semantic Versioning
once the first public release is tagged.

## [Unreleased]

- Prepare the repository for its first public release.

## [0.2.0] - 2026-08-11

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
