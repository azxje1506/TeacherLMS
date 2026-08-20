/* The Homework drawer's form values, as pure functions.
 *
 * WHY THIS IS NOT INLINE IN THE COMPONENT. The rules here are real ones and they
 * are exactly the rules that could quietly break the approved contract: an edit
 * must send four fields and never a fifth, a duplicate must carry a teacher's
 * words and never a stored outcome, and changing the class must drop a student
 * who is not in the new one. Rules that matter are rules worth testing, and a
 * handler buried in a component is reachable only by rendering it. Here they are
 * ordinary functions over ordinary values — the same reason
 * src/components/attendance/draft.ts exists.
 *
 * Every function returns a NEW object rather than mutating one.
 */

import type { HomeworkAssignableClass, HomeworkListItem } from "@/lib/homework";
import type { HomeworkCreateBody, HomeworkUpdateBody } from "@/lib/schemas";

/** What the drawer's fields hold. `studentId` is "" rather than null while
 * editing, because that is what an empty select carries; it becomes null at the
 * boundary. */
export interface HomeworkFormValues {
  title: string;
  description: string;
  classId: string;
  scope: "class" | "student";
  studentId: string;
  dueDate: string;
  teacherNotes: string;
}

/** A blank Assign form. Class scope is the default the create contract states. */
export function emptyValues(): HomeworkFormValues {
  return {
    title: "", description: "", classId: "", scope: "class",
    studentId: "", dueDate: "", teacherNotes: "",
  };
}

/** The form for an existing assignment. The ownership fields are carried so the
 * drawer can SHOW them; `toUpdateBody` is what decides they are never sent. */
export function valuesFrom(item: HomeworkListItem): HomeworkFormValues {
  return {
    title: item.title,
    description: item.description,
    classId: item.classId,
    scope: item.scope,
    studentId: item.studentId ?? "",
    dueDate: item.dueDate,
    teacherNotes: item.teacherNotes,
  };
}

/** The form Duplicate opens: the teacher's own words, and a date they must state.
 *
 * THE DUE DATE IS BLANK. Copying it reliably produces an assignment that is
 * already overdue, and the field is required, so the teacher restates it.
 *
 * SANITISED AGAINST WHAT IS STILL ASSIGNABLE, because a duplicate is a CREATE and
 * creates only go to Active classes. If the original's class has since been ended
 * or archived the class is left unset, and if its student is no longer on that
 * class's resolvable roster the student is cleared. Both are corrections to a
 * form, not to data: nothing about the original assignment changes, and no
 * warning is invented to announce it — the emptied required field is the prompt.
 *
 * No stored outcome can be carried: `HomeworkListItem` has no submissions, and
 * neither `status`, `id` nor `createdAt` is part of `HomeworkFormValues`. */
export function valuesFromDuplicate(
  item: HomeworkListItem,
  assignable: readonly HomeworkAssignableClass[]
): HomeworkFormValues {
  const base: HomeworkFormValues = {
    title: item.title,
    description: item.description,
    classId: item.classId,
    scope: item.scope,
    studentId: item.studentId ?? "",
    dueDate: "",
    teacherNotes: item.teacherNotes,
  };
  return withClass(base, base.classId, assignable);
}

/** The students that may be chosen for a class, in roster order. Empty for a
 * class that is not assignable, and empty for one whose roster resolves to
 * nobody — which is a real state, not an error. */
export function studentOptions(
  classId: string,
  assignable: readonly HomeworkAssignableClass[]
): Array<{ value: string; label: string }> {
  const klass = assignable.find((c) => c.id === classId);
  return (klass?.students ?? []).map((s) => ({ value: s.id, label: s.name }));
}

/** Point the form at a class, dropping a student who does not belong to it.
 *
 * A stale selection would otherwise be submitted and refused by the server with
 * `student_not_in_class`, which is a correct refusal of a mistake the form could
 * have prevented. An unassignable class id is not kept either: the picker cannot
 * offer it, so holding it would leave the form in a state its own control cannot
 * represent. */
export function withClass(
  values: HomeworkFormValues,
  classId: string,
  assignable: readonly HomeworkAssignableClass[]
): HomeworkFormValues {
  const offered = assignable.some((c) => c.id === classId) ? classId : "";
  const stillValid = studentOptions(offered, assignable).some((o) => o.value === values.studentId);
  return { ...values, classId: offered, studentId: stillValid ? values.studentId : "" };
}

/** Switch scope, dropping the assignee when it stops being meaningful. */
export function withScope(
  values: HomeworkFormValues,
  scope: HomeworkFormValues["scope"]
): HomeworkFormValues {
  return { ...values, scope, studentId: scope === "student" ? values.studentId : "" };
}

/** The POST body — exactly the seven fields a create may carry.
 *
 * Built by naming them, never by spreading the form, so a field added to the
 * form later cannot reach the wire by accident. An empty student select becomes
 * `null`, and a class-scoped assignment carries no student at all. */
export function toCreateBody(values: HomeworkFormValues): HomeworkCreateBody {
  return {
    title: values.title,
    description: values.description,
    classId: values.classId,
    scope: values.scope,
    studentId: values.scope === "student" ? (values.studentId || null) : null,
    dueDate: values.dueDate,
    teacherNotes: values.teacherNotes,
  };
}

/** The PATCH body — exactly the four fields a teacher authored.
 *
 * THE OWNERSHIP FIELDS ARE NOT HERE, and cannot be added by editing a component:
 * the object is written out field by field, and the server refuses any other key
 * outright. The drawer may well be holding `classId`, `scope` and `studentId` in
 * order to display them; this is the function that guarantees holding them and
 * sending them are different things. */
export function toUpdateBody(values: HomeworkFormValues): HomeworkUpdateBody {
  return {
    title: values.title,
    description: values.description,
    dueDate: values.dueDate,
    teacherNotes: values.teacherNotes,
  };
}

/** The index's class filter. An empty id means unfiltered. */
export function filterByClass(
  items: readonly HomeworkListItem[],
  classId: string
): HomeworkListItem[] {
  return classId ? items.filter((i) => i.classId === classId) : [...items];
}
