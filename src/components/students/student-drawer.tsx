"use client";

/* Student create/edit form — ported verbatim from the design comp's drawer
 * "STUDENT FORM" block: avatar uploader, First/Last pair, Birthday (with the
 * formatted hint below it), School, Grade/Status pair, Parent/Guardian, Phone
 * and Notes. Validation is React Hook Form + the shared Zod schema, so the
 * client and the Route Handler enforce exactly the same rules. */

import { useEffect } from "react";
import { useForm, useWatch, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { studentSchema, type StudentFormInput, type StudentInput } from "@/lib/schemas";
import { useSettings } from "@/lib/settings-context";
import { Drawer } from "@/components/ui/drawer";
import { Select } from "@/components/ui/select";
import { GRADE_OPTIONS, STATUS_OPTIONS } from "./student-ui";
import type { ParentOption } from "./api";
import type { Student } from "@/lib/types";

const field = (invalid: boolean): React.CSSProperties => ({
  width: "100%", height: 38, padding: "0 11px",
  border: `1px solid ${invalid ? "var(--accent)" : "var(--border)"}`, borderRadius: 9,
  background: "var(--card)", color: "var(--fg)", fontSize: 13, fontFamily: "inherit", outline: "none",
});

const labelStyle: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 500, marginBottom: 6 };
const errStyle: React.CSSProperties = { fontSize: 11.5, color: "var(--accent)", marginTop: 5 };
const hintStyle: React.CSSProperties = { fontSize: 11.5, color: "var(--muted-2)", marginTop: 5 };

function emptyValues(): StudentFormInput {
  return { first: "", last: "", birthday: "", school: "", grade: 0, parentId: "", phone: "", status: "Active", notes: "", avatar: null };
}

function valuesFrom(s: Student): StudentFormInput {
  return {
    first: s.first, last: s.last, birthday: s.birthday, school: s.school, grade: s.grade,
    parentId: s.parentId, phone: s.phone, status: s.status, notes: s.notes ?? "", avatar: s.avatar ?? null,
  };
}

export function StudentDrawer({
  open, student, parents, saving, onClose, onSave,
}: {
  open: boolean;
  /** null = create, a Student = edit. */
  student: Student | null;
  parents: ParentOption[];
  saving: boolean;
  onClose: () => void;
  onSave: (values: StudentInput) => void;
}) {
  const { t, fmt } = useSettings();

  // Three generics: what the fields hold, context, and what validation emits —
  // `grade` is coerced, so the in-form and submitted shapes genuinely differ.
  const { register, handleSubmit, control, reset, setValue, formState: { errors } } =
    useForm<StudentFormInput, unknown, StudentInput>({
      resolver: zodResolver(studentSchema),
      defaultValues: student ? valuesFrom(student) : emptyValues(),
    });

  // Re-seed whenever the drawer opens for a different record.
  useEffect(() => {
    if (open) reset(student ? valuesFrom(student) : emptyValues());
  }, [open, student, reset]);

  // useWatch (not watch()) so the subscription is memo-safe for React Compiler.
  const birthday = useWatch({ control, name: "birthday" });
  const avatar = useWatch({ control, name: "avatar" });
  const first = useWatch({ control, name: "first" });
  const last = useWatch({ control, name: "last" });
  const initials = ((first?.[0] ?? "") + (last?.[0] ?? "")).toUpperCase();

  function onAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setValue("avatar", String(reader.result), { shouldDirty: true });
    reader.readAsDataURL(file);
  }

  const parentOptions = parents.map((p) => ({ value: p.id, label: `${p.name} · ${p.relationship}` }));

  return (
    <Drawer
      open={open}
      title={t(student ? "Edit student" : "Add student")}
      subtitle={student ? student.name : t("Create a new student record.")}
      saveLabel={t(student ? "Save changes" : "Create student")}
      saving={saving}
      onClose={onClose}
      onSave={handleSubmit(onSave)}
    >
      <form onSubmit={handleSubmit(onSave)} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Avatar */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ minWidth: 64, width: 64, height: 64, borderRadius: "50%", background: "var(--card-2)", border: "1px solid var(--border)", color: "var(--muted)", fontSize: 22, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", position: "relative" }}>
            {avatar ? (
              // eslint-disable-next-line @next/next/no-img-element -- data-URL preview
              <img src={avatar} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            ) : (
              initials
            )}
          </div>
          <div>
            <label className="btn-ghost" style={{ display: "inline-flex", alignItems: "center", gap: 7, height: 34, padding: "0 13px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M17 8l-5-5-5 5" /><path d="M12 3v12" /></svg>
              {t("Upload avatar")}
              <input type="file" accept="image/*" onChange={onAvatar} style={{ display: "none" }} />
            </label>
            <div style={{ fontSize: 11.5, color: "var(--muted-2)", marginTop: 6 }}>{t("PNG or JPG. Optional.")}</div>
          </div>
        </div>

        {/* First / Last */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>{t("First name")} <span style={{ color: "var(--accent)" }}>*</span></label>
            <input className="ring" style={field(!!errors.first)} {...register("first")} />
            {errors.first && <div role="alert" style={errStyle}>{t(errors.first.message ?? "")}</div>}
          </div>
          <div>
            <label style={labelStyle}>{t("Last name")} <span style={{ color: "var(--accent)" }}>*</span></label>
            <input className="ring" style={field(!!errors.last)} {...register("last")} />
            {errors.last && <div role="alert" style={errStyle}>{t(errors.last.message ?? "")}</div>}
          </div>
        </div>

        {/* Birthday */}
        <div>
          <label style={labelStyle}>{t("Birthday")} <span style={{ color: "var(--accent)" }}>*</span></label>
          <input className="ring" type="date" style={field(!!errors.birthday)} {...register("birthday")} />
          {birthday && !errors.birthday && <div style={hintStyle}>{fmt.dateLabel(birthday)}</div>}
          {errors.birthday && <div role="alert" style={errStyle}>{t(errors.birthday.message ?? "")}</div>}
        </div>

        {/* School */}
        <div>
          <label style={labelStyle}>{t("School")} <span style={{ color: "var(--accent)" }}>*</span></label>
          <input className="ring" placeholder={t("e.g. Riverside Elementary")} style={field(!!errors.school)} {...register("school")} />
          {errors.school && <div role="alert" style={errStyle}>{t(errors.school.message ?? "")}</div>}
        </div>

        {/* Grade / Status */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>{t("Grade")} <span style={{ color: "var(--accent)" }}>*</span></label>
            <Controller
              control={control}
              name="grade"
              render={({ fieldState, field: f }) => (
                <Select
                  ariaLabel={t("Grade")}
                  value={String(f.value ?? "")}
                  options={GRADE_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))}
                  onChange={(v) => f.onChange(Number(v))}
                  invalid={!!fieldState.error}
                />
              )}
            />
            {errors.grade && <div role="alert" style={errStyle}>{t("Select a grade")}</div>}
          </div>
          <div>
            <label style={labelStyle}>{t("Status")}</label>
            <Controller
              control={control}
              name="status"
              render={({ field: f }) => (
                <Select
                  ariaLabel={t("Status")}
                  value={f.value ?? "Active"} // schema default, unapplied until submit
                  options={STATUS_OPTIONS.map((o) => ({ ...o, label: t(o.label) }))}
                  onChange={f.onChange}
                />
              )}
            />
          </div>
        </div>

        {/* Parent / Guardian */}
        <div>
          <label style={labelStyle}>{t("Parent / Guardian")} <span style={{ color: "var(--accent)" }}>*</span></label>
          <Controller
            control={control}
            name="parentId"
            render={({ fieldState, field: f }) => (
              <Select
                ariaLabel={t("Parent / Guardian")}
                value={f.value ?? ""} // optional in the schema; empty shows the placeholder
                placeholder={t("Select a parent…")}
                options={parentOptions}
                invalid={!!fieldState.error}
                onChange={f.onChange}
              />
            )}
          />
          {errors.parentId && <div role="alert" style={errStyle}>{t(errors.parentId.message ?? "")}</div>}
        </div>

        {/* Phone */}
        <div>
          <label style={labelStyle}>{t("Phone")} <span style={{ color: "var(--accent)" }}>*</span></label>
          <input className="ring" placeholder="(555) 0142" style={field(!!errors.phone)} {...register("phone")} />
          {errors.phone && <div role="alert" style={errStyle}>{t(errors.phone.message ?? "")}</div>}
        </div>

        {/* Notes */}
        <div>
          <label style={labelStyle}>{t("Notes")}</label>
          <textarea
            className="ring"
            placeholder={t("Optional notes…")}
            style={{ ...field(false), height: "auto", minHeight: 76, padding: "10px 12px", lineHeight: 1.5, resize: "vertical" }}
            {...register("notes")}
          />
        </div>
      </form>
    </Drawer>
  );
}
