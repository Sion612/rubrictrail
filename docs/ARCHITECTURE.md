# RubricTrail technical architecture

RubricTrail is a local-first Next.js application with two deliberately separate
paths: a conservative user-source path and a rich fictional sample path.

```mermaid
flowchart LR
  U["User files"] --> BL["Batch + resource limits"]
  BL --> RP["Recoverable per-file parser"]
  RP --> DR["Explicit ready / omitted decision"]
  PT["Pasted brief + rubric"] --> PF["Bounded synthetic TXT sources"]
  PF --> SP["Strict all-or-nothing parser"]
  SP --> C["Editable confirmation"]
  DR --> C
  C --> LP["Compact UploadedProject"]
  LP --> LS["Validated local state"]
  LS --> BF["Versioned backup file"]
  BF --> LS
  LP --> RT["Rubric trail"]
  LP --> TP["Generic task templates"]
  TP --> PE["Plan engine"]
  RT --> SC["Manual self-check"]
  PE --> PR["Progress"]
  SC --> PR

  S["Fictional sample"] --> AS["AssignmentAnalysis schema"]
  AS --> SV["Sample views"]
  AS --> MD["Deterministic demo prompts"]
  SV --> PE
  MD --> PR
```

## Runtime layers

| Layer | Responsibility | Main files |
| --- | --- | --- |
| Product shell | Project type, navigation, real step states, notices | `src/components/rubrictrail-app.tsx`, `workspace-shell.tsx` |
| Source intake | Browser-local TXT, DOCX and text-PDF parsing plus bounded pasted plain text | `src/lib/files/parse-assignment-files.ts`, `src/lib/pasted-text-intake.ts` |
| Confirmation | Editable criteria, an explicit complete/not-complete choice and a 100% gate only for complete weighting | `src/components/upload-summary-view.tsx` |
| Uploaded project | Compact persisted model and generic task templates | `src/lib/uploaded-project.ts` |
| Planning | Deterministic dependency and capacity scheduling | `src/lib/plan.ts` |
| Uploaded checks | Human evidence-trail checklist, no automatic score | `uploaded-project-views.tsx` |
| Sample contract | Strict source, evidence, rubric and feedback schemas | `src/lib/domain.ts`, `src/lib/sample-data.ts` |
| Persistence | v3 localStorage, validated v2 and legacy migration, retained-v2 lineage checks and post-write verification | `src/lib/local-state.ts` |
| Data portability | Versioned UTF-8 JSON export/import with conflict-aware restore | `src/lib/project-backup.ts` |
| Optional Live boundary | Authenticated, bounded, disabled-by-default routes | `src/lib/ai/*`, `src/app/api/live/*` |

## Trust boundary for user sources

Parsing and extraction do not turn an arbitrary upload or paste into a trusted analysis.
The parser reports only conservative fields and explicit rubric lines. The user
must confirm or edit every planning input, including whether the authoritative
rubric provides a complete percentage breakdown. A parser `null` means that no
weight was confidently extracted; it does not prove that the institution did
not publish one. The persisted `weightingStatus` makes the user's decision
explicit: `complete` requires a positive numeric weight for every criterion and
a 100% total; `incomplete` retains one or more official numbers while allowing
other values to remain `null`; and `none` requires every value to be `null`.
Missing values are never completed or equalized automatically.

Real file selections and pasted text intentionally use different failure
contracts. A real selection is rejected before reading when it exceeds 10 files,
10 MiB per file or 25 MiB in total; the selection-wide limits include files that
might later be omitted. Each PDF is limited to 200 pages, with 400 PDF pages
allowed across the complete selection. Merged extracted text is limited to
2,000,000 normalized characters, 50,000 merged lines and 100,000 merged
whitespace-delimited words. Once page-count metadata is available, that PDF's
pages are charged to the 400-page selection total even if the file is later
offered as an explicit per-file omission for exceeding 200 pages.

Unsupported types, unsafe names, per-file oversize, empty/scanned/encrypted or
damaged documents, and a PDF above its 200-page file limit can be listed as
per-file omissions only when at least one source succeeds. The user must
explicitly accept that readable subset before confirmation. The 400-page
selection limit, any merged-text budget, parser unavailability and unknown
failures stop the complete batch instead; RubricTrail does not use file order to
silently discard later sources. Pasted synthetic TXT sources remain strict and
must all succeed.

The persisted uploaded project includes:

- confirmed title, course label, deadline, word count and citation style;
- source-label or filename list and aggregate extracted word count;
- criterion names, `weightingStatus`, per-criterion published percentages or
  `null`, and short retained source excerpts;
- task completion, self-check text and checklist state.

It excludes original files and full uploaded or pasted source text. Pasted
intake is bounded before parsing at 100,000 UTF-16 characters and 10,000 lines,
then converted to one or two in-memory plain-text sources so the existing file,
merged-text and evidence-offset boundaries still apply. A future need for larger
local documents should use IndexedDB rather than expanding localStorage. The
internal direct-string summary overload also applies a 2,000,000-character raw
guard before normalization, then applies the normalized merged-text limits; the
normal file and pasted-text paths retain the intake contracts described above.
Omitted file names and issue metadata are transient intake state: they are shown
before and during confirmation, but they are not copied into `UploadedProject`,
localStorage or the backup protocol. Successful source IDs retain their original
selection positions, so skipping a middle file cannot silently renumber later
evidence.

## Backup and restore boundary

Project backup files use an outer `rubrictrail-project` protocol version and keep
the inner persisted-state version separate. Import checks byte and character
limits, strict UTF-8, JSON shape, both versions and the same deep project schema
used by localStorage. Collection counts are shallow-checked before deep Zod
validation to bound work on untrusted files.

Current exports contain state v3. Valid state-v2 browser data and backup payloads
are migrated through the same validator to state v3; because v2 allowed only a
complete numeric 100% rubric, migrated custom projects receive
`weightingStatus: "complete"`. State v3 retains its existing numeric
`targetGrade` field solely as a backward-compatible encoding for the selected
planning depth. The application converts that legacy value at the persistence
boundary; it is not a target mark, grade estimate or prediction. The four
values exposed by v0.3.4 preserve their task gates and effort multipliers, so
the state-v3 operational contract remains stable while the UI label is fixed.
The original `proofline.project.v1` sample-state migration is also retained.
Unsupported newer state versions are rejected explicitly rather than coerced.

Restore validates and previews the backup, obtains replacement confirmation,
then conditionally writes it against the values observed by this tab before
changing React state. Detected read, validation, write or other-tab failures do
not switch the open project. This is conflict-aware rather than transactional;
the same narrow `localStorage` race described below still applies. Backups are
portable local files, not encrypted archives or automatic synchronization.

Deterministic sample Draft Check output is derived rather than authoritative, so
it is omitted on export and stripped from imported files. The user's draft text
is retained and the check can be rerun locally after restore. Uploaded-project
self-check text is user-authored state and remains portable.

## Multi-tab data integrity

Each tab retains the exact raw `localStorage` values it observed at hydration and
after a successful save. State v3 uses `rubrictrail.project.v3`; the v2 value at
`rubrictrail.project.v2` is deliberately retained as a recoverable
cross-version candidate. A v3 save embeds a non-cryptographic fingerprint of the
exact v2 bytes it superseded. If an older tab later writes different v2 bytes,
and the resulting project is not canonically equivalent, the lineage mismatch
becomes an explicit conflict rather than being guessed away.

Autosave, page-close flushing, backup restore and reset compare both current
values with their observed baselines. Normal writes then read both keys back;
detected divergence fails the operation, with rollback attempted only when the
writer's exact v3 bytes are still present. Storage events from either key also
pause pending writes.

These checks are best effort, not a true compare-and-swap: Web Storage offers no
transaction spanning two keys and no atomic conditional write or delete. A
concurrent write can land in the narrow interval between separate reads and
writes, and rollback is likewise non-atomic. Fingerprint checks and later reads
make surviving cross-version divergence visible, but cannot prove that every
possible overwrite race was prevented.

The persistent conflict banner offers three explicit paths: download this tab,
load the other saved version, or deliberately make this tab active after a
warning. RubricTrail does not claim automatic synchronization or merge concurrent
edits. The guard is intended to prevent ordinary stale-tab overwrites; the JSON
backup remains the recovery path when both versions matter.

## Plan generation

`buildUploadedPlanTemplates()` creates a generic acyclic graph:

1. confirm the brief;
2. create one evidence task per rubric criterion;
3. build a rubric-led outline;
4. draft with source markers;
5. audit each criterion;
6. complete submission QA.

Only `weightingStatus: "complete"` lets published percentages influence the
starting time and priority of criterion tasks. Both `incomplete` and `none` use
the same neutral time baseline for every criterion, even when an incomplete
rubric retains some known percentages. That equal planning share exists only
inside the generated schedule: it is never persisted as a synthetic rubric
weight, displayed as a percentage or described as equal marks.

The plan engine schedules that graph from the real current date, deadline,
weekly capacity and selected planning depth. Planning depth can include
additional review tasks and changes the time allowance applied to the schedule;
it does not correspond to a grading band or predict an outcome. UI checkboxes
and the state update handler both block completion when dependencies are
unfinished.

## Honest workflow state

Step state is derived from data, never navigation position:

- Brief and Rubric become confirmed when the project is created;
- Plan uses task completion;
- Check uses saved sample output or completed uploaded self-checks;
- Progress uses plan, self-check and human checklist state.

The uploaded Check view records whether a user can point to visible evidence,
an explained link and a traceable source. It does not validate those answers or
predict a grade.

## Sample and optional Live contracts

The fictional sample uses strict `AssignmentAnalysis` and `DraftCheckResult`
schemas. Validation enforces source excerpt membership, known evidence and rubric
IDs, exact draft spans, 100% rubric weights and internally consistent weighted
coverage.

The optional Live adapter shares those contracts but is not exposed in the UI.
See [LIVE_AI_ARCHITECTURE.md](./LIVE_AI_ARCHITECTURE.md).

## Performance and accessibility choices

- PDF.js and Mammoth are dynamically imported only for their file types.
- File-count, byte, PDF-page and merged-text limits bound accepted work and
  retained parser output, but they are not a CPU or peak-memory sandbox. PDF
  metadata is loaded before page-count checks, one page's text items can be
  materialized before its text is counted, and DOCX decompression occurs before
  extracted-text limits can be applied. Parsing is currently not cancellable;
  do not open deliberately malicious documents.
- Plan generation and template creation are memoized by their real inputs.
- No login, analytics, database or remote bootstrap runs in local mode.
- Evidence drawers trap focus, close with Escape and restore focus.
- Workflow states have visible text, not color alone.
- Motion respects `prefers-reduced-motion`.
- Desktop and mobile tests assert no document-level horizontal overflow.
