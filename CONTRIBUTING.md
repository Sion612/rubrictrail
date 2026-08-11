# Contributing to RubricTrail

Thank you for helping make assignment planning more traceable and honest.

## Good first contributions

- improve local parsing for real-world brief and rubric formats;
- add accessibility or mobile tests;
- make rubric-to-plan templates clearer without inventing requirements;
- improve documentation, translations, or recovery messages;
- add migration tests for future project-backup formats.

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
