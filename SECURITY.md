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
- PNG, JPEG and WebP images are signature-checked, decoded locally, rejected
  above 16,384 pixels per side or 20,000,000 decoded pixels, then recognized by
  a lazily loaded Tesseract.js worker using English and Simplified Chinese data.
  The worker, WebAssembly core and trained data are pinned build dependencies
  served from the same origin. RubricTrail does not send selected images or OCR
  text to a remote recognition service and disables Tesseract's persistent
  trained-data cache; browser HTTP caching of the public runtime assets remains
  host-controlled.
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
- Browser storage is scoped to the complete origin, not to the `/rubrictrail`
  path. Do not serve the demo on an origin that also runs unrelated or untrusted
  scripts with access to the same `localStorage`.
- TXT input is decoded as strict UTF-8. Invalid byte sequences fail closed and
  can only be omitted through the explicit mixed-batch recovery decision.
- Persisted and restored evidence is cross-checked against the compact source
  list: source ids and filenames must be present together, one source id cannot
  claim multiple filenames, and retained excerpt offsets must match the excerpt.
  Full source text is not retained, so users must still re-check the original.
  New OCR-derived evidence also retains an `ocr` origin label so restored views
  cannot present probabilistic image recognition as document-extracted text.
- The authoritative browser value is the revisioned
  `rubrictrail.project.store.v1` record. Its envelope is separate from the state
  and backup protocols: active project and backup payloads remain v3. During
  normal saves, the earlier v3, v2 and v1 keys are retained and each record stores
  non-cryptographic fingerprints of their exact bytes. A single parseable
  legacy-key change can therefore surface as an older-tab recovery candidate.
  An explicit reset performs a verified privacy purge: it removes those three
  compatibility values and leaves only a content-free cleared tombstone with
  null legacy fingerprints. Unsupported future state versions are not coerced.
- Current-version writes, backup restores and clears request the same exclusive
  Web Lock, compare the complete record-plus-legacy baseline while holding it,
  and write the next revision. Two writes, or a write and clear, from the same
  baseline cannot both report success. This is application-level coordination,
  not a claim that `localStorage` provides a transaction or atomic
  compare-and-swap; older code that does not take the lock can still change a
  legacy key, which the stored fingerprints and later reads are designed to
  surface.
- If Web Locks are missing or lock acquisition fails, mutation fails closed. The
  saved project can remain readable, but edits are tab-only and the interface
  recommends keeping one tab open and downloading a backup before closing.
  `visibilitychange` and `pagehide` trigger best-effort asynchronous flushes, but
  the 250 ms debounce, an immediate close or a force-kill can still lose the last
  uncommitted edit.
- File-count, byte, image-dimension, PDF-page and merged-text limits reduce resource risk, but
  they are not a CPU or peak-memory sandbox. PDF metadata must be loaded before
  the page-count checks can run, a page's text items may be materialized before
  its text budget is measured, image decoding allocates memory before OCR, and
  DOCX decompression occurs before extracted text can be counted. OCR is CPU
  intensive and probabilistic. Parsing is currently not cancellable. Do not treat these
  checks as protection against deliberately malicious documents or open such
  documents in RubricTrail.
- Do not use a shared computer for sensitive work without closing older
  RubricTrail tabs and resetting afterward. A still-open older release can write
  its compatibility key again; the current release will surface that as a
  conflict rather than silently restoring it.
- The experimental Live routes are disabled by default. Enabling them requires a
  server-side API key and a separate 32-character bearer token.
- The separate static demo export contains no Live API routes or Node runtime
  response-header configuration. Its artifact audit rejects Live paths, OpenAI
  endpoints and Live credential/configuration markers. This verifies the built
  files, not the policy of GitHub Pages: the host still receives ordinary page
  and asset request metadata and controls HTTPS, caching and response headers.
- Downloaded project backups are plain JSON. They are neither encrypted nor
  signed; schema and version validation does not authenticate their author.
- A public Live deployment also needs rate limits, per-user authorization, budget
  caps, abuse monitoring, and an explicit consent UI. Those controls are outside
  the current release, so the maintainers do not operate a public Live service.
