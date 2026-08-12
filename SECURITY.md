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
  browser. Real-file selections are rejected above 10 files, 10 MiB per file or
  25 MiB combined, counting the original selection before any per-file omission.
  Each PDF is limited to 200 pages and all selected PDFs to 400 pages combined.
  Merged extracted text is limited to 2,000,000 normalized characters, 50,000
  merged lines and 100,000 merged whitespace-delimited words. Paste intake is
  separately rejected above 100,000 characters or 10,000 lines.
- A mixed file batch can continue only after the user explicitly accepts the
  readable subset. A PDF above the 200-page per-file limit is one recoverable
  per-file omission. The 400-page selection limit and every merged-text budget
  stop the complete batch rather than choosing which later files to omit. Every
  selected PDF whose page-count metadata can be read contributes to the 400-page
  total, even when it is subsequently offered as a per-file omission. Omitted
  files do not contribute fields or evidence; their names and issue list remain
  transient and are not added to local state or a backup.
- Full source text is temporary and is not written to `localStorage`; confirmed
  fields, source labels, short excerpts, draft snippets and progress can remain
  until reset and can appear in an unencrypted project backup. Compact custom
  rubric state stores `weightingStatus` as `complete`, `incomplete` or `none`,
  with each criterion percentage represented as a number or `null`. Only a
  complete 100% breakdown weights the plan; missing values are not synthesized.
- State-v3 tabs compare the observed v3 and retained v2 values before changing
  storage, read both keys back after normal writes, and store a
  non-cryptographic fingerprint of the v2 lineage in v3. A later divergent v2
  write from an older tab therefore surfaces as a conflict. Valid v2 uploaded
  custom projects and backups migrate with their complete numeric weights;
  sample and empty state have no uploaded-rubric status. Unsupported future
  versions are not coerced.
- Multi-tab protection is best effort. `localStorage` does not provide a
  transaction or atomic compare-and-swap across the two keys, so a narrow race
  can occur between separate reads and writes; readback, lineage checks and
  storage events detect ordinary divergence but cannot guarantee that every
  overwrite is impossible.
- File-count, byte, PDF-page and merged-text limits reduce resource risk, but
  they are not a CPU or peak-memory sandbox. PDF metadata must be loaded before
  the page-count checks can run, a page's text items may be materialized before
  its text budget is measured, and DOCX decompression occurs before extracted
  text can be counted. Parsing is currently not cancellable. Do not treat these
  checks as protection against deliberately malicious documents or open such
  documents in RubricTrail.
- Do not use a shared computer for sensitive work without resetting afterward.
- The experimental Live routes are disabled by default. Enabling them requires a
  server-side API key and a separate 32-character bearer token.
- A public Live deployment also needs rate limits, per-user authorization, budget
  caps, abuse monitoring, and an explicit consent UI. Those controls are outside
  the current release, so the maintainers do not operate a public Live service.
