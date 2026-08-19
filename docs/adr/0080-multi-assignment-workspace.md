# ADR-0080: Multi-assignment workspace persistence

- Status: Accepted with amendments
- Decision date: 2026-08-19
- Target release: v0.8.0
- Scope: browser-local persistence architecture only

## Context

RubricTrail v0.7.1 has one browser-local project. The authoritative
`rubrictrail.project.store.v1` envelope contains a monotonic revision and either
one state-v3 project or a cleared tombstone. Every current mutation takes the
exclusive `rubrictrail.project.store.v1` Web Lock, compares the complete
observed baseline, writes, and verifies the next value. The retained
`rubrictrail.project.v3`, `rubrictrail.project.v2`, and
`proofline.project.v1` values remain compatibility and older-tab evidence. A
single-project backup is a separate, portable format.

The current behavior is described in [the architecture
document](../ARCHITECTURE.md#multi-tab-data-integrity) and
implemented at the boundaries in
[`src/lib/local-state.ts`](../../src/lib/local-state.ts),
[`src/lib/project-backup.ts`](../../src/lib/project-backup.ts), and
[`src/lib/ui-types.ts`](../../src/lib/ui-types.ts).

v0.8.0 adds a workspace containing multiple assignments. Each assignment keeps
its existing Brief, Rubric, Plan, Check, Progress, and Project Tracker. The
release does not add cloud sync, accounts, collaboration, or manual tasks.
Local-first and privacy behavior remain mandatory.

Moving from one value to an index plus project records introduces cross-key
failure states. A Web Lock serializes participating tabs, but it does **not**
make multiple `localStorage` writes atomic. The design must therefore define
authority, ordering, crash recovery, stale-tab behavior, quota failure, and
deletion without guessing.

## Decision

Use:

1. one small authoritative workspace index;
2. one namespaced record per project;
3. one durable operation journal for every cross-key mutation;
4. one global workspace Web Lock, retaining the current lock name;
5. one independent best-effort last-opened preference;
6. one sacrificial storage reserve for recovery operations; and
7. generation-scoped tombstones removed only by a journaled workspace-generation
   rotation.

The index contains membership and deletion state only. It does not duplicate
title, course, deadline, progress, or other project metadata. Project edits are
isolated to their project record and do not revise the index. Project switching
is UI state plus a best-effort preference and does not revise the index.

## Rejected alternatives

### One monolithic workspace value

This would make a workspace mutation one `localStorage` write, but every edit
would rewrite every project. A single oversized or corrupt value would make all
projects unavailable, concurrent edits to different projects would conflict,
and the quota cliff would grow with the complete workspace.

### Independent project records without an authoritative index or journal

A namespace scan cannot tell whether an unreferenced record is a newly created
project, a partially deleted project, an abandoned write, or stale data from an
older generation. Automatically rebuilding authority from filenames or highest
revisions could silently resurrect or discard projects.

### IndexedDB in v0.8.0

IndexedDB transactions fit multi-record persistence better, but adopting it now
would combine the multi-assignment product change with asynchronous hydration,
database lifecycle and migration, blocked/versionchange handling, and a second
notification model. The exit criteria for moving to IndexedDB are defined
below. v0.8.0 keeps a bounded `localStorage` protocol rather than pretending it
has transactions.

## Storage keys and ownership

The protocol owns these exact keys:

| Purpose | Key |
| --- | --- |
| Authoritative index | `rubrictrail.workspace.index.v1` |
| Operation journal | `rubrictrail.workspace.operation.v1` |
| Storage reserve | `rubrictrail.workspace.reserve.v1` |
| Last-opened preference | `rubrictrail.workspace.preferences.v1` |
| Project record | `rubrictrail.workspace.<workspaceId>.generation.<generation>.project.<projectId>.v1` |

The existing Web Lock name `rubrictrail.project.store.v1` becomes the global
workspace lock. Retaining the name makes v0.8 operations serialize with
participating v0.7.x mutations even though v0.7.x does not understand the new
keys.

The existing single-project keys remain legacy inputs, not workspace records:

- `rubrictrail.project.store.v1`;
- `rubrictrail.project.v3`;
- `rubrictrail.project.v2`; and
- `proofline.project.v1`.

No key outside these exact patterns is owned by this protocol. Cleanup must not
remove values merely because they start with `rubrictrail.`.

## Identifiers, canonical bytes, and digests

`workspaceId`, `projectId`, and `operationId` are lowercase RFC 4122 UUID text
produced by `crypto.randomUUID()`. If secure UUID generation is unavailable,
the operation fails closed. A generated workspace or project ID is checked
against the index, all recognized workspace record keys in every discovered
generation, and all valid tombstones. IDs are never reused. After eight
collisions, creation fails rather than falling back to weaker randomness.

Protocol values use strict schemas and canonical JSON: UTF-16 JavaScript
strings serialized by `JSON.stringify` with schema-defined field order and no
whitespace. A digest is lowercase 64-character SHA-256 of the UTF-8 encoding of
the exact stored string. A `null` digest means the key is absent. If the digest
primitive is unavailable, a mutation that needs it fails closed.

Digests detect expected versus target bytes; they do not authenticate
untrusted local storage.

## Authoritative workspace index

`lastOpenedProjectId` is deliberately absent.

```ts
interface WorkspaceIndexV1 {
  formatVersion: 1;
  workspaceId: string;
  workspaceGeneration: number;
  revision: number;
  status: "active" | "cleared";
  projects: Array<{
    projectId: string;
    kind: "active" | "tombstone";
  }>;
  legacyFingerprints: {
    record: string | null;
    v3: string | null;
    v2: string | null;
    v1: string | null;
  };
}
```

Rules:

- `workspaceGeneration` and `revision` are positive safe integers.
- Entries are unique by `projectId` and sorted lexicographically before
  serialization.
- An active index contains at least one active project unless the product is
  showing a newly created empty workspace state explicitly defined by a later
  UI decision. A cleared index contains no entries.
- Every listed entry must have a strict, matching record at the exact key for
  the index workspace and generation.
- An unlisted record is not authoritative.
- Index `revision` changes for membership changes, tombstone changes, legacy
  baseline acceptance, status changes, and generation rotation. It does not
  change for a project content edit or a project switch.
- `legacyFingerprints` are digests of the exact four v0.7.x values observed at
  index creation or after an explicit conflict choice. Every v0.8 mutation
  rechecks them while holding the global lock.

The index does not duplicate title, progress, deadline, course, or display
summary. The dashboard reads and validates the active records and may build an
in-memory derived view. Duplicating mutable metadata would turn every project
edit into a cross-key commit and create drift between the index and project
record. The bounded record policy makes the extra reads acceptable for v0.8.0.

## Per-project record envelope

```ts
interface WorkspaceProjectRecordV1 {
  formatVersion: 1;
  workspaceId: string;
  workspaceGeneration: number;
  projectId: string;
  revision: number;
  value:
    | { kind: "project"; state: PersistedProjectState }
    | { kind: "tombstone" };
}
```

The identity fields must match the storage key exactly. `revision` is a
positive safe integer and advances on each mutation of that project record. A
project value contains the existing validated state-v3 payload unchanged. A
tombstone contains no project content and is authoritative only while its
matching workspace generation is authoritative.

A content edit compares the expected index identity/generation/revision, legacy
fingerprints, and exact expected project record while holding the global lock.
It then writes and verifies only the next project record. This isolates normal
quota and corruption failures to one project and avoids an index write for each
keystroke batch. The global lock is intentionally conservative; v0.8.0 does not
add per-project locks.

## Best-effort workspace preference

```ts
interface WorkspacePreferencesV1 {
  formatVersion: 1;
  workspaceId: string;
  workspaceGeneration: number;
  lastOpenedProjectId: string | null;
}
```

The exact key is `rubrictrail.workspace.preferences.v1`.

This record is not authoritative, is not revisioned, does not participate in
workspace compare-and-swap, is not included in the journal, and does not
require the global Web Lock. Writes are last-write-wins and best effort. A
project switch first changes the current tab's UI selection, then attempts to
write this preference. It does not mutate the workspace index or index
revision.

On read, the value is accepted only if the schema is strict, the workspace ID
and generation equal the authoritative index, and `lastOpenedProjectId` is
`null` or names an active indexed project. An invalid, stale, or dangling
preference is ignored and removed best effort. Failure to read, write, or remove
it never blocks access to projects and never changes authority. A missing value
falls back to the dashboard or a deterministic UI-only choice.

A cross-tab storage event may refresh the value used on the next dashboard
entry or reload, but it must not force a tab away from its currently open
project or discard unsaved UI state. Project deletion, workspace clear, and
generation rotation attempt matching preference cleanup or rewrite after the
authoritative operation; failure is visible only as a best-effort preference
limitation.

## Storage-operation reserve and quota contract

The exact key `rubrictrail.workspace.reserve.v1` contains:

```ts
interface WorkspaceReserveV1 {
  formatVersion: 1;
  padding: string;
}
```

Its canonical serialized value is exactly **262,144 UTF-16 code units**:

```text
{"formatVersion":1,"padding":"<262,112 ASCII zero characters>"}
```

The fixed JSON syntax is 32 code units and `padding` is exactly 262,112 `0`
characters. The reserve has no user data.

This 256-Ki-code-unit reserve is a product recovery mechanism, not a browser
quota promise. Browser storage accounting, eviction, partitioning, private
mode, and available quota are implementation-dependent. Existing product
character limits bound accepted data; they do **not** guarantee that a browser
will persist it. The only proof of a write is a successful write followed by an
exact readback in the current environment.

The reserve is created and verified before first migration or creation of a new
workspace. Failure to establish it leaves legacy authority unchanged and makes
workspace mutation unavailable.

Growth operations (`migrate-single-project`, `create-project`,
`restore-as-new`, and a `replace-project` whose target is larger than its
source) must write their journal while the reserve remains present. They must
not consume the reserve to make accepted content fit; quota failure leaves
authority unchanged. A destructive, non-growing, compaction, or recovery
operation may remove and verify the reserve immediately before creating its
journal. The operation must fit a bounded journal within the released space.

If the reserve is removed but journal creation throws, returns a mismatching
readback, or the browser crashes before the journal exists:

1. no index or project mutation may have occurred;
2. the current valid index remains authoritative;
3. an exactly matching attempted journal may be removed, but unknown bytes are
   quarantined rather than deleted;
4. the reserve is recreated and verified best effort; and
5. if recreation fails, the operation reports failure and the workspace enters
   degraded mode.

On startup, an absent reserve with no valid journal is treated as the same
pre-journal failure state: validate the current index and its records, do not
invent or resume an operation, and attempt to recreate the reserve.

Degraded mode permits validated reads, project switching, and export. It blocks
create, restore-as-new, migration, generation rotation, and other growth. A
non-growing single-project edit may be attempted only when its replacement
string is no larger than the current exact value and still receives write plus
readback verification. Destructive operations are allowed only if their journal
can first be durably written and verified. The UI must state that storage
protection is degraded and recommend project backups; it must not claim that a
product character limit proves available capacity.

## Operation journal

The journal contains no project state. It records exact expected and target
digests for bounded recovery.

```ts
type WorkspaceOperationKind =
  | "migrate-single-project"
  | "create-project"
  | "delete-project"
  | "restore-as-new"
  | "replace-project"
  | "recover-index"
  | "delete-workspace"
  | "rotate-workspace-generation";

type ProjectMutationMode =
  | "create"
  | "replace"
  | "delete"
  | "rewrite-generation";

interface WorkspaceOperationJournalV1 {
  formatVersion: 1;
  operationId: string;
  kind: WorkspaceOperationKind;
  workspaceId: string;
  sourceGeneration: number | null;
  targetGeneration: number;
  phase:
    | "prepared"
    | "records-writing"
    | "records-written"
    | "index-committed"
    | "cleanup-pending";
  baseIndex: {
    key: "rubrictrail.workspace.index.v1";
    expectedDigest: string | null;
  };
  targetIndex: {
    key: "rubrictrail.workspace.index.v1";
    serializedValue: string;
    targetDigest: string;
  };
  legacyExpectedDigests: {
    record: string | null;
    v3: string | null;
    v2: string | null;
    v1: string | null;
  };
  projectMutations: Array<{
    mode: ProjectMutationMode;
    projectId: string;
    sourceRecord: {
      key: string;
      expectedDigest: string;
    } | null;
    targetRecord: {
      key: string;
      expectedBeforeDigest: string | null;
      targetDigest: string;
    };
    sourceCleanup: {
      key: string;
      expectedDigest: string;
    } | null;
  }>;
  cleanup: Array<{
    key: string;
    expectedDigest: string;
  }>;
}
```

`targetIndex.serializedValue` is the complete canonical target index and its
digest must equal `targetDigest`. It contains membership only, never project
state. Every `legacyExpectedDigests` value is a digest of the exact legacy
string or `null` for an absent key.

Arrays are lexicographically ordered by project ID and then key. The journal
must pass a strict size bound smaller than the reserve before it is written.
Every `rewrite-generation` mutation contains the expected digest of the exact
source record, the expected prior digest of the target key (normally `null`),
the target digest of the rewritten active record, and the exact source digest
allowed for cleanup. Therefore recovery can classify every active record as
not started, target written, source cleaned, or conflicting without guessing.

For each journaled key, recovery accepts only its recorded before or after
digest. If a key has any third value, recovery stops in quarantine mode and
offers export/diagnostics; it does not pick the highest revision or newest
timestamp. Cleanup deletes a key only when its current digest exactly equals
the journal's expected digest.

The journal is written and verified before the first authoritative index or
project mutation. It deliberately does not duplicate a project payload. If a
crash occurs while a target record is still at its expected-before digest and
the base index/source bytes remain exact, create, restore, replace, and delete
may cancel safely by removing the exact journal without claiming success.
Migration and rewrite-generation may instead reconstruct a deterministic target
from their still-exact validated source. Once a source has been removed, its
verified target must exist; otherwise recovery quarantines the operation.

Phase updates are advisory checkpoints and are themselves written and
verified; recovery derives truth from key digests rather than trusting the phase
alone. The valid journal has precedence over the index only for the exact
operation, identities, and expected/target digests it names.

## Authority and recovery precedence

Authority is resolved in this exact order while holding the global lock:

1. **Strictly valid operation journal.** If every observed named key is one of
   its recorded before/after states, deterministically complete or roll forward
   the operation. A malformed journal or third-value mismatch blocks mutation;
   it does not grant authority.
2. **Strictly valid workspace index.** If there is no valid journal, the index
   is authoritative only when its schema, IDs, generation, limits, and every
   referenced record validate exactly.
3. **Namespace scan candidates.** If the index is missing or corrupt, scan only
   owned project-key patterns and group strict records by exact
   `(workspaceId, workspaceGeneration)`. The scan discovers candidates; it
   **never creates authority**.

A coherent group has strict key/envelope identity agreement, unique project
IDs, supported schemas, no third-value journal conflict, and counts within the
policy limits. An invalid owned record makes its group incoherent and places
the workspace in recovery-only mode.

With one coherent group, the user must still explicitly select that group and
confirm index recovery. With multiple coherent groups, the user must explicitly
select one exact workspace/generation group; ordering by generation, revision,
record count, timestamp, preference, or lexical ID is forbidden. Unselected
groups remain quarantined and are not deleted automatically. With no coherent
group, no project becomes authoritative; the UI permits diagnostics/export of
individually valid records and an explicit privacy purge, not an inferred
workspace.

An explicit recovery selection uses a journaled `recover-index` operation and
rewrites the selected active records into a fresh next generation before
committing a new index. Reusing the selected generation is forbidden because a
stale tab may still hold its former baseline.

## Global lock and compare rules

Every authoritative read-modify-write, recovery, migration, create, edit,
delete, restore, replace, clear, and rotation takes the exclusive
`rubrictrail.project.store.v1` Web Lock. After acquiring it, the operation:

1. resolves a valid journal first;
2. rereads and validates the index;
3. compares expected workspace ID, generation, index revision, and exact index
   digest;
4. compares all four legacy fingerprints;
5. compares every affected project digest;
6. revalidates the caller's current intent; and
7. writes and verifies in the specified order.

Missing Web Locks or lock rejection makes authoritative mutation unavailable.
No unlocked canonical fallback is permitted. Web Locks serialize participating
code; they do not make the following multi-key sequences atomic.

## Operation state machines and write ordering

### First migration from v0.7.x

States: `legacy-only -> journaled -> project-written -> index-committed ->
legacy-retained -> complete`.

1. Read and validate the current authoritative record plus v3/v2/v1 values.
2. Generate collision-checked workspace and project IDs; target generation is
   1 and index revision is 1.
3. With the reserve still present, write and verify a
   `migrate-single-project` journal.
4. Write and verify the new active project record.
5. Write and verify the workspace index with fingerprints of all exact legacy
   bytes.
6. Retain the legacy values unchanged.
7. Remove the exact journal and recreate the reserve.

A crash before the journal leaves legacy authority unchanged. A crash after
the project write uses the journal to commit the exact target index. A crash
after the index commit treats the workspace index as the completed target and
finishes journal/reserve cleanup. Migration never deletes the only legacy copy
before new authority is verified.

### Create project

States: `absent -> journaled -> active-record-written -> indexed -> complete`.

1. Validate policy limits, reserve, ID uniqueness, index baseline, and intent.
2. Write and verify a `create-project` journal.
3. Write and verify the revision-1 active project record at the current
   generation.
4. Write and verify the next index revision adding the active ID.
5. Remove the journal and recreate the reserve.

Before index commit, the record is non-authoritative but recoverable only
through the journal. After index commit it is authoritative. A record without a
journal and without index membership is never auto-adopted.

### Switch active project

States: `selected-A -> selected-B -> preference-attempted`.

1. Validate that B is active in the current in-memory authoritative snapshot.
2. If A has pending edits, complete the normal verified save or require an
   explicit conflict choice before switching.
3. Select B in current-tab UI state.
4. Best-effort write `rubrictrail.workspace.preferences.v1`.

This operation does not take the workspace lock solely for the switch, does not
write the index, and does not change workspace or project revision. A failed
preference write does not reverse a successful UI switch.

### Edit project

States: `clean -> pending -> lock-held -> verified-write | conflict | failed`.

1. Capture expected index identity/generation/revision/digest and exact project
   record.
2. Acquire the global lock and perform all compare rules.
3. Write and verify only the next project record revision.
4. Keep the index unchanged.

`localStorage.setItem` is treated as one key replacement, not as a transaction.
A crash before replacement leaves the old record; a crash after a matching
readback leaves the new record. An unexpected value is a conflict. Autosave
remains best effort near page shutdown, as in v0.7.1.

### Delete project

States: `active -> journaled -> tombstone-written -> index-tombstoned ->
complete`.

1. Confirm the exact project and replacement intent.
2. Write and verify a `delete-project` journal.
3. Replace the active record with the next-revision, content-free tombstone in
   the same generation and verify it.
4. Write and verify the next index revision changing the entry to `tombstone`.
5. Best-effort clear a matching last-opened preference.
6. Remove the journal and recreate the reserve.

A crash after the tombstone but before the index is resolved from the journal;
the project is not inferred active from index or record alone. The project ID is
never reused.

### Restore a single-project backup as new

States and ordering equal create, using `restore-as-new`. The existing backup
is validated with the v0.7.1 single-project backup rules, receives a new
collision-checked project ID, and keeps its state-v3 payload. The backup cannot
choose workspace ID, generation, record revision, or project ID.

### Replace selected project from backup

States: `selected-active -> journaled -> replacement-written -> complete`.

1. Validate and preview the backup and obtain replacement confirmation.
2. Capture the selected project's exact identity and current intent.
3. Write and verify a `replace-project` journal whose target index digest equals
   its base index digest. If the target record is larger than the source, the
   reserve remains present; a quota failure changes no authoritative bytes.
4. Replace and verify only the selected project record at its next revision.
5. Remove the journal and recreate the reserve.

The project ID and index membership remain unchanged. A post-confirmation edit
invalidates intent before replacement. The journal provides deterministic crash
classification even though the authoritative mutation is one project key.

### Delete entire workspace

States: `active -> journaled -> cleared-generation-committed -> cleanup-pending
-> complete`.

1. Obtain explicit privacy confirmation and capture every exact owned value to
   be removed.
2. Write and verify a `delete-workspace` journal targeting generation `N + 1`.
3. Write and verify a cleared, empty index at generation `N + 1` and next index
   revision. This invalidates stale v0.8 tabs before content cleanup.
4. Remove each prior workspace project record only on its exact recorded
   digest, verifying each deletion.
5. Remove the four legacy project values only when each still equals the exact
   value recorded by the journal. A mismatch stops cleanup and remains visible.
6. Best-effort remove the preference.
7. Remove the journal and recreate the reserve.

A crash before the cleared index leaves the valid journal to finish. A crash
after it makes the cleared index authoritative and recovery resumes cleanup.
The cleared generation remains as a content-free stale-tab guard; deleting the
index would permit namespace guessing or absent-value ABA.

### Rotate workspace generation

Rotation is the v0.8-safe tombstone compaction operation. States:
`generation-N -> journaled -> active-records-rewritten -> generation-N+1-index
committed -> old-generation-cleanup -> complete`.

1. Refuse rotation if any owned record is invalid, any active record is
   missing, the index is invalid, a legacy fingerprint changed, or another
   journal cannot be resolved.
2. Build exact target envelopes for every active project at generation `N + 1`.
   Each uses mutation mode `rewrite-generation`, preserves project ID and
   project state, and increments the project record revision.
3. Record the expected source digest, expected target digest, target digest,
   and source-cleanup digest for **every** rewritten active record in a
   `rotate-workspace-generation` journal. The target index contains only active
   IDs and no tombstones.
4. For each active project in lexical ID order: write and verify its target
   record; then remove its source only if the source digest is still exact; then
   verify removal. Moving one record at a time avoids requiring quota for a
   duplicate full workspace. During this interval the journal, not the stale
   generation-N index alone, governs recovery.
5. Delete a generation-N tombstone only if its envelope is strictly valid, its
   key identity matches, its index entry is `tombstone`, and its exact digest is
   named by the journal. Invalid owned records block compaction; they are never
   deleted as presumed tombstones.
6. Write and verify the generation `N + 1` index at the next index revision.
7. Remove any remaining exact source records named for cleanup.
8. Rewrite or remove a stale preference best effort.
9. Remove the journal and recreate the reserve.

At each active-record step, recovery sees source-only, source-plus-target, or
target-only and deterministically advances after digest checks. A third value
blocks. The index commit is the authority transition. A stale v0.8 tab from
generation N must reread the N+1 index under the lock and fail its baseline; a
v0.7.x tab is handled through legacy drift detection.

## Crash recovery matrix

| Crash point | Observed durable state | Required recovery |
| --- | --- | --- |
| Before reserve removal | No operation bytes | Keep current authority; report original failure. |
| After reserve removal, before valid journal | Index/projects unchanged, reserve absent | Do not infer an operation; validate current index, recreate reserve, otherwise enter degraded mode. |
| During journal write/readback | Journal missing, exact attempted bytes, or unknown bytes | Missing/exact attempted bytes mean no domain mutation; unknown/invalid bytes quarantine and block mutation. |
| After valid journal, before first project write | All named values at expected digests | Roll forward from recorded targets or cancel only when the operation definition explicitly permits rollback without deleting target data. |
| After target record write, before verification | Target is expected-before, exact target, or third value | Retry from before, accept target, or quarantine respectively. |
| After target verification, before source cleanup | Source and target exact | Remove only the exact named source when operation ordering permits. |
| After source cleanup, before next rewrite | Target exact, source absent | Continue; never require the stale index alone to find the moved record. |
| After all records, before index commit | Journal names complete targets; base index still present | Verify every target, then write exact target index. |
| During index replacement | Index equals exact base, exact target, or third value | Commit target, continue cleanup, or quarantine respectively. |
| After target index, before cleanup | New authority committed, old exact bytes remain | Keep new authority and resume exact-digest cleanup. |
| During cleanup | Some named old keys absent, some exact, or a third value | Treat absent as done, delete exact values, stop on third value. |
| After journal removal, before reserve recreation | Target authority complete, reserve absent | Keep target authority; recreate reserve or enter degraded mode. |
| Preference write/cleanup at any point | Authoritative operation unaffected | Ignore invalid/stale preference and retry cleanup best effort. |

Recovery is idempotent. It never chooses by wall-clock time, array order,
highest generation, highest revision, or most records.

## Multi-tab and old-version behavior

Every v0.8 authoritative mutation rereads index identity, generation, revision,
legacy fingerprints, and affected records after acquiring the global lock. Two
tabs from one baseline cannot both mutate the same record or membership. Edits
to different projects remain logically isolated but serialize through the one
lock. Storage events pause pending saves and surface conflicts; they are an
early notification, not authority.

A v0.8 tab holding generation N cannot write after a delete-workspace or
rotation commits N+1. It must fail its baseline even if its project bytes still
exist. A tab must resolve a valid journal before any other mutation.

v0.7.x tabs take the same named Web Lock but do not read the workspace index.
They can still write `rubrictrail.project.store.v1` or compatibility keys after
v0.8 migration. Therefore migration retains fingerprints of all four legacy
values and every v0.8 mutation checks them. Any change pauses mutation and
offers an explicit choice such as import the older-tab value as a new project,
replace a selected project, keep the workspace and accept a new baseline, or
privacy-purge exact bytes. It never silently promotes the changed legacy value.

Closing old tabs remains recommended before migration or privacy deletion. No
application protocol can stop already-open old code from writing after a newer
operation; the required defense is detection and fail-visible recovery.

## Product record-count policy

These thresholds are product safety policy, **not browser quota guarantees**.
They count strict project records in the authoritative generation. A valid
rotation journal may temporarily name source and target copies; those bounded
shadow records do not become additional logical projects.

| Threshold | Policy |
| --- | --- |
| 64 tombstones | Show a soft compaction recommendation. |
| 80 total active plus tombstone records | Show a persistent storage-management warning and offer backups/compaction. |
| 96 total records | Block create and restore-as-new until explicit compaction or deletion reduces the count. Existing reads, export, edits, and deletion remain available subject to quota checks. |
| 100 total records | Hard schema and mutation limit for one authoritative generation. Never create a 101st entry. A group above the limit is not coherent authority and is recovery-only. |

Outside a valid rotation or recovery journal, 100 physical owned project keys
across discovered generations also blocks growth until explicit recovery or
cleanup. A valid journal may temporarily name at most 100 source and 100 target
project keys while it moves a generation; every extra key must be named by that
journal. More than 200 physical project keys, or more than 100 without a valid
journal explaining the transition, is recovery-only rather than permission to
ignore or delete the excess.

Rotation must remain possible at the blocking thresholds. It processes active
records one at a time, verifies a target before removing its source, and uses
the reserve for its journal. If even that cannot be written, the workspace
stays readable/exportable in degraded mode rather than deleting data to make
space. If 96 or more entries are active rather than tombstones, compaction
cannot reduce the logical count; the user must delete or export projects.

## Legacy-data cleanup

Normal migration and save retain the four v0.7.x values as old-tab evidence.
They are not automatically removed on a timer or after a successful migration.
Only an explicit whole-workspace privacy deletion or a separately confirmed
legacy cleanup may remove them, and then only against journaled exact values.
A value changed by an older tab is never deleted as if it were the previously
observed legacy value.

Generation rotation may clean only records belonging to the selected
workspace/generation and named by the valid journal. It may delete only strictly
valid tombstone envelopes. An invalid owned record blocks compaction and remains
available for diagnostics; a filename pattern alone is not permission to
delete.

The preference is cleaned best effort when its strict workspace/generation no
longer applies. Invalid preference bytes may be removed without the workspace
lock because they have no authority. Failure to clean them is harmless and
must not be reported as successful authoritative cleanup.

## Backup compatibility

The v0.7.1 single-project backup format remains unchanged. Download exports one
selected project's existing state-v3 content and does not expose workspace ID,
generation, project record revision, journal, tombstone, reserve, or preference.
Restore offers two explicit operations:

- restore as new, assigning a new project ID; or
- replace the selected project, preserving that selected project ID.

Backups created before v0.8.0 remain valid under their existing validation and
migration rules. A future whole-workspace backup needs a new outer format and a
separate ADR. It must not be inferred from or added to the single-project format
in v0.8.0.

## Silent-data-loss and resurrection invariants

These invariants are release blockers. They are intentionally explicit and must
not be shortened to a generic statement that recovery is safe.

1. A namespace scan never grants authority.
2. A missing or corrupt index never causes automatic selection, even when only
   one coherent group exists.
3. Multiple workspace/generation groups are never ranked or merged
   automatically.
4. An unlisted project record is never auto-adopted.
5. A missing project record is never interpreted as an intentional deletion.
6. A tombstone is authoritative only in its exact authoritative generation.
7. Project IDs are never reused, including IDs found only in tombstones or old
   generations.
8. Generation rotation commits authority only through the target index.
9. Every rewritten active record has exact expected source and target digests
   in a valid journal.
10. A source record is not removed until its target record is written, read
    back, validated, and digest-matched.
11. Cleanup removes only exact bytes named by a valid journal.
12. Compaction deletes only strict tombstone envelopes; invalid owned records
    block it.
13. An invalid journal or any third-value digest blocks mutation instead of
    guessing.
14. Journal recovery is resolved before index-only reads or new mutations.
15. Journal phase text never overrides observed key digests.
16. A Web Lock is never described or used as a multi-key transaction.
17. Missing Web Locks never trigger an unlocked canonical write.
18. Every mutation rereads its baselines after lock acquisition.
19. Index revision does not change for project switching or content-only edits.
20. A best-effort preference can never select authority, delete a project, or
    force another tab to switch.
21. A failed preference write never rolls back an otherwise valid UI switch.
22. A project edit never rewrites unrelated project records.
23. Create and restore-as-new do not publish membership before the project
    target is verified.
24. Delete does not publish a tombstone membership before the content-free
    tombstone is verified.
25. Replace never changes the selected project ID or another project.
26. Migration never removes the only validated legacy copy before new authority
    is verified.
27. Legacy changes after migration are surfaced; they are never silently
    accepted or discarded.
28. Whole-workspace delete commits a new cleared generation before content
    cleanup, preserving a stale-tab guard.
29. Whole-workspace cleanup stops on any legacy or owned-record mismatch.
30. Removing the reserve is not permission to mutate before a valid journal is
    durable.
31. Failure after reserve removal but before journal creation leaves index and
    projects unchanged.
32. Product character and record limits are never presented as browser quota
    guarantees.
33. A quota failure does not trigger opportunistic deletion of user data,
    tombstones, legacy bytes, or another project.
34. A record-count hard limit never causes records beyond the limit to be
    silently ignored.
35. Crash recovery is idempotent at every write and cleanup boundary.
36. Existing single-project backups remain readable and never gain implicit
    workspace authority.
37. State-v3 project validation remains mandatory inside every active record.
38. Corruption in one unreferenced or invalid record cannot silently replace a
    valid indexed project.
39. Closing or hiding a page remains best-effort; the final uncommitted edit is
    never claimed durable without verified persistence.
40. Explicit user intent is revalidated after lock wait and before the first
    authoritative mutation.

## Exact test matrix

### Schema and canonicalization

- strict valid/invalid index, project, tombstone, preference, reserve, and
  journal fixtures;
- key/envelope workspace, generation, and project ID mismatches;
- duplicate/unsorted index entries, unsafe integers, unsupported versions, and
  100/101-entry boundaries;
- canonical serialization and exact SHA-256 fixtures;
- reserve serialization is exactly 262,144 UTF-16 code units with 262,112
  padding characters;
- preference valid, stale workspace, stale generation, dangling project,
  malformed, read failure, write failure, and best-effort cleanup failure.

### Authority and migration

- first migration from active v0.7.1 record, cleared record, valid v3/v2/v1
  fallback, invalid higher legacy plus valid lower candidate, and conflicting
  legacy values;
- migration crash injection after reserve removal, journal write, project
  write, index write, journal removal, and reserve recreation;
- missing index with zero, one, and multiple coherent groups;
- corrupt index with one and multiple coherent groups;
- explicit selection required even for one group;
- no ranking by generation, revision, record count, lexical ID, preference, or
  timestamp;
- invalid owned record makes its group incoherent and blocks compaction;
- valid journal precedence over base index and deterministic third-value
  quarantine.

### Project lifecycle

- create, restore-as-new, replace selected, edit, switch, delete, and full
  workspace delete happy paths;
- crash injection before and after every `setItem`, `removeItem`, readback,
  journal phase update, index commit, cleanup, and reserve recreation;
- create/restore orphan target with valid journal completes; the same orphan
  without journal is not adopted;
- delete crash cannot resurrect content or publish a missing record as deleted;
- replace preserves ID and leaves every unrelated byte exact;
- switch changes no index or project revision and a preference failure keeps
  the current-tab selection;
- concurrent edits to the same project yield one success/one conflict;
- concurrent edits to different projects serialize and preserve both;
- post-confirmation edits invalidate queued destructive intent.

### Generation rotation and stale tabs

- `rotate-workspace-generation` rewrites every active record with
  `rewrite-generation`, exact expected/target digests, and no tombstone copies;
- source-only, source-plus-target, target-only, index-before, index-after, and
  partial-cleanup recovery for every rewritten record;
- third-value source, target, index, or cleanup key blocks;
- only strict indexed tombstones are removed;
- invalid tombstone-shaped and invalid active owned records block compaction;
- stale v0.8 tab from generation N cannot edit, create, delete, restore, replace,
  or recreate a deleted project after N+1 commits;
- stale preference from N is ignored and cleaned best effort;
- v0.7.x write during and after migration/rotation changes a legacy digest and
  pauses v0.8 mutation;
- old-tab clear/write and new-tab create/delete ordering under the retained
  global lock;
- no real production concurrency claim unless a browser test actually creates
  the competing tabs.

### Quota, reserve, and limits

- reserve present, missing, malformed, wrong size, removal failure, and
  recreation failure;
- quota failure before reserve removal changes nothing;
- journal write failure after reserve removal changes no index/project bytes;
- crash after reserve removal with no journal enters deterministic degraded
  recovery;
- target write failure preserves source and authority;
- degraded mode allows read/export, blocks growth, and permits only verified
  non-growing single-record replacement;
- thresholds at 63/64 tombstones, 79/80, 95/96, 99/100, and attempted 101;
- rotation at warning/block thresholds without full-workspace duplication;
- 96 active records explains that compaction cannot reduce logical count;
- character-limit-valid writes still handle browser quota rejection honestly.

### Backup, privacy, and UI integration

- v0.7.1 backup round trip, restore as new, and replace selected;
- backup contains no workspace IDs, revisions, journal, reserve, tombstones, or
  preference;
- dashboard derives title/progress/deadline from project records and does not
  persist duplicates in the index;
- delete-project and delete-workspace confirmations name exact scope;
- storage/conflict/degraded/recovery states are persistent, bilingual, keyboard
  accessible, and offer download before destructive choices;
- project reset/delete does not delete the independent language preference;
- workspace preference cleanup does not affect locale preference;
- public static demo performs no project-content network request and contains
  no Live runtime.

## Four-PR implementation plan

No PR activates an incomplete persistence protocol.

### PR 1: Storage protocol and recovery foundation, dormant

- strict schemas, canonical serialization, key parsing, digests, reserve,
  journal engine, namespace candidate scanning, and deterministic recovery;
- storage adapters and fault-injection tests;
- no dashboard, migration activation, or production write path.

### PR 2: Non-destructive coordinator and dashboard, dormant

- workspace read model, derived metadata, project switch preference, dashboard,
  create/edit autosave coordination behind an inactive feature boundary;
- single-project backup export/restore-as-new plumbing;
- no delete, replace, privacy purge, rotation, or automatic migration.

### PR 3: Destructive lifecycle and compaction, dormant

- replace selected, delete project, delete workspace, explicit index recovery,
  generation-scoped tombstones, `rotate-workspace-generation`, quota/degraded
  UX, and stale-tab tests;
- remains inactive for existing users.

### PR 4: Migration, production activation, documentation, and E2E

- first-run v0.7.x migration and legacy-drift choices;
- activate the multi-assignment workspace only after the first three PRs are on
  main and compatible;
- full browser/static-demo matrix, privacy/backup documentation, release notes,
  and exact-main evidence.

Dashboard activation is separated from destructive operations so each review
can prove its own safety boundary. No PR may silently introduce a second
temporary authority model.

## Exit criteria for IndexedDB

Prepare a separate ADR and migrate from `localStorage` when any of these becomes
true:

1. normal validated workspaces repeatedly approach browser quota despite the
   v0.8 record policy;
2. the 96-record block is a demonstrated user limitation rather than a
   theoretical edge;
3. generation rotation cannot maintain its reserve/journal safety margin for
   representative maximum project sizes;
4. synchronous dashboard record reads cause measured responsiveness problems;
5. a required feature needs atomic mutation of multiple project records;
6. whole-workspace backup, attachments, richer source retention, or search
   needs structured stores or larger payloads;
7. field evidence shows material eviction/corruption coupling that per-project
   records cannot isolate; or
8. the recovery journal becomes more complex than an IndexedDB transaction and
   lifecycle migration would be safer overall.

The IndexedDB ADR must define asynchronous hydration, database/version
lifecycle, blocked/versionchange behavior, transaction boundaries, migration
from every v0.8 intermediate state, cross-tab notification, backup impact,
quota/eviction UX, and rollback. It may not introduce a silent dual-authority
period between `localStorage` and IndexedDB.

## Consequences and limitations

This architecture isolates project corruption and normal edits, preserves the
single-project backup format, and makes cross-key recovery explicit. It also
adds protocol and test complexity, serializes all writes through one lock, and
requires synchronous reads of bounded project records for dashboard metadata.

The journal makes interrupted operations recoverable; it does not make them
atomic. The reserve improves the chance that destructive recovery metadata can
be written; it is not guaranteed capacity. Older tabs cannot be prevented from
writing legacy keys; they can only be detected. Namespace recovery deliberately
requires user choice, including when only one coherent candidate exists.

No runtime behavior changes merely because this ADR is accepted. Implementation
starts only through the four reviewed PRs above.
