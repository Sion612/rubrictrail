# Security policy

## Supported version

Security fixes target the latest code on the default branch. RubricTrail has not
yet published a stable release line.

## Reporting a vulnerability

Use GitHub private vulnerability reporting when it is enabled for the repository.
Do not place exploit details, student documents, credentials, or personal data in
a public issue. If private reporting is unavailable, open a minimal public issue
asking the maintainer to establish a private channel.

Include the affected version, reproduction conditions, likely impact, and a safe
proof of concept. The maintainer will acknowledge a complete report when it is
seen and will coordinate disclosure after a fix is available.

## Deployment boundary

- Uploaded files and pasted assignment text are parsed as plain text in the
  browser. Paste intake is rejected above 100,000 characters or 10,000 lines.
- Full source text is temporary and is not written to `localStorage`; confirmed
  fields, source labels, short excerpts, draft snippets and progress can remain
  until reset and can appear in an unencrypted project backup.
- Do not use a shared computer for sensitive work without resetting afterward.
- The experimental Live routes are disabled by default. Enabling them requires a
  server-side API key and a separate 32-character bearer token.
- A public Live deployment also needs rate limits, per-user authorization, budget
  caps, abuse monitoring, and an explicit consent UI. Those controls are outside
  the current release, so the maintainers do not operate a public Live service.
