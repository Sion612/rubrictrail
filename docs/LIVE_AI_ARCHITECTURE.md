# Experimental Live AI boundary

RubricTrail does not need an API key for its local workflow. The repository
contains an experimental server-side adapter for future self-hosted research,
but the product UI exposes no Live control.

## Request gates

A request is rejected before its body is read unless all of these are true:

1. `OPENAI_LIVE_ENABLED=true` exists on the server;
2. `OPENAI_LIVE_TOKEN` is a random secret of at least 32 characters;
3. the request uses `Content-Type: application/json`;
4. `Authorization: Bearer <OPENAI_LIVE_TOKEN>` matches in constant time.

The streaming body reader stops once the route's byte or character limit is
exceeded. Parsed input must explicitly include `mode: "live"`, and provider
creation still requires a server-side API key and allowlisted model.

The adapter uses structured outputs, `store: false`, request timeouts, stable
public errors and canonical-source validation. Uploaded text is treated as
untrusted data, not as instructions.

## Why it remains disabled

Authentication and bounded bodies are necessary but not sufficient for a public
service. A production deployment also needs:

- real user authentication and authorization;
- distributed rate limits and concurrency limits;
- per-user and global budget caps;
- abuse monitoring and incident response;
- a clear preview of the exact text leaving the browser;
- consent immediately before each paid request;
- retention, deletion and institutional-policy documentation.

Until those controls exist, maintainers should leave `OPENAI_LIVE_ENABLED=false`.
