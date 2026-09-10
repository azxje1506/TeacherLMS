# Non-negotiable Rules

These rules override all implementation decisions.

- The imported Claude Design is the single source of truth.
- Never redesign existing UI.
- Never improve visual design unless explicitly requested.
- Never change spacing, typography, colors, icons or layout.
- Never replace existing components.
- Never rename routes, folders or components without permission.
- Never refactor working features.
- Never modify Login, Dashboard, Authentication or Database unless explicitly requested.
- If a requested feature requires changing existing working functionality, STOP and ask for confirmation first.

## Missing UI Specification

If the imported Claude Design does not contain a UI element
(e.g. pagination, sortable headers, bulk actions, filters, dialogs),

DO NOT invent one.

Implement the underlying business logic and API only.

Wait until a corresponding design exists before exposing new UI.

## Cross-module Screens

Some screens contain UI for multiple modules.

Only implement the parts owned by the current sprint.

Keep the full layout and navigation exactly as designed.

Future-module sections must render their designed placeholder state until their corresponding sprint.

Do not implement future business logic early.

# English Tutor LMS — Project Rules

Single Design Component: `English Tutor LMS.dc.html`. Keep everything in that one DC (state-driven routing, right-side drawer for create/edit, center dialog for confirms, toast helper). Do not split into child DCs. Implement functionality only. Do not reinterpret or redesign the imported UI. Pixel fidelity is required.

Today (app clock) = **2026-07-10**. Currency = **VND**, formatted `1,500,000đ`.

## Tuition & Revenue
- All tuition fees are entered in **VND** and displayed as a **Monthly Fee (VND/month)**.
- Revenue is calculated **monthly**.
- A lesson contributes to a month based on the month it is **actually completed** (rescheduled/makeup/extra lessons land in the month they're taught, by their date).
- **Completed** lessons contribute to revenue (Regular, Makeup, Extra).
- **Cancelled** lessons are excluded **unless marked chargeable**.
- **Uncompleted / upcoming** lessons are excluded.
- Per-lesson value = monthly fee ÷ number of **regular** lessons scheduled that month (fixed baseline that does NOT shrink when lessons are cancelled). Attendance reduces the amount (Absent students don't count); Extra lessons add on top of the monthly fee.
- Revenue Dashboard should show: Revenue by Class, by Student, by Month, by Lesson Type.

## Student & Parents
A Student may temporarily have no Parent assigned.

Parent assignment is optional during Student creation.

However, features that require parent communication
(finance, reports, notifications, reviews)
must clearly indicate when a Student has no linked Parent.

The indication is required **where parent linkage is relevant to that surface**. It is a disclosure rule, not a statement that the feature addresses parents: naming a feature here does not make its documents parent-facing, and it never blocks anything — a missing Parent stays informational everywhere. In Reports this applies to the Student Payment Report's per-student rows and to nothing else (see *Reports*).

## Parent

Required

- Full Name
- Relationship
- Phone Number

Optional

- Email
- Notes

Relationship options

- Mother
- Father
- Guardian
- Grandparent
- Other

Rules
- One Parent may have multiple Students.
- A Student may have zero or one linked Parent.
- Parent is the source of truth.
- New features must reference Parent by parentId instead of introducing additional duplicated fields.
- Existing legacy fields may remain until a dedicated refactoring sprint.
- Student references Parent by ID only.
- Deleting a Parent must never delete Students.
- Students become Unassigned if their linked Parent is removed.

## Class

Required
- Name
- Monthly Tuition Fee
- Weekly Schedule

Optional
- Level
- Classroom
- Notes

## Class Status

Every Class has a status: **Active**, **Ended** or **Archived**. Status governs future scheduling only — it never changes what a class has already taught.

- **Active** — teaching now. Generates Regular lessons and holds its weekly slots against other classes.
- **Ended** — the teaching is over. Generation stops, the weekly slots are released, and the not-yet-taught Regular lessons the class still held are cleared once, on the transition, from next month onward. The current month is deliberately left alone so that month's revenue baseline does not move. Everything already taught is untouched.
- **Archived** — filed away, and reversible. Generation stops and the weekly slots are released, but existing lessons stay exactly where they are. The class can be restored at any time.

Ended and Archived are never interchangeable: **Ended is a statement about the teaching, Archived is a statement about the working list.**

**Changing a class's status settles its due lessons first.** Applicable lessons are resolved while the old status is still in effect, and only then does the status change. This is what makes Archive → Restore deterministic (see Lesson Lifecycle).

**Restore** returns a class to Active and resumes forward scheduling. It never reverses a lesson that was already settled: a lesson Cancelled while the class was Archived stays Cancelled, because that session did not take place. Lessons that had not yet fallen due are unaffected and resume as scheduled. Lessons are never re-created for dates that passed while the class was Archived.

Revenue is derived from lessons, never from a class's current status. Ending or archiving a class does not change any month's reported revenue.

## Lesson Types
Three types, each supports attendance (Present / Absent / Late / Excused). Attendance always belongs to a **Lesson**, never directly to a Class.
1. **Regular** — auto-generated from the class's recurring weekly schedule.
2. **Makeup** — Group classes only. Created to replace a **cancelled** regular lesson. Linked to the original class. Shows in calendar; counted in attendance + revenue.
3. **Extra** — One-on-One classes only. Additional session outside the regular schedule, any date/time. Belongs to the class. Shows in calendar; attendance tracked; counted in revenue. Can be rescheduled/cancelled independently.

Rules by class type:
- **Group**: fixed recurring schedule, students share it. No Extra lessons. Makeup allowed (only when a regular lesson is cancelled).
- **One-on-One**: flexible. Extra lessons allowed anytime. No Makeup concept needed (reschedule instead).

## Lesson Lifecycle

A lesson's status is **Upcoming**, **Completed** or **Cancelled**.

**Delivery.** A scheduled lesson is considered delivered once its scheduled date has passed. Delivery does not require an attendance record; where none exists, every enrolled student is treated as present. Attendance refines the amount, it does not gate delivery. Cancelling is the only way to withhold revenue from a scheduled lesson (see Tuition & Revenue).

**Resolution.** When a Regular lesson's date passes, its outcome is settled once and stored:

- class **Active** → **Completed**
- class **Archived** → **Cancelled**, not chargeable
- class **Ended**, unrecognised, or no longer present → nothing is written

**Eligibility.** Only Regular lessons that are still Upcoming and whose date is before the app clock are ever resolved.

- A lesson dated exactly on the app clock is not past; it stays Upcoming.
- Future lessons are untouched.
- **Makeup** and **Extra** lessons are outside this transition entirely.
- Existing Completed and Cancelled lessons are never reprocessed or reclassified. An existing chargeable Cancelled lesson keeps its chargeable status.

**What resolution may change.** The lesson's status, plus `chargeable` when cancelling — nothing else. Date, time, duration, classroom, notes, links and reschedule origin are never touched. No lesson is created or deleted, so a month's Regular lesson count — the per-lesson revenue baseline — never moves.

**Repeatable.** Resolution is idempotent. A lesson is settled once and is no longer eligible afterwards, so running it again changes nothing.

**Rescheduling does not change status.** Moving a lesson moves the lesson; the rules above settle it afterwards, according to the class's status at the time it is settled.

**Generation is forward-only.** Regular lessons are only ever created for the app clock's date or later. Nothing is generated into the past, so a date that passed while a class was Archived is never back-filled.

Two items are deliberately **not** settled by these rules and remain open decisions:

- Moving an already Completed, or chargeable Cancelled, lesson across a month boundary shifts a closed month's reported figures.
- Historical lesson records known to be inaccurate are intentionally outside this mechanism, which only ever touches Upcoming lessons. Their cleanup is a separate decision.

Engine detail and rationale: `RECURRENCE_DESIGN.md`.

## Attendance

**Attendance belongs to a Lesson.** Regular, Makeup and Extra lessons all support it. A register refines the value of a lesson that was delivered; it never decides whether it was delivered (see Lesson Lifecycle) and it never changes a lesson's status.

**Eligibility.** A register may be taken for:

- a **Completed** lesson, of any of the three types — including one in a closed month;
- a lesson dated **today** that is still **Upcoming**, because today is not past and the lesson is being taught right now.

Everything else is refused, by the API and not merely by hiding a button:

- a **future** lesson — including one somehow already marked Completed, which is a data fault and not permission;
- a **Cancelled** lesson, chargeable or not — outside the current scope;
- a lesson whose type or status is unrecognised;
- a **past lesson still Upcoming**, which is unresolved: the lifecycle has not yet said whether it was delivered, and marking a register for it would be inventing history. It becomes eligible the moment the lifecycle resolves it.

**The default is a read.** Where no register is stored, every currently resolvable roster student shows as Present with no note — the same assumption revenue already makes. Opening a register writes nothing at all: a teacher who opens a lesson and leaves it changes no data.

**Saving is explicit, and always writes.** A first save whose register is entirely Present still creates the record. It is financially identical to no record, but it is historically different — it is the teacher saying they checked — and the index has to be able to tell "not taken yet" from "taken, everyone was here".

**Status semantics.** **Present**, **Late** and **Excused** all count as attended and are all fully chargeable. **Absent** is the only status that withholds a student's contribution. These are the semantics revenue and the monthly attendance rate already use, and Attendance does not restate or redefine them.

**Notes.** Each student's entry may carry an optional note. A note is descriptive only — it has no bearing on the entry's status, on revenue, or on the lesson lifecycle, and nothing is ever required to have one. Clearing a note removes the stored note rather than keeping an empty one: a note the teacher has deleted is gone, not preserved as an empty historical value.

**Historical correction is allowed.** Past registers, including those in closed calendar months, may be reopened and edited through the same endpoint — no separate path, no month lock, no warning. An explicit teacher correction MAY therefore change a closed month's reported revenue and attendance rate. That is intended: a correction is a statement that the record was wrong.

The permission is for explicit corrections only. Automatic processes — lifecycle resolution, reconciliation, generation — still may not rewrite a historical fact.

**Membership.** The register is the class's current roster ids resolved against existing Student documents, in the class's own order.

- A student appears if their document **exists**. Student status is not consulted, so Trial, Paused and Archived students still appear — they are enrolled and they are in the room. (Finance's separate rule about Archived students is a different question and is deliberately not copied here.)
- A roster id with no Student document is simply omitted. It is not repaired, reported or written back.
- Stored entries for students who no longer exist are **preserved**. They are never shown, never counted in a register's own summary, and never erased: a save writes only the students it was given, one key each, and leaves every other stored entry exactly as it was. A request naming an id outside the visible roster fails entirely, with nothing written.

**Date ownership.** The **Lesson** owns the date. `AttendanceRecord.date` is a legacy mirror kept only for backward compatibility with existing documents; it is never read, never written and never updated. Some stored records carry a date that disagrees with their lesson's — the lesson wins.

**No timestamps.** Nothing records when a register was written, so no "last updated" is shown anywhere. A derived one would be a guess presented as a fact.

## Homework

**Homework belongs to a Class.** An assignment is addressed either to the whole class or to one student in it, and it is never attached to a lesson — moving, cancelling or regenerating a lesson has no effect on any homework, and setting homework never freezes a lesson.

**Only an Active class may be given new homework.** An Ended class's teaching is over and an Archived class is filed away; homework is an instruction for work not yet done, so neither may receive more of it. This governs NEW work only. A class's status never changes what it has already been set: existing homework stays listed, editable and counted whatever its class later becomes.

**Scope is fixed at creation.** A **class-scoped** assignment is addressed to the class and records one outcome per student. A **student-scoped** assignment is addressed to one named student, who must exist and must be on that class's roster, and its single outcome is the assignment's own status.

**Membership is a snapshot.** A class-scoped assignment records the class's roster as it stood when the work was set — the ids that resolve to existing Student documents, in the class's own order. Student status is not consulted, so Trial, Paused and Archived students are still given the work: they are enrolled. A roster id with no Student document is simply omitted; it is not repaired, reported or written back, and it is never copied into new work. A class whose roster resolves to nobody may still be given class-scoped work — it simply addresses nobody. Later changes to the roster do not reach back into homework already set.

**Status vocabulary.** An assignment, and each student's outcome within one, is **Assigned**, **Completed**, **Late** or **Missing**. New homework is always **Assigned**, which means no outcome has been recorded — not that the work has failed.

**The due date is not a lifecycle.** A date passing changes no stored data: nothing becomes Late, Missing or overdue on its own, and an assignment stays Assigned until somebody says otherwise. A past due date may be set deliberately — back-dating work that was set last week is a correction, not an error.

**Completion counts Completed and Late as done.** Work submitted late was submitted. **Missing** — never done — is the opposite of done, and **Assigned** counts as neither: it is excluded from the measure entirely rather than counted as a failure. Late stays separately labelled everywhere it is shown, so nothing is lost by counting it. An assignment contributes to the month of its **due date**.

**Ghost outcomes are preserved and still counted.** Stored outcomes belonging to students whose documents no longer exist are the only record that those people ever did that work. They are never erased and never restated: they keep counting in monthly reporting exactly as stored. They are also never shown — the roster cannot resolve them — and they are never disclosed to a client. A student's later deletion must not move a closed month's reported figures.

**A student-scoped assignment whose student is gone is preserved, still counted, and not listed.** The card is addressed to somebody and there is no name to render, so the record is omitted from the screen rather than shown with an invented placeholder. Not being listed is also not being reachable: what the index omits, the system refuses to edit or delete. Being unseen is not being forgotten.

**Only what a teacher authored may be edited:** title, description, due date and teacher notes. **Ownership is immutable** — an assignment's class, scope, assignee, status and recorded outcomes are fixed when it is created. Homework addressed to the wrong class is deleted, if it is still pending, and set again.

**Historical correction is allowed**, with no month lock and no warning. Changing a due date may move an assignment between months and may therefore change a closed month's reported completion. That is intended: a correction is a statement that the record was wrong.

**Only pending homework may be deleted.** While an assignment is **Assigned** no outcome has been recorded against it, so removing it destroys no history. Completed, Late and Missing assignments are historical records and are refused — by the rule itself, not merely by hiding a button. An overdue assignment that is still Assigned is still pending and stays deletable; a date passing settles nothing. Because Assigned work is excluded from completion, deleting it can never move a month's reported figure.

**Duplicating homework writes nothing.** It opens a new assignment prefilled with the teacher's own words — title, description, class, scope, assignee and notes — with the **due date deliberately blank**, so the teacher states a date rather than inheriting one that is already past. No outcome is ever copied: a duplicate is new work, born Assigned. If the original's class may no longer be assigned to, or its student is no longer on that roster, the prefill leaves the field unset rather than carrying a value that would be refused.

**No timestamps.** Nothing records when an assignment was last changed, so no "last updated" is shown anywhere. A derived one would be a guess presented as a fact.

## Reviews

**A Review belongs to a Student and a month, and to nothing else.** It is the teacher's assessment of how one student's month went: ten skill ratings and the words about them. There is no `classId` and no `lessonId` on a Review, deliberately — a student who is taught in two classes had one month, not two, and a review is not a record of a session. Moving, cancelling or regenerating a lesson has no effect on any review, and writing a review changes no student, parent, class, lesson, register, assignment or bill.

**The month is always the teacher's explicit statement.** The server never substitutes the current month for a payload that omitted one: which month a review is about is a claim, not a default. The client never computes a month either — the selectable months arrive from the server, and the form picks one of them or none.

**The selectable window is the application month plus the previous eleven** — twelve months ending at the present. Both edges are refusals, for different reasons: a **future** month has not been taught yet, so there is nothing to report on; a month **twelve or more back** is beyond the year the teacher works in, and writing a fresh review into it would be inventing a record rather than correcting one. A month a student already has stays **visible in the list, marked as taken**, because a teacher needs to see that June is done rather than wonder where it went.

**One review per student per month.** `(studentId, month)` is unique. A second create for a month that is already taken is refused as a conflict; it never silently becomes an edit.

**Student status gates Review Create — and this is a deliberate divergence from Attendance and Homework.** A new review may be written only for a student who is **Active**, **Trial** or **Paused**. Attendance does not consult student status at all (an enrolled student is in the room, whatever their status) and Homework does not either (an enrolled student is given the work). Reviews is different because a review is an *assessment authored about a person*, not a record of something that happened to them: **Archived** means that student has been filed away, and there is no month of theirs left to report on. The rule fails closed — a status this build does not recognise is not a permission, and neither is a student who does not resolve.

**The gate is on Create, and only on Create.** An Archived student's existing reviews stay **visible and editable**: they describe months that happened, and archiving the student afterwards does not make those records uncorrectable.

**Ghost reviews are preserved, and unreachable.** A review whose student no longer exists is never erased — it is the only record that the assessment was ever made. It is also never shown, never counted into a card, and never disclosed: it raises no row on the Reviews index, the student payload that would carry it 404s, and a guessed id is refused with the **same** answer a genuinely missing review gets. A distinct error would advertise the existence of a record nobody may see. Being unseen is not being forgotten.

**Exactly ten dimensions, every time, in canonical order:** listening, speaking, reading, writing, grammar, vocabulary, pronunciation, confidence, participation, homework. Each is an **integer from 1 to 5** — the scale has five points, not nine, and an unrated skill is a refusal rather than a silent zero. A review missing a dimension is refused; so is one carrying an eleventh.

**The average is the arithmetic mean of those ten, equally weighted, and is never stored.** No skill counts for more than another, the divisor is the vocabulary rather than however many keys a document happens to hold, and the value is derived on demand. Storing it would be a second copy of the same fact, free to drift from the first. **There is no lifetime or rolling average anywhere**: a card's score is the latest review's alone.

**At least one assessment note must be written.** Each of comment, strengths, improvements and goals is optional on its own — a teacher who says everything in the comment should not have to repeat it under three headings — but at least one of the four must survive trimming. **`parentNotes` does not satisfy this**: it is a message addressed to the family, not the teacher's account of the month, so a review carrying only parent notes has recorded no assessment at all.

**Ownership is immutable.** An edit may change the ten ratings and the five text fields, and nothing else: `id`, `studentId` and `month` are fixed at creation. A review that names the wrong student, or the wrong month, is a different review — it is written again, not corrected. Historical correction of the *content* is otherwise unrestricted: no month lock, no warning, and the twelve-month window is irrelevant to an edit because the record already exists and correcting it invents nothing.

**No Delete.** A review is a historical record of a month. Nothing in the application removes one — not by hiding a button, but because no endpoint exists that could.

**No lifecycle and no timestamps.** A review has no status: there is no Draft, no Published, no Final, and no workflow of any kind. It is written or it is not. Nothing records when one was written or last changed, so no "last updated" is shown anywhere — a derived one would be a guess presented as a fact.

**Parent linkage is informational and never blocking.** A student may legitimately have no linked parent, and reviews are one of the features required to say so clearly (see Student & Parents). A `parentId` matching no Parent document is *not* a link, and is shown as such. It blocks nothing: a review may be created and edited for a student with no parent, and nothing is notified.

**Nothing about a review is derived from other domains.** Ratings are not inferred from attendance, from homework completion, from a previous review, from the student's status or from their class, and no starting value is a suggestion computed from data. A review is the teacher's judgement; a prefilled score would be the system putting words in their mouth.

**The composer is one surface with three stages: Create, View and Edit.** A saved review opens as something a teacher **reads** — the values, the report, no save control — and becomes editable only when they say so. Create has no view stage; there is nothing saved to look at yet. **The stage is screen state and nothing else**: it is never persisted, never sent and never read back, there is no `/edit` address, and it is not a lifecycle (see *No lifecycle*, above). Create lives at `/reviews/new?studentId=…` and a saved review at `/reviews/{reviewId}` — the edit address names the review and never the student, because the Review owns that relationship and a URL must not be able to disagree with the record about whose it is.

**Leaving with unsaved work always asks first, and asks once.** Closing the composer, switching the Create month and cancelling an edit are the three ways to lose typed work, and all three raise the same single confirmation. A pristine form leaves silently, and a successful save is never dirty.

**Attendance and homework figures on a review are read-only, and are the server's.** They arrive per month on the composer's read model, already derived by the domains that own them. The review neither stores nor recomputes them: typing cannot move them, and changing the month moves them only because a different month genuinely has different figures. An empty denominator is **`No data`**, never `0%` — "nobody took a register" and "this student attended nothing" are different facts.

**The report is generated, never stored.** One `MonthlyReviewReport` is derived from the ten ratings and five fields currently on screen plus those server figures, and it is the single source for all three outputs: the **live preview**, **Print** and **Export PDF**. Nothing about it is persisted — no generated-on timestamp, no rendered copy, no cached document — and generating one writes nothing.

**Print and Export PDF act on the draft, not on the record.** Both work in all three stages, including a Create that has never been saved and an Edit with unsaved changes: the document is a generated artifact of the composer's current state, not proof that a Review exists. Neither saves, neither clears dirty state, and neither requires a save first. **`Generated on` is document metadata** taken from the application day; it is not a Review timestamp and creates none.

**Analytics are derived on demand and stored nowhere.** The Student Profile's Reviews tab carries the overall-score group, attendance and homework summaries, a skill radar with a previous-month comparison, a score trend, a score-distribution donut, a skill heatmap, the monthly learning journey, and the strengths / focus-areas ranking. Every one is computed from reviews that already exist; none writes, and none introduces a stored aggregate.

**Still deliberately absent, and absent whole rather than stubbed:** an **AI summary**, an **achievement** line and a **concern** line. No stored field carries any of them and no deterministic rule produces one, so none is derived on any Reviews surface — including the printed and exported document, which cannot contain a section the screen does not have. **Global Search** is likewise deferred: the header seam exists and forwards to nothing. None of these is drawn as a disabled placeholder that would suggest it already works.

**The `(studentId, month)` unique index now exists in production**, as `review_student_month_unique`, created explicitly in Gate 5.1; the matching schema declaration was added in Gate 5.2. Creating it was a production DDL change, which is why it belonged to Gate 5 rather than to a feature gate, and why it happened in that order — production first, declaration second, because `autoIndex` is left at its default and a declaration alone would have built it implicitly on the next deploy. **The service's own `(studentId, month)` check remains**: the index is the concurrency guarantee, the service is the error path a teacher actually reads. Nothing about the rule changed — only where it is now also enforced.

## Billing

**A Billing record is one month's tuition for one student in one class.** It is what the teacher expects to collect and what they have collected against it — nothing more. `(studentId, classId, month)` identifies it, and the generated id `B-<classId>-<studentId>-<YYYY-MM>` states that triple in a readable form. A student taught in two classes has **two** bills that month, because they owe two tuitions; `(studentId, month)` is therefore **not** a uniqueness rule and never becomes one. The rule Reviews uses does not transfer: a student has one month, but they can have several tuitions.

**Billing is not Revenue, and neither is derived from the other.** Revenue is money *earned by teaching* — lesson-derived, attendance-aware, owned by `Lesson.date`, and governed entirely by *Tuition & Revenue* above. Billing is money *asked for and received* — owned by `Billing.month`, a tuition period rather than a teaching record. A bill is **never** generated from completed lessons, and a lesson never creates, updates or settles a bill. The two answer different questions about the same month and they are allowed to disagree; a screen that showed one under the other's name would be stating something the data never said. The separation is enforced in the code's own vocabulary: bill-derived figures are `billed`, `collected`, `outstanding` and `collectionRate`, and no bill-derived field, type, helper or test is ever named `revenue`.

**`Billing.fee` is a historical snapshot of the class's monthly fee for that period**, fixed when the bill was raised. Editing `Class.fee` changes what future tuition is, and reaches back into no existing bill. This is deliberately **not** the duplication *Data Ownership* forbids: that rule bars a cached copy of a value another entity currently owns, and this is not a cache — it is the record of what was asked for at the time, which the Class no longer knows and cannot be asked. Finance reads `Billing.fee` for every tuition figure. Revenue continues to read `Class.fee`, because a per-lesson value is a statement about teaching that is priced now.

**No stored figure is normalised, clamped or corrected on read.** A fee that disagrees with the Class it came from is reported as it stands, on both sides, because a screen that quietly reconciled them would conceal the disagreement rather than surface it. Correcting stored data is a separate, explicitly authorised act — never a side effect of displaying it.

**The stored statuses are exactly `Paid`, `Partially Paid` and `Unpaid`.** There is no `Overdue`, no `Pending`, no invoice state and no receipt state. **There is no due date and no lifecycle**: a bill has a month, not a deadline, and a date passing changes no stored data — the same rule Homework already states about its own due dates, for the same reason. Nothing becomes anything on its own; a bill's status is what a teacher last said it was.

**A partial payment states its amount or states nothing.** `paidAmount` is stored **only** on a `Partially Paid` bill, as an integer VND strictly between zero and the fee. `Paid` means settled in full, so its collected value **is** the fee and storing a second copy of it would be duplication; `Unpaid` means nothing was collected, so its collected value is zero. Where a `Partially Paid` bill carries no `paidAmount` — every such record predating this rule does — the amount collected is **unknown**, and is shown as **`No data`, never as zero and never as half**. "Nothing was recorded" and "nothing was paid" are different facts, exactly as an empty attendance denominator is `No data` rather than `0%`. No rule anywhere derives an amount from a status. A total over a scope containing an unknown amount is itself unknown, and says so alongside a count of the records responsible; it is never completed with a guess.

**`paidDate` is the day money was received**, and it exists precisely when money was received: required on `Paid` and `Partially Paid`, and `null` on `Unpaid`. **A new or corrected `paidDate` may not be in the future** — money is not received on a day that has not happened, and the application day is the boundary. The refusal governs writes only: existing records dated ahead of the app clock are preserved untouched, because they are what the system holds and correcting them is a separate, deliberate decision.

**Ghost bills are preserved, still counted, and not listed.** A bill whose student no longer exists is the only record that the money was asked for, and it is never erased. It **keeps counting in every monthly total** — billed, collected, outstanding, status counts, per-class rollups — because a student's later deletion must not move a closed month's reported figures, which is the rule Homework already holds its own ghost outcomes to. It **raises no row** on any list of people: there is no name to render, and a working list of who still owes money cannot contain somebody who is gone. What the lists omit, the system also refuses to edit: a request naming a ghost bill is refused with the **same** answer a genuinely missing bill gets, because a distinct error would advertise the existence of a record nobody may see. Where unlisted records contribute to a total, the count of them is shown as the design's own **"+N more"**, never as a placeholder row for somebody who is gone — a row is a person, and there is no person left to name.

**Only what a payment records may be edited:** status, `paidAmount`, `paidDate` and notes. **Ownership is immutable** — `id`, `studentId`, `classId`, `month` and `fee` are fixed when the bill exists. A bill against the wrong student, class or month is a different bill. Historical correction of a payment is otherwise unrestricted: no month lock and no warning, because a correction is a statement that the record was wrong.

**Student status never gates a payment.** A Trial, Paused or Archived student's tuition is still owed and may still be settled; archiving a person does not forgive their February. This is deliberately unlike Reviews, where status gates Create because a review is an assessment *authored about* somebody — a payment is an event that happened to money. What is refused is a bill whose student does not resolve at all, and that is the ghost rule above rather than a statement about status.

**Nothing about a bill is derived from another entity, and Finance writes nothing outside Billing.** No Student, Parent, Class, Lesson, Attendance, Homework or Review is written when a payment is recorded. In particular `Student.balance` is **never read and never written** by Finance: outstanding tuition is computed on demand from bills, and a stored copy would be a second answer free to drift from the first.

**Parent linkage is informational and never blocking.** A student may legitimately have no linked parent, and Finance is one of the features required to say so clearly (see *Student & Parents*). A `parentId` matching no Parent document is not a link and is shown as such. It blocks nothing: a bill is viewable and a payment recordable for a student with no parent, and nothing is notified.

**The reportable window is the twelve months ending at the application month**, and the server supplies it — the client computes no month, exactly as it computes none for Reviews. A month holding no bills is empty, not absent.

**No timestamps.** Nothing records when a bill was raised or when a payment was last edited, so no "last updated" is shown anywhere — a derived one would be a guess presented as a fact.

**No Billing create and no Billing delete.** Every bill in the system was raised by the seed. Raising tuition is a generation rule that does not yet exist and is not invented here; deleting a bill destroys financial history and no endpoint exists that could. **Recording a payment exists as a capability and not yet as a screen**: the rule, the validation and the endpoint are complete, and no control is drawn for them until a payment form is designed. A disabled button that suggests a working feature is worse than its absence.

## Reports

**Reports is a read-only reporting surface.** It generates teacher-facing summaries from data other domains already own, and it owns presentation and composition only. It does not own Billing, Revenue, Attendance, Homework, Lesson or Review calculations, it does not restate their semantics, and it does not become a second place those questions are answered. Where a figure exists, Reports calls the helper that owns it; where one does not, Reports does not invent it. It owns nothing about the meaning of a period or a scope either — the selected period is handed to the owning domain's own month rule, unchanged.

**A report is generated, never stored.** There is no Report model, no reports collection, no report id, no report status, no saved report history and no cached rendered document. There is no lifecycle: no Draft, no Issued, no Sent, no workflow of any kind. Selecting filters, previewing, printing and exporting a report all perform **zero database writes** — no document in any collection is created, updated or deleted, no lesson lifecycle is advanced, nothing is reconciled, nothing is generated and no index is created. `Generated on` is document metadata taken from the application day; it is not a report timestamp and creates none. This is the rule Reviews already holds its own monthly report to, for the same reason: a second stored copy of a derived fact is free to drift from the first.

**Five report types, and no others.** Monthly Revenue Report, Class Revenue Report, Student Payment Report, Attendance Summary and Homework Summary. Each delegates to the domain that owns its arithmetic — `computeRevenue` for the two revenue reports, the Billing totals for payments, the attendance rate helpers, the homework completion helpers — and none of them recomputes, adjusts or rounds a figure a second time.

**There is no Reports student academic report, and `Performance Summary` is not a Reports type.** The **Monthly Progress Report is Reviews-owned** and stays there. A second document over the same ten ratings, the same average, the same two derived metrics and the same month would be the same report twice, differing only in layout, and `/reports` is never routed into a second implementation of Reviews. An unused dictionary string is not an authorisation.

**The period is one canonical `YYYY-MM`, and the server owns the window** — the application month plus the previous eleven, newest first, the same rule Billing and Reviews already state. The client computes no month and holds no clock. A month in the window holding no data is **empty, not absent**. The seed's `FINANCE_MONTHS` constant is the seed's billing window, is never read as a runtime reporting window, and treating it as one would freeze the application to its demo data.

**Each report's period means what its owning domain means by it.** Revenue is owned by `Lesson.date` — the month a lesson was actually taught. Student Payment is owned by `Billing.month` — a tuition period, not a teaching record — and `paidDate` never replaces it. Attendance is owned by the **Lesson**; `AttendanceRecord.date` is a legacy mirror and is never read. Homework is owned by the assignment's **due date**, never its creation or completion date. Reports introduces no third interpretation of a month, and two reports for the same selected period may legitimately cover different underlying sets.

**Billing and Revenue are different concepts and are never merged.** Billing is money asked for and received; Revenue is money earned by teaching. They may legitimately disagree, they may both appear in the Reports selector, and **no single report body ever contains both** — one sheet with one masthead and one table has no way to say which definition a number belongs to, and a screen that showed one under the other's name would state something the data never said. No bill-derived field, column, tile, helper or test in Reports is ever named `revenue`.

**No figure is guessed and no figure is corrected on read.** A `Partially Paid` bill with no recorded amount is `No data` — never zero, never half, never derived from its status, and never inferred from anything else. `unknownAmount` is the **fee** of such a bill, not a payment amount, and is never folded into collected or outstanding. A collection rate over an incomplete scope is a **floor**, never an exact percentage, and is presented as one. An empty attendance denominator is `No data`, never `0%`, and coverage is stated beside a rate rather than assumed. `Completed` and `Late` count as done, `Missing` does not, and `Assigned` is excluded from the measure entirely. A stored fee that disagrees with its class's fee today is reported exactly as stored; correcting it is a separate, explicitly authorised act and never a side effect of displaying it.

**Scope is per report type, and the smallest scope that matches the report's own name.** Monthly Revenue is studio-wide only — a class-scoped one would be the Class Revenue Report, and two types that collapse into each other under a filter are one type. Class Revenue is studio-wide or one class. Student Payment, Attendance Summary and Homework Summary are studio-wide, one class, or one student. A scope control a report does not use is **disabled showing its sentinel**, never hidden and never removed: the designed layout does not change because a filter does not apply. Where both apply, choosing a class filters the student options to that class's currently resolvable roster, in the class's own order.

**Ghost records are counted where their own domain counts them, and named nowhere.** A record whose student no longer exists keeps contributing to every aggregate its owning domain already includes it in — a deletion must not move a closed month's reported figures. It raises no row: a row is a person, and there is no person left to name. No id, name or attribute of such a record ever reaches a client, and a guessed id is refused with the same answer a genuinely missing record gets.

**Reports never invents a count.** Where the owning domain already supplies a neutral hidden-record count — Billing's `hiddenRecords`, which the design renders as its own "+N more" — Reports may surface that count. **Where the owning domain supplies no such count, Reports shows none.** That absence is a fact about the domain, not a gap for Reports to fill: no hidden count, ghost count or reconciliation count is ever derived, and no cross-domain ghost algorithm exists. **Each domain's ghost rule is preserved independently**, because one filter applied across every domain would silently move figures in at least one of them. Reports repairs nothing, reconciles nothing, infers no person row and writes no roster fix.

**Archived students follow the owning domain's own rules.** Their tuition is still owed, they were still in the room, they were still given the work, and Reports adds no status filter of its own. Reviews' Create gate is about authoring an assessment and is not copied into a read surface.

**Reports are teacher-facing analytical documents.** They are not a parent-communication feature: there is no salutation, no recipient block, no address, no signature, no send action and no notification anywhere in Reports. A missing Parent **never blocks generation**, for any report type.

**One report carries the missing-parent indication: the Student Payment Report.** Its per-student rows use the same `parentLinked` boolean Finance already carries and show the same `No linked parent` line, because it is the one Reports document about money asked of a family and it is built on the rows Finance already annotates (see *Student & Parents*). No parent name, phone, email or address is carried anywhere in Reports, and no parent name is ever invented. Monthly Revenue, Class Revenue, Attendance Summary and Homework Summary carry **no** parent indicator: parent linkage has no bearing on whether teaching was earned, a lesson was attended or homework was done, and an indicator there would be decoration rather than disclosure.

**The preview is derived, and there is no Generate button.** A valid selection produces a preview automatically; an incomplete selection shows the design's own empty state rather than an error, and destroys nothing. The Dashboard's "Generate report" is navigation to this screen and generates nothing itself.

**One content model feeds the screen, Print and PDF**, so a report cannot say one thing on paper and another on screen. **PDF** is generated client-side onto **A4 portrait** — landscape is never used — with the application's Unicode font; if that font cannot be loaded nothing is produced, because a document with a family's name mangled would open cleanly and be wrong. No generated file is persisted anywhere and no server-side file URL exists. **Print** has its own isolated Reports scope and does not borrow, extend or alter the Reviews print path. Both act on what is currently derived, and neither writes.

**Excel is deferred and CSV is out of scope.** The reference implementation is not ported, CSV is not substituted for it, and **no disabled Excel control is drawn** — a disabled button that suggests a working feature is worse than its absence. The Reports action row therefore carries two controls, Export PDF and Print, where the reference design draws three; that divergence is deliberate and is authorised here. The Classes row menu's `Export report` action has no destination, scope or format in the design and is likewise not built.

**The document carries neutral application branding.** No author is named anywhere, because nothing in this data model records who wrote a report, and the seeded account is never derived into authorship. The reference design's studio name and "prepared by" line are demo content, not contract. Custom branding waits for an explicit source of truth.

**The Reports screen stacks below 768px, and this is an authorised divergence from the reference design.** The design draws one layout — a fixed 300px options rail beside the preview — which leaves roughly fifty pixels for the document on a phone. Below 768px the rail therefore stacks above the preview at full width, its hard 300px track and its sticky behaviour are dropped where sticky would collide with the app header, the Month and Year controls may stack at the narrowest widths, and a wide table may scroll horizontally inside its own bounded container within the sheet. **The page itself never scrolls horizontally, and neither the printed nor the exported document may depend on that screen scroller.** Every other width is the design's own, and no other screen's responsive behaviour is changed.

**No timestamps.** Nothing records when a report was viewed, generated or exported, so no "last generated" is shown anywhere — a derived one would be a guess presented as a fact.

## Calendar
Events display a lesson-type badge: **Regular / Makeup / Extra**, plus attendance status indicator for past lessons. Clicking a lesson opens the drawer (never navigates away). Drag-and-drop reschedules.

## Settings

**Settings exposes preferences the application already has; it does not introduce a settings architecture.** The `SettingsProvider`, the bound formatter, the translation layer, the `[data-theme|data-accent|data-surface|data-spacing]` CSS tokens and the `etlms.*` `localStorage` keys all predate this module and are already read by every screen in the product. Settings is the page that makes them reachable, and nothing more. It creates no second store, no parallel state, no new key and no new vocabulary.

**A setting is authorised only where something already reads it.** Nine settings qualify and no others exist in this module. **Appearance** — Theme (`Light`, `Dark`), Accent colour (`Crimson`, `Indigo`, `Emerald`, `Slate`), Surface (`Soft`, `Flat`, `Elevated`), Density (`Cozy`, `Airy`, `Tight`). **Language & Region** — Interface language (`Tiếng Việt`, `English`), Date format (`DD/MM/YYYY`, `MM/DD/YYYY`, `YYYY/MM/DD`), Time format (`12-hour`, `24-hour`), Currency (`VND`, `USD`), Number format (comma grouping, dot grouping). Each is a closed enumeration; a value outside it is not a setting, it is a defect. **No other configurable setting is authorised**, and a setting is never added because it would be easy to store — Settings is not a home for arbitrary configuration.

**Notifications are deferred, and no part of them is drawn.** The reference design carries a Notifications card here and a bell dropdown in the header, but the application has no notification source, builder, model, menu, unread count or read state, and the two reserved keys `etlms.notifDismissed` and `etlms.notifRead` are read by nothing. Settings therefore builds **no notification system, no bell dropdown, no unread count, no "Mark all read", no dismiss or read state — and renders no Notifications card at all, not even an inert one**. A control that acts on data the product does not have is a promise the application cannot keep, which is the same reason the header's search triggers stay inert rather than pretending. The unused storage keys are left exactly as they are. Notifications require their own sprint.

**Currency is a display preference and never a statement about stored money.** Tuition, fees, billing and every derived revenue figure remain **integer VND in the database and in every calculation**, exactly as *Tuition & Revenue* and *Billing* define them. Choosing `USD` changes how an amount is *rendered* and nothing else: no stored value is converted, rewritten, migrated or reinterpreted; no Finance business logic, class-fee storage, database document, API or schema changes. USD rendering continues to use the application's existing fixed demo conversion rate and introduces no new one, no live rate and no rate setting. **This does not redefine Finance's source currency**, which is VND. Labels that describe a data-entry unit — `Monthly fee (VND/month)` and its kind — correctly keep saying VND, because the value being entered is VND whatever the display preference says. Stored monetary data is never silently reinterpreted as USD.

**Invalid stored preferences fall back to their defaults.** The store reads raw strings out of the browser, so a stale, hand-edited or truncated value can otherwise reach the document as an appearance with no matching token block. Settings owns this: each stored value is validated against the authorised enumeration above, and anything that fails validation is replaced by the existing default. **No new storage key, no storage migration, no schema migration and no API** — and a valid stored value behaves exactly as it does today, so this is a hardening of the reader and not a change of behaviour.

**The default language stays `vi`, and `English` becomes reachable.** `en` uses the existing source-string fallback — the English source string *is* the key — so no second dictionary is introduced for it. Changing the language applies immediately across the application; no reload is required, and none is suggested.

**Preferences are device-local and save themselves.** The persistence model is the existing `localStorage` under the existing `etlms.*` keys, written through the existing `SettingsProvider` setters — the appearance setter, the language setter and the regional setter. Every change applies **immediately**: there is **no Save button, no Apply button and no form submission** anywhere on the page. There is **no database write, no server action, no Settings API route, no Mongoose Settings model, no preference field on the User model, no cookie change, no JWT change and no change to the authentication flow.** The page never holds a duplicate source of truth for a preference.

**Every control reads its selected state from the shared store.** The Settings page holds no `useState` copy of appearance, language or regional preferences, and performs no `localStorage` read or write of its own. The one path is: control → existing setter → existing store → existing consumers. Because the header's theme toggle reads the same store, the header and the Settings theme control stay synchronised in both directions by construction rather than by an effect.

**The Workspace card is read-only.** It may display the account name, the email, the current currency preference and the application day, and it displays them; it edits nothing. Settings introduces **no name editing, no email editing, no avatar, no role editing, no password change, no authentication-provider settings and no session management.** Where the page needs the signed-in identity it receives only those read-only values from a server-owned boundary, the way the application shell already receives them; client code does not fetch the session a second time.

**One page, four regions, no tabs.** The page heading, then the Appearance card, then the Language & Region card, then the Workspace card. There is no Notifications card. There is no tabbed settings shell, no modal settings editor, no new global navigation and no sidebar change — the Settings nav item already exists at `/settings` and stays exactly where it is.

**The design reference supplies the layout, and these are its anchors.** Content column `max-width: 760px`. Card shell: padding `20px 22px`, `16px` bottom spacing, `--card` background, `--border` border, `--r` radius, `--sh` shadow. Page heading `24px` / weight `600` / letter-spacing `-.02em`. Accent swatches four across on desktop with a `10px` gap. Surface and Density share a two-column sub-grid targeting `520px`; the four regional groups share a two-column sub-grid targeting `560px`.

**At mobile width the page must not overflow horizontally.** The two-column sub-grids collapse to one column, the accent swatches stay usable, and segmented controls wrap or adapt rather than run off the edge. **A responsive rule must not be one that loses to an inline `grid-template-columns`** — this repository has shipped that exact dead rule more than once. Responsive behaviour belongs to a class the stylesheet owns; `!important` is used only where it is consistent with the existing responsive layer and genuinely required to beat a ported inline declaration.

**Settings changes presentation and never meaning.** The only downstream effects it may have on already-closed modules are the presentation effects those modules already support: translated strings, date formatting, time formatting, number grouping, currency rendering, theme, accent, surface and density. **Preserved without exception:** stored monetary values, Finance calculations, Reports data selection and arithmetic, Reviews data, Attendance semantics, Homework semantics, the Classes data model, Student and Parent data, and application-clock semantics. **There is no configurable timezone, no configurable application clock or `TODAY`, no report-branding setting, no school or organisation setting, and no class, homework, attendance, finance or reports default.**

**Settings owns no data.** No Settings collection, no Settings model, no schema field, no index, no production DDL, no new dependency, no billing or subscription surface, and no cross-device preference sync. Preferences live on the device that set them, which is what the page tells the teacher.

**One banked test expectation — since discharged.** `tests/reports-ui.test.ts` asserted that the Settings route still rendered `ModulePlaceholder`. Replacing the placeholder was expected to invert that assertion, and the inversion had to land in the same gate that replaced the page. **That failure was authorised in advance and was not a regression.** It landed in `594f5ab`: the assertion was inverted rather than deleted, because what it has always checked is that a sprint does not edit a screen that is not its own. The shared `ModulePlaceholder` component itself stays, for the modules that still use it.

## Notifications

**Notifications are an internal teacher-facing awareness surface, and nothing is ever sent.** They exist only inside the authenticated Teacher LMS shell, they are read by the signed-in teacher, and they represent **no communication delivered to a parent or a student**. Sprint 12 introduces **no email, no SMS, no `mailto:`, no browser push, no push-service integration, no parent-facing or student-facing delivery of any kind, and no reminder-sending action from Finance, Reports or any other module.** The bell is a read-only awareness layer over domain state the application already owns. This does not soften *Reports*, which continues to carry no notification anywhere, nor the Finance rule that no reminder or send control is drawn — naming Billing, Lessons and Reviews as notification **sources** does not make any of them a communication surface.

**The bell dropdown is the whole surface.** Notifications live exclusively in the existing header bell, which stops being inert and becomes interactive. There is **no `/notifications` route, no sidebar Notifications item and no dedicated Notifications page** — the sidebar's twelve items are unchanged. The dropdown follows the imported design reference and is not redesigned.

**Exactly three notification types ship, and a fourth is a contract change rather than a feature.**

**A. Unpaid tuition.** A Billing record whose status is currently `Unpaid` or `Partially Paid` produces one notification. A `Paid` record never produces one. One qualifying Billing record produces **at most one** active notification. When the record becomes `Paid` or otherwise stops qualifying, its notification disappears on the next derivation. The notification is derived from Billing state and **never modifies Billing state**.

**B. Upcoming makeup.** A makeup lesson produces one notification when it exists, is active and not retired, is not cancelled, has not already passed, and falls **within the next 7 calendar days, inclusive**. The window is measured with the application's existing canonical date and time behaviour — Sprint 12 introduces **no configurable timezone and no new application clock**, and `TODAY` keeps the meaning it already has. A lesson outside the window does not appear; a retired, cancelled or deleted lesson does not appear. If the source lesson later stops qualifying the notification disappears, and **no notification history is retained**.

**C. Review due.** A notification is produced when the relevant review period has completed **and** the expected Review record for that student and context does not yet exist. Its purpose is to say that a required review is still missing. Once the expected Review exists the notification disappears, and **a saved or completed Review never generates a notification of its own** — a teacher does not need telling about a record they just wrote. Sprint 12 introduces no AI summary, achievement or concern generation, which remain deferred exactly as *Reviews* leaves them.

**Notifications own no data.** There is **no `Notification` Mongoose model, no Notification collection, no notification schema, no index, no migration, no backfill and no persisted copy of any Billing, Lesson or Review value.** Every notification is derived at read time from entities that already own their data, which is what *Data Ownership* requires: the notification references its source and never duplicates it. The existing `Activity` model is **not** a notification source and must not be repurposed into one — it is a seeded, pre-rendered dashboard feed whose `ago` string is frozen at seed time, and making it an event log would be a redefinition rather than a reuse. **No notification interaction may write to Billing, Lesson, Review, Student, Parent, Class, Attendance, Homework or any other domain collection.**

**Source data is server-owned; acknowledgement is device-local.** The list is derived from existing server-owned domain data through the existing data-loading architecture. The acknowledgement state uses **only the two already-reserved keys, `etlms.notifRead` and `etlms.notifDismissed`** — the keys the design shipped and that nothing has read until now. **No third notification key is added, neither key is renamed, there is no server-side acknowledgement persistence and no cross-device sync.** **No `/api/notifications` route is required**, and an API is not created merely to mirror state the application already holds.

**Read and dismiss are different acts.** A notification is **unread** until its stable derived id is present in `etlms.notifRead`. **Opening the panel does not mark anything read.** *Mark all read* records every currently active notification as read, clears the unread badge, **dismisses nothing**, and survives a reload on the same device; a qualifying notification that later appears with a new stable id is unread. **Dismiss** removes one notification from the visible device-local list, writes only to `etlms.notifDismissed`, leaves the source entity untouched, and survives a reload on the same device. If the same source later produces a genuinely new notification identity, that new item is **not** automatically dismissed.

**Every notification has a deterministic stable derived id.** The id is composed of the notification **type**, the **source entity identity**, and the relevant **period or context** where one is needed to tell two logical notifications apart. It must **not** depend on an array index, render order, a UUID generated at render time, translated text or any presentation string. The same currently qualifying source produces the same id across reloads — which is the only reason a dismissed item stays dismissed — while different logical periods are able to produce different ids when that is the correct outcome.

**Ordering is deterministic and never inherited from the database.** Types rank **1. Unpaid tuition, 2. Upcoming makeup, 3. Review due.** Within Unpaid tuition, the more overdue or older unresolved obligation comes first; within Upcoming makeup, the nearest upcoming lesson comes first; within Review due, the oldest outstanding review period comes first. Where the ranking values are equivalent, a stable deterministic secondary ordering applies, and **stable source identity is the final tie-breaker**. Natural collection order is never relied upon.

**The dropdown displays at most 20 active items.** The cap is **presentation only and is not persisted state**: items beyond the twentieth are not mutated, not dismissed and not marked read. The unread badge counts unread notifications across the **currently active derived set**, not merely the twenty rendered.

**One logical source and context produces at most one active notification.** Duplicates arising from repeated renders, repeated fetches or more than one derivation pass are prohibited, and deduplication is performed on the stable derived id.

**Opening a notification navigates into an existing screen and creates nothing.** Unpaid tuition opens the existing Finance / Billing surface and, where the current route architecture supports it, identifies the relevant billing or student context — **without adding any new Finance affordance**. Upcoming makeup opens the existing Calendar or Lesson context for that lesson, **without touching recurrence semantics**. Review due opens the existing Reviews context for that student and period, and **never creates the missing Review automatically**. Where the existing routes cannot deep-link to an individual source safely, the action opens the **narrowest existing relevant screen**; no route is invented to carry a link.

**A notification is a live derived view, never a historical record.** When a source entity is deleted, retired, cancelled, completed, changes status or otherwise stops satisfying its rule, its notification **disappears on the next derivation**. A device-local read or dismiss entry for it may remain stored harmlessly, and **a stale acknowledgement entry must never resurrect a notification or bring one into existence by itself**.

**Sprint 12 does not add the Notifications Settings card, and the Sprint 11 Settings contract is unchanged.** Settings keeps **three sections, nine enumerated settings, no fourth section, no tenth setting, no Save or Apply and no new preference persistence.** The design reference's Notifications card stays deferred and non-shipping, and the existing assertions that it is absent remain valid exactly as written. Notification acknowledgement is not a *setting*: it is per-item state that the bell owns, so it introduces no preference and reaches no preference surface.

**One banked test expectation is deliberately inverted here.** `tests/settings.test.ts` asserted that the reserved keys `etlms.notifRead` and `etlms.notifDismissed` were **read by nothing**. That assertion was correct for every sprint up to and including Sprint 11 and is **authorised to change in Sprint 12**, because Sprint 12 is the sprint that gives those keys a reader. The assertion is **inverted rather than deleted**, and what it protects is unchanged: **both keys still exist, neither is renamed, no additional notification storage key is introduced, and their use is confined to Notifications acknowledgement state.** It must not be left vacuous by moving the implementation outside the files the old assertion happened to scan. **These guards are not inverted and stay exactly as they are:** no Notifications card in Settings, three Settings sections, the Finance reminder/send/notification ban, and the Reports notification ban.

**The design reference supplies the layout, and these are its anchors.** The existing header bell, an unread badge on the existing accent tokens, a dropdown panel of `width: 370px` and `max-width: calc(100vw - 40px)`, right-anchored, `border-radius: 14px`, with a header row carrying the title and *Mark all read*, a vertically scrolling list at `max-height: 400px`, a per-item icon, title and body, a per-item dismiss action, and an empty state. **No redesign.** Responsive behaviour belongs to a rule the stylesheet owns — **a responsive rule must not be one that loses to an inline declaration**, which this repository has shipped more than once.

**The panel is operable from the keyboard.** The bell is reachable by keyboard, `Enter` and `Space` toggle the panel, `Escape` closes it and returns focus to the bell, and both a notification's open action and its dismiss action are keyboard-reachable. Focus is visible through the existing `:focus-visible` treatment, and a pointer interaction leaves no stuck ring. A non-modal popover **does not get a permanent modal focus trap**; keyboard navigation stays predictable and never makes the rest of the application unreachable.

**Notifications change presentation and never meaning.** Light theme, Dark theme, accent switching, the app-wide language readiness introduced in Sprint 11, the `vi` default, the `en` source-string fallback and the existing density system are all preserved. No hard-coded neutral hover colour is used where a design token exists. If the panel consumes the shared control-gap tokens it uses them **as `gap` only**, consistent with the Sprint 11 contract. `ThemeScript` and the `AppShell` readiness architecture are not changed unless a real defect is proven against them.

**Explicitly out of scope for Sprint 12:** a Notifications page, a Notifications sidebar item, the Notifications Settings card, parent-facing or student-facing notifications, email, SMS, browser push or any push-service integration, reminder sending, a Notification collection, an API whose only purpose is duplicating state the application already owns, cross-device read-state sync, notification history, Global Search, Excel export, the Homework submission writer, AI review generation, a configurable timezone, report branding, organisation settings, any authentication or session redesign, and unrelated refactors.

## Student Profile — Attendance & Homework

**These two tabs make data the product already owns reachable from the student it is about, and they introduce nothing else.** Attendance and Homework are closed modules that own their records; the Student Profile is where a teacher asks what those records say about one person. Sprint 13 answers that question on the two tabs the imported design already draws and the application already renders as "arrives in a later sprint". It creates no module, no route, no navigation entry and no data.

**Both tabs own no data whatsoever.** There is **no new Mongoose model, no new collection, no schema field, no index, no migration, no backfill, no production DDL and no new dependency.** Every figure is derived at read time from `Lesson`, `AttendanceRecord`, `Homework` and `Class` — entities that already own it — and no value is copied onto the Student, stored, cached or written back. The tabs reference the related entity rather than duplicating its value, which is what *Data Ownership* requires.

**Nothing is written, repaired, reconciled or reported.** Opening a student's profile must never mutate a lesson, advance a lifecycle, create a register, record an outcome or normalise a stored value. Both tabs are **read-only in the strictest sense**: no mutation, no form, no drawer, no dirty state, no action that changes a record, and no disabled control hinting at one.

**The scope is this student's classes, and it is the scope the Reviews tab already uses.** Lessons are narrowed to the classes whose roster names the student; homework is narrowed to work set to one of those classes or addressed to the student by name. This is the narrowing `studentMonthMetrics` performs today, and Sprint 13 must not widen it: passing the whole studio's lessons would make coverage describe the school rather than the student. **The Reviews tab's monthly learning journey already shows an attendance percentage and a homework completion percentage for reviewed months. Those figures and these must agree**, which they do only by sharing the same helpers at the same scope. A figure that disagreed with the one a teacher can see two tabs away would be the same fact stated twice and differently.

**Roster membership is read as it stands today, and that is a stated limitation.** A student moved out of a class after a month was taught will see that month's coverage shrink, though their percentage is unmoved. Attendance stores no membership history and no other answer is available from this data. Nothing infers, reconstructs or back-fills a historical roster.

**The counting rules are Attendance's and Homework's, and they are not restated here.** `studentAttendanceRate` and `studentHomeworkCompletion` already state them once, in `src/lib/finance.ts`, and are already consumed by Reports and Reviews. Sprint 13 **reuses** them and, where a lifetime figure is needed that a month-scoped helper cannot give, **extends that same file** rather than writing a second copy of the rule anywhere else.

### The Attendance tab

**The headline percentage counts what Attendance already counts.** `Present`, `Late` and `Excused` are attended; `Absent` is not. The denominator is the stored entries for this student on **completed** lessons — never the lesson count, and never an entry invented for a register that does not name them. A student with no entries has **no percentage**, and the tab shows its empty state rather than `0%`.

**Four counts, in the design's order: Present, Late, Absent, Excused.** They are raw lifetime counts of stored entries and they are not percentages. They use `ATTENDANCE_DISPLAY_ORDER` and `ATTENDANCE_COLORS`, which already exist.

**Monthly attendance is six months ending at the application's current month.** Each bar is that month's percentage under the rule above. A month in which the student's classes completed no lesson has no percentage: it draws the design's minimum-height stub and labels its rate with the application's em-dash placeholder for "no value". **It never renders as `0%`**, which would assert a month of total absence that the data does not record. Sprint 13 introduces **no configurable timezone and no new application clock**; `TODAY` keeps the meaning it already has.

**The attendance timeline is newest first**, showing the lesson's class, the student's status for it and the lesson's own date. **The Lesson owns the date.** `AttendanceRecord.date` is a legacy mirror that some stored documents already carry in disagreement with their lesson, and it is **never read** — a rescheduled lesson appears on the date it was actually taught.

**Recent absences lists `Absent` and nothing else.** `Excused` is counted as attended everywhere else in this application, and a screen that filed it under absences would contradict a rule already in production. Each row carries the class, the status badge the design draws, the date and the entry's note where one was recorded. **Recent late arrivals lists `Late` only.**

### The Homework tab

**The completion ring is the existing completion measure and no other.** `Completed` and `Late` are done; `Missing` is not; **`Assigned` is excluded from the measure entirely** rather than counted as a failure — the rule *Homework* already states. A student with no work carrying an outcome has no percentage and the ring shows none.

**Four counts: Total, Completed, Late, Missing.** **`Total` is every assignment addressed to this student, `Assigned` included**, because that is what the work they were given amounts to. The ring's denominator excludes `Assigned`, so `Total` is legitimately **larger** than `Completed + Late + Missing`. **That is correct and is not a defect**: the two answer different questions, exactly as Finance's billed total legitimately exceeds the rows a teacher can act on.

**A class-scoped assignment shows the student's own outcome**, read from `submissions[studentId]` — never the assignment's top-level status, which describes the assignment rather than the person. A student-scoped assignment shows its own status and only where `studentId` names this student.

**An assignment with no entry for this student is not theirs and does not appear.** Membership is the snapshot taken when the work was set; a student added to a class afterwards is not in that map, and no key is invented, repaired or written back for them.

**The homework timeline is newest first by due date**, showing the title, the class, the scope label and the student's own status badge. **Missing homework** and **Late homework** list the same work filtered to those two outcomes, each with the title, class and due date.

### Rules both tabs share

**Ordering is deterministic and never inherited from the database.** Timelines and lists run newest first — by the lesson's date for Attendance, by the due date for Homework — and where two dates are equal a stable secondary ordering applies, with the source entity's own id as the final tie-breaker. Natural collection order is never relied upon.

**Lists are capped, and the cap is presentation only.** A timeline shows at most **20** items and each side card at most **5**. Items beyond the cap are not mutated, not hidden from any count and not removed from any aggregate — every percentage and every tile still describes the whole record.

**Records belonging to students who no longer exist are untouched.** Attendance preserves stored entries for deleted students and Homework preserves their submission keys; both are the only surviving evidence that those people were taught. These tabs read one living student and therefore never surface, count, repair or erase such an entry.

**Each tab has exactly one empty state, and it is the comp's own.** Attendance: *"No attendance recorded for this student yet."* Homework: *"No homework assigned to this student yet."*, with the design's assign action. An empty **side card** is its own separate state — *"No absences on record. 🎉"*, *"No late arrivals on record."*, *"Nothing missing. 🎉"*, *"No late submissions."* — and a student with records but no absences sees the tab, not the empty tab. **A partial answer is never dressed as an empty one.**

**Every string is already in the dictionary.** The twelve Vietnamese keys these two designs need were ported and have had no reader until now. Sprint 13 gives them one. `vi` remains the default and `en` continues to use the existing source-string fallback; **no second dictionary and no new key is introduced** for a string the dictionary already holds.

**The layout is the comp's and is not reinterpreted.** Both tabs are the design's `minmax(0,1.6fr) minmax(0,1fr)` split with the app's `--gap`, its card shell, its soft-tone tiles, its 150px bar chart and its `r=40` completion ring — which is the geometry `RING_CIRCUMFERENCE` and `ringDash` already serve. No spacing, type scale, radius, shadow, transition, colour or icon is changed.

**The responsive rule belongs to the stylesheet and must not be one an inline declaration can beat.** The two-column split is declared as a **class the stylesheet owns** — never as an inline `grid-template-columns` with a media rule trying to override it, which this repository has shipped as a dead rule more than once. It collapses on the **room the tab actually has**, through a container query anchored on the existing `[data-screen-label="Student profile"]`, for the reason Reports and Settings already use one: the content column moves with the sidebar rail and the density token, so the viewport is a poor proxy for it. **No new viewport breakpoint is introduced** — `tests/finance-ui.test.ts` allows only 620, 767, 860, 1099 and 1100, and that guard is not loosened. The bar chart and both timelines must fit without the page scrolling horizontally, and neither tab adds a horizontal scroll region.

**The tabs are operable and announced.** Each tab's content is reachable in the existing tab order, its headings describe its regions, and no figure is carried by colour alone — the four status tiles, every timeline row and both side cards name their status in text beside its colour, as the comp draws them. The bar chart and the completion ring are decorative renderings of figures stated in text next to them. Focus is visible through the existing `:focus-visible` treatment and a pointer interaction leaves no stuck ring. **The existing tablist semantics are unchanged**; the absence of `role="tabpanel"` on this page pre-dates Sprint 13, spans the closed Overview and Reviews tabs, and is **not** repaired here.

**The Classes and Finance tabs keep the placeholder, and the fallback branch stays.** Both read data for which the imported design supplies no tab body — the comp draws them as its `tabOther` panel — so under *Missing UI Specification* they continue to render *"arrives in a later sprint"* exactly as they do today. `TABS` is unchanged at six entries in its existing order.

**The Reviews tab is not touched.** Sprint 8 deliberately omitted the comp's attendance and homework blocks from the performance tab; Sprint 13 does **not** restore them there, does not move analytics between tabs and changes no Reviews figure, query, endpoint or component. The Overview tab, the profile header, the tablist and the `?tab=` deep-link behaviour are likewise unchanged.

**One banked test expectation is deliberately inverted here, and it is the only one.** `tests/reviews-ui.test.ts` #83 asserts that the profile page *"gained a branch, and lost none"* — that Overview branches first, Reviews is the one new branch, and *every other tab still renders the comp's later-sprint panel*. That last premise was correct for every sprint up to and including Sprint 12 and is **authorised to change in Sprint 13**, because Sprint 13 is the sprint that gives two of those tabs a body. The assertion is **inverted rather than deleted**, and what it has always protected is unchanged: **a sprint does not edit a screen that is not its own.** Its other clauses stay exactly as written — the `TABS` array is still pinned to its six entries in order, `t("arrives in a later sprint")` is still required as the fallback, and the Overview cards are still required to be present. It must not be left vacuous by moving the new branches outside the file the assertion scans. **The positive assertion — that an Attendance branch and a Homework branch exist — belongs to the implementation gate and is not written at banking time**, exactly as Sprint 12 left the existence of a notification reader to its own gate.

**Explicitly out of scope for Sprint 13:** the Classes tab, the Finance tab, the payment UI, the homework submission writer or any recording of an outcome, class-detail enrolment and the assign-students picker, the Extra lesson control, Global Search, Quick Add, Excel or CSV export, AI review generation, a student-facing or parent-facing surface, printing or PDF from either tab, **any payment-slip or billing document — including the deferred Finance class payment slip, its playful print style, its amount-due figure, its tuition-month content and its fixed bank QR code**, cross-device state, a configurable timezone, a Notifications change, a Settings change, any authentication or session change, and unrelated refactors.

# Current Milestone

Stable production foundation completed.

Working:

- Login
- Dashboard
- MongoDB
- JWT
- Vercel Deployment

These must NEVER be broken.

---

Current Priority

1. Students

After Students:

2. Parents

3. Classes

4. Attendance

5. Homework

6. Reviews

7. Finance

8. Reports

9. Settings

Never skip priorities.

Never implement future modules early.

---

Definition of Done

A module is complete only when:

- UI matches Claude Design
- CRUD works
- Validation works
- Mobile works
- Production build succeeds

# Deployment Rules

Target platform:

- Vercel
- MongoDB Atlas

Do not introduce any other backend platform.

Do not introduce Render, Railway or Firebase.

Do not require Docker.

Do not require local services other than MongoDB Atlas.

# Coding Rules

Prefer extending existing code.

Avoid creating duplicate utilities.

Avoid duplicate components.

Prefer composition over replacement.

Keep code simple.

Avoid unnecessary abstractions.

Avoid large refactors.

# Testing Checklist

Every completed module must be manually verified:

- Desktop
- Mobile
- Dark Mode
- Refresh page
- Authentication
- CRUD
- Validation

Do not mark complete until all checks pass.

# Build Requirements

Before finishing any task, always ensure:

- npm run lint passes
- npm run build passes
- No TypeScript errors
- Existing pages still work
- Existing API routes still work
- Login still works
- Dashboard still works

Never finish with a failing build.