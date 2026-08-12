# Contributing to RubricTrail

Thank you for helping make assignment planning more traceable and honest.

## Five-minute orientation

1. Browse the open
   [`good first issue`](https://github.com/Sion612/rubrictrail/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22)
   tasks and choose one with a clear acceptance checklist.
2. Comment on the issue before starting so maintainers and contributors do not
   duplicate work.
3. Fork the repository and create a focused branch from `main`.
4. Follow the setup below, then run the smallest relevant test while iterating.
5. Before opening a pull request, run `pnpm check` and any browser command named
   in the issue. Describe what changed, what you verified and any limitation.

Never attach real coursework, student names, private course material, downloaded
backups or API keys to an issue, test fixture or pull request. Use fictional,
minimal examples that are safe to publish.

## Good first contributions

- improve local parsing for real-world brief and rubric formats;
- add accessibility or mobile tests;
- make rubric-to-plan templates clearer without inventing requirements;
- improve documentation, translations, or recovery messages;
- add migration tests for future project-backup formats.

These are direction areas, not automatically approved scope. Prefer an existing
labelled issue; open a focused proposal first if no issue matches your idea.

Please do not add essay generation, fabricated citations, hidden telemetry, or a
grade-prediction claim.

## Development setup

Requirements: Node.js 24 or newer and pnpm 11.

```bash
pnpm install --frozen-lockfile
pnpm check
pnpm test:e2e -- --workers=1
```

## Pull requests

1. Open an issue first for changes that alter product scope, persisted data, the
   Live API boundary, or academic-integrity behavior.
2. Keep each pull request focused and include tests for changed behavior.
3. Update user-facing documentation when behavior or limitations change.
4. Confirm that uploaded-file examples are fictional or safe to publish.
5. Do not commit `.env` files, real student work, API keys, build output, or
   `node_modules`.

By submitting a contribution, you agree that it is licensed under Apache-2.0.
All contributors must follow [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).
