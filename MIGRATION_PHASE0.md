# Migration — Phase 0 checklist (Sprint 5.6.3)

**Status:** prepared, **not applied**. Nothing in this sprint has written to the
database, and `RETIRE_ENABLED` is still `false`.

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

- [ ] All four pass.
- [ ] `RETIRE_ENABLED` is `false` in `src/lib/reconciler.ts`. Phase 0 does not
      change it and neither does this checklist.

### 1. Read the report and keep it

```
npm run lessons:migration-report > backups/report-before.txt
npm run lessons:migration-report -- --digest
```

- [ ] `VERDICT: PASS`.
- [ ] Section 1: **11** lessons, **11** verified as genuine moves, **3**
      load-bearing. Every item reads `PASS`.
- [ ] Section 2: `IDENTICAL`. This is the one that matters most — it says
      stamping the origins changes no reconciliation decision, which is the whole
      claim Phase 0 makes.
- [ ] Section 3: **142** planned retirements, **142** independently verified,
      **1** alone on its date. `EXECUTED 0`.
- [ ] Section 4: `no write action targets a protected lesson`.
- [ ] The two blockers listed under VERDICT are the expected ones: the back-fill
      has not been applied, and `legacyOriginFallback` is still on.

Run it twice and check the digest matches. If it does not, the database changed
between runs and someone is using the app — stop until it is quiet.

### 2. Snapshot (§6 Phase 1) and baseline (§6 Phase 2)

```
npm run lessons:snapshot -- --out backups/before-phase-0
```

- [ ] Four collection exports plus `baseline.json`, `manifest.json` and
      `ROLLBACK.md` exist in that directory.
- [ ] `manifest.json` records **11** `phase0Targets`.
- [ ] Read `ROLLBACK.md` **before** applying anything. It names the exact ids the
      rollback would touch.
- [ ] Copy the directory somewhere off this machine. A snapshot on the same disk
      as the mistake is not a snapshot.

### 3. Cross-check against the independent detector (§6 Phase 3)

```
npm run lessons:duplicates
npm run lessons:reconcile
```

- [ ] Every lesson the detector calls safely removable is retired by the plan.
- [ ] None of its protected candidates is touched.
- [ ] Retirements the detector cannot see are the ones alone on their date — the
      report names them, and there is currently **1**.

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

- [ ] `Lessons written .... 11`.
- [ ] POST-APPLY VERIFICATION: `RESULT: PASS`.
- [ ] `Carrying exactly the expected origin .... 11`.
- [ ] `Wrong target`, `Not stamped`, `Stamped but not targeted`, and
      **`Any OTHER field changed, any lesson`** all `0`.
- [ ] `Lesson count changed .... false`.

Anything other than `PASS` → go to **Rollback** below.

### 5. Verify (§6 Phase 5)

```
npm run lessons:snapshot -- --out backups/after-phase-0
npm run lessons:migration-report > backups/report-after.txt
```

- [ ] `diff backups/before-phase-0/baseline.json backups/after-phase-0/baseline.json`
      shows **no difference at all**. Phase 0 writes only origin fields, which no
      reported figure reads, so even the future months must be identical here.
- [ ] `backups/report-after.txt` section 1 now reads **0** lessons needing an
      origin, and section 3 still reads **142** retirements, all verified.
- [ ] `diff backups/report-before.txt backups/report-after.txt` differs only in
      section 1 (now empty), the freeze-reason wording, and the blockers list.
      **The plan itself must not have moved** — if a retire, update or insert
      count changed, restore.
- [ ] The app still works: Calendar, Lesson List, the lesson drawer, Class
      Details, Dashboard. A rescheduled lesson still shows its origin.

### 6. Record it

- [ ] Keep `backups/before-phase-0/` until Sprint 5.6.4 has been through
      regression. It is the only copy of the pre-migration state.
- [ ] Note the applied date and the report digests in the sprint log.

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
| Remove `legacyOriginFallback` | It may only go once Phase 0 is applied **and** verified. | Immediately after step 5, as its own change |
| Advance lesson status with the clock | Crosses the future→past boundary this sprint promises never to cross. | §9.2, unscheduled |

---

## Remaining blockers before `RETIRE` may be enabled (5.6.4)

1. **Phase 0 applied and verified.** Steps 4 and 5 above.
2. **`legacyOriginFallback` removed** from `readReconcileState` and the report
   scripts, with the test suite still green. Until then the reconciler still
   parses an id to make a safety decision.
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
