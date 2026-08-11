# RubricTrail technical architecture

RubricTrail is a local-first Next.js application with two deliberately separate
paths: a conservative user-source path and a rich fictional sample path.

```mermaid
flowchart LR
  U["User files"] --> BL["Batch count + byte limits"]
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
| Confirmation | Editable fields, criteria and 100% weight gate | `src/components/upload-summary-view.tsx` |
| Uploaded project | Compact persisted model and generic task templates | `src/lib/uploaded-project.ts` |
| Planning | Deterministic dependency and capacity scheduling | `src/lib/plan.ts` |
| Uploaded checks | Human evidence-trail checklist, no automatic score | `uploaded-project-views.tsx` |
| Sample contract | Strict source, evidence, rubric and feedback schemas | `src/lib/domain.ts`, `src/lib/sample-data.ts` |
| Persistence | v2 localStorage, v1 migration, strict validation and conditional multi-tab writes | `src/lib/local-state.ts` |
| Data portability | Versioned UTF-8 JSON export/import with atomic restore | `src/lib/project-backup.ts` |
| Optional Live boundary | Authenticated, bounded, disabled-by-default routes | `src/lib/ai/*`, `src/app/api/live/*` |

## Trust boundary for user sources

Parsing and extraction do not turn an arbitrary upload or paste into a trusted analysis.
The parser reports only conservative fields and explicit rubric lines. The user
must confirm or edit every planning input. Rubric weights must total 100% before
a project can be created.

Real file selections and pasted text intentionally use different failure
contracts. A real selection is rejected before reading when it exceeds 10 files
or 25 MiB in total; those limits include files that might later be omitted.
Unsupported types, unsafe names, per-file oversize, empty/scanned/encrypted or
damaged documents can be listed as per-file omissions only when at least one
source succeeds. Retained-text exhaustion, parser unavailability and unknown
failures stop the whole batch. Pasted synthetic TXT sources remain strict and
must all succeed. A partial batch stays outside confirmation until the user
explicitly chooses to review only the readable sources.

The persisted uploaded project includes:

- confirmed title, course label, deadline, word count and citation style;
- source-label or filename list and aggregate extracted word count;
- criterion names, weights and short retained source excerpts;
- task completion, self-check text and checklist state.

It excludes original files and full uploaded or pasted source text. Pasted
intake is bounded before parsing at 100,000 UTF-16 characters and 10,000 lines,
then converted to one or two in-memory plain-text sources so the existing file,
extracted-text and evidence-offset boundaries still apply. A future need for
larger local documents should use IndexedDB rather than expanding localStorage.
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

Restore is atomic from the user's point of view: RubricTrail validates and
previews the backup, obtains replacement confirmation, conditionally writes it
against the exact localStorage value observed by this tab, then changes React
state. A failed read, validation, storage write or other-tab conflict leaves the
current project unchanged. Backups are portable local files, not encrypted
archives or automatic synchronization.

Deterministic sample Draft Check output is derived rather than authoritative, so
it is omitted on export and stripped from imported files. The user's draft text
is retained and the check can be rerun locally after restore. Uploaded-project
self-check text is user-authored state and remains portable.

## Multi-tab data integrity

Each tab retains the exact raw localStorage value it observed at hydration and
after every successful save. Autosave, page-close flushing, backup restore and
reset compare the current value with that baseline before changing storage. A
mismatch fails closed and a `storage` event pauses pending writes immediately.

The persistent conflict banner offers three explicit paths: download this tab,
load the latest saved version, or deliberately replace it with this tab after a
warning. RubricTrail does not claim automatic synchronization or merge concurrent
edits. The guard prevents ordinary stale-tab overwrites; the JSON backup remains
the recovery path when both versions matter.

## Plan generation

`buildUploadedPlanTemplates()` creates a generic acyclic graph:

1. confirm the brief;
2. create one evidence task per rubric criterion;
3. build a rubric-led outline;
4. draft with source markers;
5. audit each criterion;
6. complete submission QA.

The plan engine schedules that graph from the real current date, deadline,
weekly capacity and target band. UI checkboxes and the state update handler both
block completion when dependencies are unfinished.

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
- File-count, byte and retained-text limits bound saved parser output, but DOCX
  decompression and PDF page extraction still happen before every peak-memory or
  CPU cost can be known. They are not a complete malicious-document sandbox.
- Plan generation and template creation are memoized by their real inputs.
- No login, analytics, database or remote bootstrap runs in local mode.
- Evidence drawers trap focus, close with Escape and restore focus.
- Workflow states have visible text, not color alone.
- Motion respects `prefers-reduced-motion`.
- Desktop and mobile tests assert no document-level horizontal overflow.
