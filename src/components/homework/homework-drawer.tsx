"use client";

/* The Assign / Edit homework drawer.
 *
 * BUILT UNDER THE SPRINT 7 S1 WAIVER. The imported design file is truncated
 * before this form's body, so the fields here are composed from the sources the
 * waiver names and from nothing else: the existing `Drawer` chrome, the approved
 * create/update field list, and copy that already exists in the design's own
 * dictionary. Every label, placeholder, error and button string below is an
 * existing entry — "Title", "Description", "Class", "Select a class", "Assign
 * to", "Entire class", "Individual student", "Student", "Select a student", "Due
 * date", "Pick a due date", "Teacher notes", "Optional notes…", "Create new
 * homework", "Edit homework", "Assign work to a class or a single student",
 * "Assign homework", "Save changes". Nothing is written for this screen.
 *
 * NO FIELD BEYOND THE SEVEN. There is no status control, no lesson control and
 * no submissions control — not because they are hidden, but because homework has
 * no lesson, its status is the server's to set, and Sprint 7 records no outcomes.
 *
 * ON AN EDIT, THE OWNERSHIP CONTROLS ARE NOT RENDERED. Class, scope and assignee
 * are fixed when an assignment is created, and this app's convention for a field
 * a form may not change is to leave the control out — the class drawer carries
 * `status` through without drawing one. Disabling them instead would have meant
 * adding a disabled state to a shared control for this screen's benefit, which is
 * a larger change than the rule needs. The drawer's subtitle names the
 * assignment, and the card the teacher clicked shows its class.
 *
 * What actually guarantees those fields are never written is `toUpdateBody`,
 * which names four fields and no others, and the server, which refuses any key
 * outside them.
 */

import { useEffect } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useT } from "@/lib/settings-context";
import { DateField } from "@/components/ui/date-field";
import { Drawer } from "@/components/ui/drawer";
import { Select } from "@/components/ui/select";
import {
  emptyValues, studentOptions, toCreateBody, toUpdateBody, valuesFrom, withClass, withScope,
  type HomeworkFormValues,
} from "@/components/homework/form";
import { SCOPE_FIELD_LABEL, SCOPE_LABEL } from "@/components/homework/homework-ui";
import { homeworkCreateSchema } from "@/lib/schemas";
import type { HomeworkAssignableClass, HomeworkListItem } from "@/lib/homework";
import type { HomeworkCreateBody, HomeworkUpdateBody } from "@/lib/schemas";

const field = (invalid: boolean): React.CSSProperties => ({
  // min/max-width are the drawer contract, not decoration: a control that
  // reports an intrinsic width wider than the panel makes the panel scroll
  // sideways. See globals.css, "Native date field".
  width: "100%", minWidth: 0, maxWidth: "100%", height: 38, padding: "0 11px",
  border: `1px solid ${invalid ? "var(--accent)" : "var(--border)"}`,
  borderRadius: 9, background: "var(--card)", color: "var(--fg)",
  fontSize: 13, fontFamily: "inherit", outline: "none",
});

/* Derived from `field`, exactly as student-, parent- and class-drawer derive
 * theirs, so a change to the family reaches the textarea too. Only what a
 * multi-line control must change is changed. */
const areaStyle: React.CSSProperties = {
  ...field(false), height: "auto", minHeight: 76, padding: "10px 12px",
  lineHeight: 1.5, resize: "vertical",
};

const labelStyle: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 500, marginBottom: 6 };
const errStyle: React.CSSProperties = { fontSize: 11.5, color: "var(--accent)", marginTop: 5 };

function Required() {
  return <span style={{ color: "var(--accent)" }}> *</span>;
}

export function HomeworkDrawer({
  open, homework, initialValues, assignableClasses, saving, onClose, onCreate, onUpdate,
}: {
  open: boolean;
  /** The assignment being edited, or null when assigning or duplicating. */
  homework: HomeworkListItem | null;
  /** Starting values — a blank form, or a duplicate's sanitised prefill. */
  initialValues?: HomeworkFormValues;
  assignableClasses: HomeworkAssignableClass[];
  saving: boolean;
  onClose: () => void;
  onCreate: (body: HomeworkCreateBody) => void;
  onUpdate: (id: string, body: HomeworkUpdateBody) => void;
}) {
  const t = useT();
  const editing = !!homework;

  /* The server's own create schema validates the form, so the drawer cannot
   * disagree with the API about what is required or about which sentence says so.
   * It suits an edit too: the ownership values are carried from the record, so
   * they satisfy it without being editable — and `toUpdateBody` is what keeps
   * them off the wire. */
  const { register, control, handleSubmit, reset, setValue, getValues, formState: { errors } } =
    useForm<HomeworkFormValues>({
      resolver: zodResolver(homeworkCreateSchema) as never,
      defaultValues: initialValues ?? emptyValues(),
    });

  // Re-seed whenever the drawer opens for a different record, exactly as the
  // Class, Parent and Student drawers do.
  useEffect(() => {
    if (open) reset(initialValues ?? (homework ? valuesFrom(homework) : emptyValues()));
  }, [open, homework, initialValues, reset]);

  const scope = useWatch({ control, name: "scope" });
  const classId = useWatch({ control, name: "classId" });
  /* The date field cannot tell whether it is empty — a reset() changes the value
   * with no event to observe — so the form says so. See ui/date-field.tsx. */
  const dueDate = useWatch({ control, name: "dueDate" });

  const classOptions = assignableClasses.map((c) => ({ value: c.id, label: c.name }));
  const students = studentOptions(classId ?? "", assignableClasses);

  const submit = handleSubmit((values) => {
    if (editing) onUpdate(homework.id, toUpdateBody(values));
    else onCreate(toCreateBody(values));
  });

  /** Re-point the form at a class, dropping a student who is not in it. */
  function pickClass(next: string) {
    const v = withClass(getValues(), next, assignableClasses);
    setValue("classId", v.classId, { shouldValidate: true });
    setValue("studentId", v.studentId);
  }

  function pickScope(next: string) {
    const v = withScope(getValues(), next === "student" ? "student" : "class");
    setValue("scope", v.scope, { shouldValidate: true });
    setValue("studentId", v.studentId);
  }

  return (
    <Drawer
      open={open}
      title={t(editing ? "Edit homework" : "Create new homework")}
      subtitle={editing ? homework.title : t("Assign work to a class or a single student")}
      saveLabel={t(editing ? "Save changes" : "Assign homework")}
      saving={saving}
      onClose={onClose}
      onSave={submit}
    >
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: 16 }}>
        {/* Title */}
        <div>
          <label style={labelStyle} htmlFor="hw-title">{t("Title")}<Required /></label>
          <input id="hw-title" className="ring" style={field(!!errors.title)} {...register("title")} />
          {errors.title && <div role="alert" style={errStyle}>{t(errors.title.message ?? "")}</div>}
        </div>

        {/* Description */}
        <div>
          <label style={labelStyle} htmlFor="hw-description">{t("Description")}</label>
          <textarea id="hw-description" className="ring" style={areaStyle} {...register("description")} />
        </div>

        {/* Class, scope and assignee are set once, at creation. */}
        {!editing && (
          <>
            <div>
              <label style={labelStyle}>{t("Class")}<Required /></label>
              <Controller
                control={control}
                name="classId"
                render={({ field: f }) => (
                  <Select
                    value={String(f.value ?? "")}
                    options={classOptions}
                    onChange={pickClass}
                    placeholder={t("Select a class")}
                    ariaLabel={t("Class")}
                    invalid={!!errors.classId}
                  />
                )}
              />
              {errors.classId && <div role="alert" style={errStyle}>{t(errors.classId.message ?? "")}</div>}
            </div>

            <div>
              <label style={labelStyle}>{t(SCOPE_FIELD_LABEL)}</label>
              <Controller
                control={control}
                name="scope"
                render={({ field: f }) => (
                  <Select
                    value={String(f.value ?? "class")}
                    options={[
                      { value: "class", label: t(SCOPE_LABEL.class) },
                      { value: "student", label: t(SCOPE_LABEL.student) },
                    ]}
                    onChange={pickScope}
                    ariaLabel={t(SCOPE_FIELD_LABEL)}
                  />
                )}
              />
            </div>

            {scope === "student" && (
              <div>
                <label style={labelStyle}>{t("Student")}<Required /></label>
                <Controller
                  control={control}
                  name="studentId"
                  render={({ field: f }) => (
                    <Select
                      value={String(f.value ?? "")}
                      options={students}
                      onChange={f.onChange}
                      placeholder={t("Select a student")}
                      ariaLabel={t("Student")}
                      invalid={!!errors.studentId}
                    />
                  )}
                />
                {errors.studentId && <div role="alert" style={errStyle}>{t(errors.studentId.message ?? "")}</div>}
              </div>
            )}
          </>
        )}

        {/* Due date */}
        <div>
          <label style={labelStyle} htmlFor="hw-due">{t("Due date")}<Required /></label>
          {/* "Pick a due date" is the design's own string for this field — it
            * has been in the dictionary since S1 and had nowhere to be shown,
            * because a native date input has no placeholder to put it in. */}
          <DateField
            id="hw-due"
            placeholder={t("Pick a due date")}
            empty={!dueDate}
            style={field(!!errors.dueDate)}
            {...register("dueDate")}
          />
          {errors.dueDate && <div role="alert" style={errStyle}>{t(errors.dueDate.message ?? "")}</div>}
        </div>

        {/* Teacher notes */}
        <div>
          <label style={labelStyle} htmlFor="hw-notes">{t("Teacher notes")}</label>
          <textarea
            id="hw-notes"
            className="ring"
            placeholder={t("Optional notes…")}
            style={areaStyle}
            {...register("teacherNotes")}
          />
        </div>
      </form>
    </Drawer>
  );
}
