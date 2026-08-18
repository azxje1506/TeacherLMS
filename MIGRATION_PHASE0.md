# Migration — Phase 0 checklist (Sprint 5.6.3)

**Status:** **APPLIED and verified 2026-08-10** (Sprint 5.6.4 Phase 0). The 11
legacy reschedules carry stored origins and `legacyOriginFallback` has been removed
from the live write path and the report scripts. See "What was applied" below for
the digests and counts.

> **Superseded in one respect.** This file describes Phase 0 as it ran, when
> `RETIRE_ENABLED` was `false`. It has since been set to `true` (Sprint 5.6.4B) and
> retirement has run; two further production writes followed, neither of them part
> of Phase 0 — the lesson lifecycle transition and the removal of 32 fabricated
> historical lessons. The checklist below is the record of the Phase 0 operation
> and is deliberately left as it was; it is not a description of the current state.

Authoritative design: `RECURRENCE_DESIGN.md` §6. This file is the operating
procedure for it — what to run, in what order, what must be true before each
step, and how to undo it. Where the two disagree, the design wins.

---

## What Phase 0 does

It writes `originalDate` / `originalStart` / `originalDuration` onto the **11**
Regular lessons that were rescheduled before those fields existed. Strictly
additive: no id changes, no date changes, no status changes, and no
`rescheduledAt` — that field records *when* a move happened, and the back-fill
does not know when these moves happened.

It does **not** delete anything, and it does not enable the reconciler's retire
verb. The 142 planned retirements are reported and left where they are.

**Why it is mandatory.** Not to prevent deletions — the planner's
`legacyOriginFallback` already reads the id when a stored origin is missing, and
the migration report confirms all 11 classified as frozen reschedules. What
Phase 0 buys is the ability to **remove that fallback**: until the origins are
stored, the reconciler parses a lesson id to make a safety decision, which is the
exact coupling ADR-001 exists to eliminate, and an id can never carry a duration.

---

## What was applied — 2026-08-10

Run against `etlms` on branch `sprint-5.6.4-phase0`, app clock `2026-07-10`,
window `2026-06 .. 2026-09`. Every step of the checklist below was executed in
order and produced the stated result.

| | |
|---|---|
| Lessons stamped | **11** — exactly the `phase0Targets` in `backups/before-phase-0/manifest.json` |
| Post-apply verification | `RESULT: PASS`. Wrong target 0, not stamped 0, stamped-but-not-targeted 0, **collateral 0**, count changed `false` |
| Lessons before / after | 1009 / 1009 |
| Lessons digest before | `8f47e660931d743da6dea72af5786b9c3fb514feebe8aef614950385413961b8` |
| Lessons digest after | `659f683bbe9919a2b56c7cf2107c611bd6dd0978c10520f513e165afc809281d` |
| Phase 2 baseline | **bit-identical** before and after — all 8 months, not only the 5 past ones |
| Report digest before | `fadd545e436ecddb5403febdf29b71c208d0db9634d04dee73a89300e53e66ef` |
| Report digest after | `80c017454963e471a3e9752d1c3269ca81ed993b11fce5926f474d6101d6f98c` |
| Report digest after the fallback was removed | `42b2874ce3c95ea6b6e1b8c48a0b0f54b4c05c2433e609119180fbf92242e178` |
| Plan across all three | unchanged: keep 257, update 0, insert 0, **retire 142**, strand 0, skip 4 |

Snapshots kept: `backups/before-phase-0/` (the only copy of the pre-migration
state), `backups/after-phase-0/`, `backups/after-app-check/`. Reports kept as
`backups/report-before.txt`, `backups/report-after.txt`,
`backups/report-after-fallback-removed.txt`.

**Removing `legacyOriginFallback` changed nothing.** The report taken with the
fallback still on and the report taken after it was removed differ in two lines:
the blocker disappears, and the digest moves with it. Every count, every planned
retirement and the whole protected set are byte-identical.

---

## The tools

| Command | Writes? | What it is |
|---|---|---|
| `npm run lessons:migration-report` | no | The deterministic verification report. §6 Phases 0, 3 and 4 in one place. |
| `npm run lessons:migration-report -- --json` | no | The same, machine-readable. |
| `npm run lessons:migration-report -- --digest` | no | One sha256 line — compare two runs without reading either. |
| `npm run lessons:snapshot` | files only | §6 Phase 1 snapshot + Phase 2 baseline, into `backups/<dir>`. Generates that snapshot's own `ROLLBACK.md`. |
| `npm run lessons:backfill-origins` | no | Phase 0, report + verification only. The default. |
| `npm run lessons:backfill-origins -- --apply --snapshot backups/<dir>` | **yes** | Phase 0, applied. Refuses without a matching snapshot. |
| `npm run lessons:reconcile` | no | The 5.6.1 dry run — what the reconciler would do. |
| `npm run lessons:duplicates` | no | The independent detector, for the §6 Phase 3 cross-check. |

`backups/` is git-ignored: it holds production data.

---

## Checklist

Run every step in order. Any step that does not produce the stated result stops
the migration — do not carry on and fix it afterwards.

### 0. Confirm the starting state

```
npm test && npx tsc --noEmit && npm run lint && npm run build
```

- [x] All four pass.
- [x] `RETIRE_ENABLED` was `false` in `src/lib/reconciler.ts` when Phase 0 ran.
      Phase 0 did not change it and neither did this checklist. *(It was set to
      `true` later, in Sprint 5.6.4B — see the note at the top of this file.)*

### 1. Read the report and keep it

```
npm run lessons:migration-report > backups/report-before.txt
npm run lessons:migration-report -- --digest
```

- [x] `VERDICT: PASS`.
- [x] Section 1: **11** lessons, **11** verified as genuine moves, **3**
      load-bearing. Every item reads `PASS`.
- [x] Section 2: `IDENTICAL`. This is the one that matters most — it says
      stamping the origins changes no reconciliation decision, which is the whole
      claim Phase 0 makes.
- [x] Section 3: **142** planned retirements, **142** independently verified,
      **1** alone on its date. `EXECUTED 0`.
- [x] Section 4: `no write action targets a protected lesson`.
- [x] The two blockers listed under VERDICT are the expected ones: the back-fill
      has not been applied, and `legacyOriginFallback` is still on.

Run it twice and check the digest matches. If it does not, the database changed
between runs and someone is using the app — stop until it is quiet.

### 2. Snapshot (§6 Phase 1) and baseline (§6 Phase 2)

```
npm run lessons:snapshot -- --out backups/before-phase-0
```

- [x] Four collection exports plus `baseline.json`, `manifest.json` and
      `ROLLBACK.md` exist in that directory.
- [x] `manifest.json` records **11** `phase0Targets`.
- [x] Read `ROLLBACK.md` **before** applying anything. It names the exact ids the
      rollback would touch.
- [ ] **NOT DONE — operator action outstanding.** Copy the directory somewhere
      off this machine. A snapshot on the same disk as the mistake is not a
      snapshot. `backups/before-phase-0/` currently exists only on `D:`, and it
      is the only copy of the pre-migration state.

### 3. Cross-check against the independent detector (§6 Phase 3)

```
npm run lessons:duplicates
npm run lessons:reconcile
```

- [x] Every lesson the detector calls safely removable is retired by the plan.
      **Measured 2026-08-10: 223 safely removable, of which the plan retires 141
      and deliberately does not retire 82 — every one of the 82 belongs to `B2`,
      an Archived class.** That is ADR-002, which post-dates this line: an
      Archived class is outside reconciliation entirely, so the plan is a strict
      subset of the detector's set rather than an equal to it. A smaller write
      set cannot make a write unsafe. The detector ignores class status (§1.6),
      which is why the two disagree here and nowhere else.
- [x] None of its protected candidates is touched. **0 of 106**, and 0 of the 4
      it marks RESCHEDULED.
- [x] Retirements the detector cannot see are the ones alone on their date — the
      report names them, and there is currently **1**
      (`L-c4-2026-08-04-1430`). Confirmed as the only one.

### 4. Apply Phase 0

Nobody should be using the app: the back-fill reads the collection, writes, and
reads it back, and a concurrent edit shows up as a `collateral` failure.

```
npm run lessons:backfill-origins -- --apply --snapshot backups/before-phase-0
```

The command refuses to write if the snapshot directory is missing, is not a
snapshot, or no longer describes the live collection (it re-computes the lessons
digest and compares). It also refuses if any of the 11 items fails verification
or if the equivalence check is not identical — as one set, never partially.

- [x] `Lessons written .... 11`.
- [x] POST-APPLY VERIFICATION: `RESULT: PASS`.
- [x] `Carrying exactly the expected origin .... 11`.
- [x] `Wrong target`, `Not stamped`, `Stamped but not targeted`, and
      **`Any OTHER field changed, any lesson`** all `0`.
- [x] `Lesson count changed .... false`.

Anything other than `PASS` → go to **Rollback** below.

### 5. Verify (§6 Phase 5)

```
npm run lessons:snapshot -- --out backups/after-phase-0
npm run lessons:migration-report > backups/report-after.txt
```

- [x] `diff backups/before-phase-0/baseline.json backups/after-phase-0/baseline.json`
      shows **no difference at all**. Phase 0 writes only origin fields, which no
      reported figure reads, so even the future months must be identical here.
- [x] `backups/report-after.txt` section 1 now reads **0** lessons needing an
      origin, and section 3 still reads **142** retirements, all verified.
- [x] `diff backups/report-before.txt backups/report-after.txt` differs only in
      section 1 (now empty), the freeze-reason wording, and the blockers list.
      **The plan itself must not have moved** — if a retire, update or insert
      count changed, restore.
- [x] The app still works: Calendar, Lesson List, the lesson drawer, Class
      Details, Dashboard. A rescheduled lesson still shows its origin.
      **Verified 2026-08-10 at the API layer, not in a browser.** Against
      `npm run dev`: login `200`; `GET /api/lessons` returns all **1009**;
      `GET /api/classes` all **12**; `GET /api/classes/:id`, `/api/dashboard`
      and `/api/meta/counts` all `200`; July revenue `7,450,000đ`, teaching
      hours `59`, attendance `96%` — each equal to the pre-migration
      `baseline.json`. All **11** stamped lessons come back carrying their
      origin (`L-c3-2026-07-11-1000` sits `2026-07-10 10:00` ← origin
      `2026-07-11 10:00`, 75 min), which is what the drawer renders. The
      collection was still 1009 with an unchanged digest afterwards, so the
      read-side top-up generated nothing. **A human should still click through
      the five screens** — the imported design's rendering is not something an
      API check can confirm.

### 6. Record it

- [x] Keep `backups/before-phase-0/` until Sprint 5.6.4 has been through
      regression. It is the only copy of the pre-migration state.
- [x] Note the applied date and the report digests in the sprint log.

---

## Rollback

Every snapshot generates its own `ROLLBACK.md` with the commands filled in — the
ids, the database name, the digest to check afterwards. Use that file rather than
retyping from here; it is specific to the state it was taken from.

The shape of it:

1. **Undo Phase 0** — `$unset` the three fields on exactly the ids in
   `manifest.json`'s `phase0Targets`. That restores the prior state exactly,
   because those three fields are all the back-fill wrote.
2. **Restore a collection wholesale** — `mongoimport … --mode upsert
   --upsertFields id` from the snapshot's `lessons.json`. Needed only if
   `collateral` was non-zero, which means something other than the origins moved.
3. **Verify the restore** — take a fresh snapshot and check its `manifest.json`
   digest equals the original's, then diff `baseline.json`.

No automated restore ships with the tooling, deliberately. Restoring is a
destructive act on production data and belongs to a person following this list,
not to a script that can be run by accident.

---

## What Phase 0 explicitly does **not** do

| Not done | Why | Where it belongs |
|---|---|---|
| Enable `RETIRE` | A hard delete with no undo. 5.6.3 clears the ground; flipping the flag is one deliberate act. | 5.6.4 |
| Delete the 142 future orphans | Same. They are reported, verified and left alone. | 5.6.4, after this |
| Touch the 178 lessons of Archived classes | An Archived class has withdrawn its intent; class status is not an input capable of mass deletion. | ADR-002 decision 4 — a separate archive-transition sprint, behind §9.1 |
| Touch the 18 lessons whose class was deleted | No schedule to compare against; 6 of them are past and Completed. | A product decision with its own sign-off (§6) |
| Delete the development test classes (`TEst`, `asd`, `asda`, `B2`) | §6 is explicit: removed manually, never special-cased in a migration. | By hand |
| ~~Remove `legacyOriginFallback`~~ | **Done 2026-08-10**, immediately after step 5 as its own change. `reconcileContext` now defaults it to `false`; the only caller that still opts in is the Phase 0 verification itself, which plans both ways on purpose. | — |
| Advance lesson status with the clock | Crosses the future→past boundary this sprint promises never to cross. | §9.2, unscheduled |

---

## Remaining blockers before `RETIRE` may be enabled (5.6.4)

1. ~~**Phase 0 applied and verified.**~~ **Done 2026-08-10** — steps 4 and 5
   above, results in "What was applied".
2. ~~**`legacyOriginFallback` removed**~~ **Done 2026-08-10**, from
   `readReconcileState` and the report scripts, with the test suite green
   (90 passing). The reconciler no longer parses an id to make a safety decision.
3. **The development test classes deleted by hand.** They are ~92% of the orphan
   candidates; retiring them through the reconciler is not what §6 asks for.
4. **A decision on the 18 classless lessons**, with the two facts §6 requires
   established first: whether any of the 6 past ones carries an attendance
   record, and whether the class deletion was intentional.
5. **A fresh snapshot immediately before the flip.** The one taken for Phase 0
   describes a database that no longer exists once Phase 0 has been applied.
6. **The §8 5.6.4 regression list green** — revenue, teaching hours and
   attendance rate identical for every past month; Calendar, Lesson List, drawer,
   Class Details and Dashboard unchanged; drag-and-drop reschedule still
   round-trips; `npm run lessons:duplicates` reports zero forked groups.
