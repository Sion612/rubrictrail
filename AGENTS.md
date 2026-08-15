<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# RubricTrail maintainer rules

These repository-specific instructions apply to every AI-assisted change in
RubricTrail. They supplement, and do not replace, the generated Next.js block
above. Do not edit, move, weaken, or delete that generated block.

## Required orientation

Before making a change, inspect the current repository state and read the files
that define the affected behavior. At minimum, review these repository-wide
contracts when the task could affect them:

- `README.md`
- `SECURITY.md`
- `CONTRIBUTING.md`
- `docs/ARCHITECTURE.md`
- `docs/KNOWN_LIMITATIONS.md`
- `docs/TEST_REPORT.md`
- `.github/workflows/ci.yml`
- `.github/workflows/deploy-pages.yml`
- `package.json`

Also inspect the relevant implementation, all meaningful call sites, tests,
fixtures, schemas, migrations, and user-facing documentation before editing.
Do not rely on remembered behavior when the repository can be checked.

## Product mission and educational integrity

RubricTrail helps students:

- understand assignment and assessment requirements;
- trace rubric criteria back to source evidence;
- plan their own work;
- review progress;
- self-check whether requirements have been addressed.

The governing principle is: **Help students do the work, not replace the
work.**

Do not silently turn RubricTrail into an essay generator or answer-generation
product. Do not add functionality that:

- generates complete student submissions;
- invents rubric criteria;
- invents evidence, citations, sources, facts, or grades;
- claims that a student satisfies a criterion without evidence;
- encourages bypassing academic-integrity requirements.

Any substantial change to this educational-integrity boundary requires explicit
maintainer approval.

## Local-first and privacy invariants

The public GitHub Pages version is intended to remain local-first. Unless a task
explicitly concerns the optional self-hosted Live AI mode:

- coursework, drafts, rubric text, evidence, and uploaded files must not be sent
  over the network;
- full uploaded source documents must not be persistently stored;
- analytics or telemetry must not contain filenames, assignment titles,
  excerpts, rubric text, drafts, or other student free text;
- OpenAI credentials must never be exposed client-side;
- Live API code, routes, endpoints, credential markers, and runtime
  configuration must not leak into the public static artifact.

Do not weaken runtime validation, file-parsing safety limits, backup/import
validation, local-state validation, static-demo privacy audits, Live route
guards, request-size limits, or security checks merely to make a test pass.

Treat uploaded files, parsed external documents, `localStorage`, imported
backups, HTTP request bodies, external API responses, and AI/model output as
untrusted input. Validate them at their trust boundaries.

## Live AI boundary

The public static demo must remain usable without Live AI. Do not make Live AI
publicly accessible to arbitrary users without an explicit maintainer decision
and a separate production-readiness design covering at minimum:

- real user or session identity;
- authorization;
- durable rate limiting;
- budget and cost limits;
- abuse controls;
- an operator kill switch;
- explicit data-transfer consent;
- logging minimization;
- privacy documentation.

A shared bearer token is not a complete public multi-user authentication
system. Do not describe `store: false` as guaranteed zero data retention.

## Change discipline

One task should solve one clearly defined problem. Before editing:

1. explain the current behavior;
2. state the exact problem;
3. identify the invariants that must not change;
4. choose the smallest safe implementation;
5. identify the verification needed for the affected risk boundary.

Do not perform unrelated cleanup or refactoring. Do not expand scope merely
because another improvement is nearby. If a requested change reveals a separate
problem, report it as follow-up work instead of silently including it.

Large architectural changes, new dependencies, authentication systems,
state-management frameworks, persistence-model changes, privacy-policy changes,
educational-behavior changes, or public AI-service changes require explicit
maintainer approval.

Preserve user changes in a dirty worktree. Stage explicit intended paths rather
than broad, catch-all additions. Do not merge, release, deploy, tag, publish, or
modify external repository settings unless the maintainer has explicitly
authorized that action for the current task.

## AI-assisted development safety

This repository is maintained with substantial AI/Codex assistance, so
reviewability is a first-class requirement. Prefer:

- small pull requests;
- narrow responsibilities;
- cohesive modules;
- explicit trust boundaries;
- typed interfaces;
- deterministic behavior where appropriate.

Avoid making already-large modules larger without considering a cohesive
extraction. Do not introduce Redux, Zustand, another state-management framework,
or a broad architectural abstraction unless a separate architectural decision
demonstrates a real need.

Do not hide TypeScript problems using:

- `any`;
- broad unsafe type assertions;
- chains such as `as unknown as X`, unless isolated at a necessary external
  boundary and justified;
- unjustified non-null assertions;
- disabled TypeScript checks;
- disabled ESLint rules.

When TypeScript exposes real uncertainty, model or validate it instead of
silencing the compiler.

## Refactoring rules

Behavior-preserving refactoring and feature development should normally be
separate changes. Do not refactor multiple large modules in one pull request.

For large-file decomposition:

- preserve behavior first;
- add or confirm tests first;
- extract one cohesive responsibility at a time;
- keep public interfaces narrow;
- avoid new framework-level abstractions without a demonstrated need.

A smaller file count is not itself a goal. Better responsibility boundaries and
reviewability are.

## Testing and verification

Never claim that a command, test, build, deployment, browser check,
accessibility check, security check, or manual review passed unless it was
actually executed successfully against the stated revision and environment.

For ordinary runtime or source changes, run at minimum:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

When affected, also run the relevant browser and static-export gates:

```bash
pnpm test:e2e
pnpm build:demo
pnpm audit:demo
pnpm test:e2e:demo
```

Run any other specialized audit or check defined by the repository when its
boundary is affected. UI, persistence, parsing, navigation, deployment,
backup/restore, browser behavior, static-export behavior, dependency, or
security changes require appropriate higher-level tests. Behavior changes
require tests unless there is a clear documented reason why automation is not
appropriate.

Do not:

- delete meaningful tests merely to obtain green CI;
- weaken assertions to accommodate broken behavior;
- exclude difficult business logic merely to inflate coverage;
- alter test data to conceal a regression;
- replace a deterministic wait or state contract with an arbitrary delay.

For coverage work, measure the real baseline before choosing thresholds and
ratchet from evidence instead of inventing arbitrary percentages.

## Documentation integrity

Documentation is evidence, not marketing. Do not write claims into `README.md`,
`CHANGELOG.md`, `docs/TEST_REPORT.md`, release notes, or security documentation
unless the underlying behavior or result was actually verified.

In particular:

- do not claim Safari support solely from Playwright WebKit;
- do not claim WCAG compliance solely from automated accessibility tests;
- do not claim zero OpenAI retention merely because `store: false` is set;
- do not claim a deployment is live merely because a build succeeded;
- do not present local or pull-request evidence as exact-main or release
  evidence;
- do not present clone counts, automated traffic, stars, forks, or pull-request
  counts as user adoption without defensible evidence.

Clearly distinguish automated evidence, manual verification, inference, and
unverified claims. Release evidence must identify the exact commit and relevant
remote run or deployment.

## GitHub Actions and supply-chain security

Preserve least-privilege GitHub Actions permissions. Third-party Actions should
remain pinned to verified immutable full commit SHAs. Do not replace a full SHA
with a mutable tag such as `@v4`, `@main`, or `@latest` for convenience, and
never invent an Action SHA.

Dependency, Action, CI-permission, release, deployment, or secret changes
require explicit security review. Preserve frozen installs, dependency audits,
the required quality/browser/static gates, and the rule that Pages deploys the
exact successful `main` revision.

## Accessibility and browser support

Accessibility is a product requirement for an education tool. Preserve and
improve keyboard navigation, focus behavior, semantic HTML,
assistive-technology compatibility, reduced-motion behavior, non-color-only
state indicators, and responsive/mobile usability.

Automated accessibility testing is a regression guard, not proof of full WCAG
compliance. Playwright WebKit must not be described as branded Safari.

## Performance

Optimize from measurement rather than intuition. Before significant bundle or
performance work:

1. measure the current state;
2. identify the actual bottleneck;
3. make a bounded change;
4. measure again;
5. report the observed result, including when a target was not met.

Do not add arbitrary memoization, component splitting, caching, or architectural
complexity without evidence of benefit. Worker or parsing refactors must
preserve current privacy, failure, evidence, and resource-limit semantics.

## Codex for Open Source application readiness

Maintain the repository so its real work remains suitable to present in a
future Codex for Open Source application, without distorting the product to
chase eligibility. The official program currently invites core maintainers or
maintainers of widely used public projects, and also encourages applications
from smaller projects that play an important ecosystem role. This is a
qualitative review, not a published fixed star, fork, or pull-request threshold.

Before preparing or updating an application, re-check the current official
OpenAI program page and terms. Requirements and benefits can change. Separate:

- current official requirements;
- truthful evidence about this repository and the maintainer's role;
- internal growth goals or recommendations;
- unverified assumptions about selection.

Preserve truthful evidence of public open-source maintenance, including a clear
license, maintainer identity and write access, focused issues and pull requests,
reviewable release history, contributor guidance, security reporting, required
CI, test evidence, and honest project limitations. Explain RubricTrail's
ecosystem value through real educational, privacy, accessibility, security, and
local-first work rather than unsupported adoption claims.

Never buy, trade, automate, or otherwise manipulate stars, forks, traffic,
contributors, issues, or pull requests. Do not create empty or artificial pull
requests to make the project appear active. A pull request counts as useful
maintenance evidence only when it contains a real, reviewable contribution.
External contributions must be evaluated on product fit, safety, and quality,
not accepted merely to improve application optics.

Do not claim that RubricTrail qualifies, that an application will be accepted,
or that a particular star count guarantees acceptance. Do not weaken privacy,
security, educational integrity, test quality, licensing clarity, or repository
governance for application eligibility. Any proposal to make the repository
private, change its open-source license, fabricate usage evidence, or materially
reshape the product for a program application requires explicit maintainer
approval.

## Maintainer decisions

Do not silently decide product-policy questions for the maintainer. Stop and
surface the decision when work requires choosing or materially changing:

- the target student;
- whether AI may generate or rewrite academic content;
- educational-integrity boundaries;
- what student data may leave the browser;
- telemetry or analytics policy;
- public Live AI availability;
- authentication or provider strategy;
- data retention;
- monetization;
- institutional or teacher features;
- major UX workflow changes;
- major architectural frameworks;
- licensing or public-repository status.

Technical implementation may be delegated to Codex. Product purpose and
educational or ethical trade-offs belong to the maintainer.

## Completion report

At the end of every implementation task, report:

1. changed files;
2. what behavior changed;
3. what behavior intentionally did not change;
4. checks actually executed;
5. the exact result of each check;
6. remaining risks or uncertainties;
7. follow-up work discovered but intentionally left out of scope;
8. decisions requiring maintainer approval;
9. a plain-language maintainer explanation covering:
   - what problem was solved;
   - why the change was needed;
   - what users will notice;
   - what changed internally;
   - what is most likely to break if the implementation is wrong;
   - what the maintainer should manually inspect.
