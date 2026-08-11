# RubricTrail technical architecture

RubricTrail is a local-first Next.js application with two deliberately separate
paths: a conservative user-upload path and a rich fictional sample path.

```mermaid
flowchart LR
  U["User files"] --> P["Local parser"]
  P --> C["Editable confirmation"]
  C --> LP["Compact UploadedProject"]
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
| File intake | Browser-local TXT, DOCX and text-PDF parsing | `src/lib/files/parse-assignment-files.ts` |
| Confirmation | Editable fields, criteria and 100% weight gate | `src/components/upload-summary-view.tsx` |
| Uploaded project | Compact persisted model and generic task templates | `src/lib/uploaded-project.ts` |
| Planning | Deterministic dependency and capacity scheduling | `src/lib/plan.ts` |
| Uploaded checks | Human evidence-trail checklist, no automatic score | `uploaded-project-views.tsx` |
| Sample contract | Strict source, evidence, rubric and feedback schemas | `src/lib/domain.ts`, `src/lib/sample-data.ts` |
| Persistence | v2 localStorage plus v1 migration | `src/lib/local-state.ts` |
| Optional Live boundary | Authenticated, bounded, disabled-by-default routes | `src/lib/ai/*`, `src/app/api/live/*` |

## Trust boundary for user files

Parsing and extraction do not turn an arbitrary upload into a trusted analysis.
The parser reports only conservative fields and explicit rubric lines. The user
must confirm or edit every planning input. Rubric weights must total 100% before
a project can be created.

The persisted uploaded project includes:

- confirmed title, course label, deadline, word count and citation style;
- filename list and aggregate extracted word count;
- criterion names, weights and short retained source excerpts;
- task completion, self-check text and checklist state.

It excludes original files and full extracted text. A future need for larger
local documents should use IndexedDB rather than expanding localStorage.

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
- Plan generation and template creation are memoized by their real inputs.
- No login, analytics, database or remote bootstrap runs in local mode.
- Evidence drawers trap focus, close with Escape and restore focus.
- Workflow states have visible text, not color alone.
- Motion respects `prefers-reduced-motion`.
- Desktop and mobile tests assert no document-level horizontal overflow.
