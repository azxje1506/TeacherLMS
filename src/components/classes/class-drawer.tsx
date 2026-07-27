"use client";

/* Class create/edit form — ported verbatim from the design comp's drawer
 * "CLASS FORM" block (drawerIsClass): Class name, a Type / Level pair, a Monthly
 * tuition fee / Classroom pair, the repeatable Weekly schedule (day / time /
 * duration rows) and Teacher notes. Validation is React Hook Form + the shared
 * Zod schema, so the client and the Route Handler enforce exactly the same rules.
 *
 * Required markers follow PROJECT_RULES.md (Name, Monthly Tuition Fee, Weekly
 * Schedule), which here matches the design's `*`. Type, Level, Classroom and
 * Notes are optional.
 *
 * There is no student picker: enrolment (`studentIds`) is a later sprint and is
 * preserved by the server on update. `status` is carried through unchanged (a
 * hidden field) so editing an Archived class never silently reactivates it —
 * Archive / Restore lives on the detail header instead. */

import { useEffect } from "react";
import { useForm, useFieldArray, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { classSchema, type ClassFormInput, type ClassInput } from "@/lib/schemas";
import { useSettings } from "@/lib/settings-context";
import { Drawer } from "@/components/ui/drawer";
import { Select } from "@/components/ui/select";
import { TYPE_OPTIONS, DAY_OPTIONS, DURATION_OPTIONS } from "./class-ui";
import type { Klass } from "@/lib/types";

const field = (invalid: boolean): React.CSSProperties => ({
  width: "100%", height: 38, padding: "0 11px",
  border: `1px solid ${invalid ? "var(--accent)" : "var(--border)"}`, borderRadius: 9,
  background: "var(--card)", color: "var(--fg)", fontSize: 13, fontFamily: "inherit", outline: "none",
});

const labelStyle: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 500, marginBottom: 6 };
const errStyle: React.CSSProperties = { fontSize: 11.5, color: "var(--accent)", marginTop: 5 };

function emptyValues(): ClassFormInput {
  return {
    name: "", type: "group", level: "", fee: "", classroom: "", status: "Active", notes: "",
    schedule: [{ day: 1, start: "09:00", duration: 60 }],
  };
}

function valuesFrom(c: Klass): ClassFormInput {
  return {
    name: c.name, type: c.type, level: c.level ?? "", fee: c.fee, classroom: c.classroom ?? "",
    status: c.status, notes: c.notes ?? "",
    schedule: c.schedule.map((s) => ({ day: s.day, start: s.start, duration: s.duration })),
  };
}

export function ClassDrawer({
  open, klass, saving, onClose, onSave,
}: {
  open: boolean;
  /** null = create, a Klass = edit. */
  klass: Klass | null;
  saving: boolean;
  onClose: () => void;
  onSave: (values: ClassInput) => void;
}) {
  const { t } = useSettings();

  // Three generics: what the fields hold, context, and what validation emits —
  // fee and each slot's day/duration are coerced, so the shapes genuinely differ.
  const { register, handleSubmit, control, reset, formState: { errors } } =
    useForm<ClassFormInput, unknown, ClassInput>({
      resolver: zodResolver(classSchema),
      defaultValues: klass ? valuesFrom(klass) : emptyValues(),
    });

  const { fields, append, remove } = useFieldArray({ control, name: "schedule" });

  // Re-seed whenever the drawer opens for a different record.
  useEffect(() => {
    if (open) reset(klass ? valuesFrom(klass) : emptyValues());
  }, [open, klass, reset]);

  const typeOptions = TYPE_OPTIONS.map((o) => ({ ...o, label: t(o.label) }));
  const dayOptions = DAY_OPTIONS.map((o) => ({ ...o, label: t(o.label) }));
  // The array-level "add at least one slot" message; per-slot messages render inline.
  const scheduleError = errors.schedule?.message ?? errors.schedule?.root?.message;

  return (
    <Drawer
      open={open}
      title={t(klass ? "Edit class" : "Create class")}
      subtitle={klass ? klass.name : t("Set up a new class")}
      saveLabel={t(klass ? "Save changes" : "Create class")}
      saving={saving}
      onClose={onClose}
      onSave={handleSubmit(onSave)}
    >
      <form onSubmit={handleSubmit(onSave)} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Status is carried through unchanged (no design control). */}
        <input type="hidden" {...register("status")} />

        {/* Class name */}
        <div>
          <label style={labelStyle}>{t("Class name")} <span style={{ color: "var(--accent)" }}>*</span></label>
          <input className="ring" placeholder={t("e.g. Grammar Stars · B1")} style={field(!!errors.name)} {...register("name")} />
          {errors.name && <div role="alert" style={errStyle}>{t(errors.name.message ?? "")}</div>}
        </div>

        {/* Type / Level */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>{t("Type")}</label>
            <Controller
              control={control}
              name="type"
              render={({ field: f }) => (
                <Select
                  ariaLabel={t("Type")}
                  value={String(f.value ?? "group")}
                  options={typeOptions}
                  onChange={f.onChange}
                />
              )}
            />
          </div>
          <div>
            <label style={labelStyle}>{t("Level")}</label>
            <input className="ring" placeholder={t("e.g. B1 Intermediate")} style={field(false)} {...register("level")} />
          </div>
        </div>

        {/* Monthly tuition fee / Classroom */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>{t("Monthly tuition fee (VND/month)")} <span style={{ color: "var(--accent)" }}>*</span></label>
            <input className="ring" type="number" placeholder="750000" style={field(!!errors.fee)} {...register("fee")} />
            {errors.fee && <div role="alert" style={errStyle}>{t(errors.fee.message ?? "")}</div>}
          </div>
          <div>
            <label style={labelStyle}>{t("Classroom")}</label>
            <input className="ring" placeholder={t("e.g. Room A")} style={field(false)} {...register("classroom")} />
          </div>
        </div>

        {/* Weekly schedule — repeatable day / time / duration rows */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <label style={{ fontSize: 12.5, fontWeight: 500 }}>{t("Weekly schedule")} <span style={{ color: "var(--accent)" }}>*</span></label>
            <button
              type="button"
              onClick={() => append({ day: 1, start: "09:00", duration: 60 })}
              className="btn-ghost"
              style={{ height: 28, padding: "0 10px", border: "1px solid var(--border)", borderRadius: 7, background: "var(--card)", color: "var(--fg)", fontSize: 12, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
              {t("Add slot")}
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {fields.map((f, i) => (
              <div key={f.id} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr auto", gap: 7, alignItems: "center" }}>
                <Controller
                  control={control}
                  name={`schedule.${i}.day`}
                  render={({ field: sf }) => (
                    <Select
                      ariaLabel={t("Day")}
                      value={String(sf.value ?? "")}
                      options={dayOptions}
                      onChange={(v) => sf.onChange(Number(v))}
                    />
                  )}
                />
                <input
                  className="ring"
                  type="time"
                  aria-label={t("Start time")}
                  style={{ height: 38, padding: "0 8px", border: `1px solid ${errors.schedule?.[i]?.start ? "var(--accent)" : "var(--border)"}`, borderRadius: 8, background: "var(--card)", color: "var(--fg)", fontSize: 13, fontFamily: "inherit", outline: "none" }}
                  {...register(`schedule.${i}.start`)}
                />
                <Controller
                  control={control}
                  name={`schedule.${i}.duration`}
                  render={({ field: sf }) => (
                    <Select
                      ariaLabel={t("Duration")}
                      value={String(sf.value ?? "")}
                      options={DURATION_OPTIONS}
                      onChange={(v) => sf.onChange(Number(v))}
                    />
                  )}
                />
                <button
                  type="button"
                  onClick={() => remove(i)}
                  title={t("Remove slot")}
                  aria-label={t("Remove slot")}
                  className="icon-danger"
                  style={{ minWidth: 34, width: 34, height: 38, border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14" /></svg>
                </button>
              </div>
            ))}
          </div>
          {scheduleError && <div role="alert" style={{ ...errStyle, marginTop: 6 }}>{t(String(scheduleError))}</div>}
        </div>

        {/* Teacher notes */}
        <div>
          <label style={labelStyle}>{t("Teacher notes")}</label>
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
