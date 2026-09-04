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

## Calendar
Events display a lesson-type badge: **Regular / Makeup / Extra**, plus attendance status indicator for past lessons. Clicking a lesson opens the drawer (never navigates away). Drag-and-drop reschedules.

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