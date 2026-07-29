"use client";

/* Class create/edit form — ported from the design comp's drawer "CLASS FORM"
 * block (drawerIsClass): Class name, a Type / Level pair, a Monthly tuition fee /
 * Classroom pair, the Meeting Schedule section and Teacher notes. Validation is
 * React Hook Form + the shared Zod schema, so the client and the Route Handler
 * enforce exactly the same rules.
 *
 * Scheduling lives in ScheduleEditor and is expressed as From / To (Sprint 5.1);
 * `classFormSchema` converts each row back to the stored `start` + `duration`,
 * so what this drawer POSTs is the same ClassInput it always was.
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
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { classFormSchema, type ClassFormValues, type ClassInput } from "@/lib/schemas";
import { fromMinutes, toMinutes } from "@/lib/calc";
import { useSettings } from "@/lib/settings-context";
import { Drawer } from "@/components/ui/drawer";
import { Select } from "@/components/ui/select";
import { TYPE_OPTIONS, compareSlots } from "./class-ui";
import { ScheduleEditor } from "./schedule-editor";
import type { Klass } from "@/lib/types";

const field = (invalid: boolean): React.CSSProperties => ({
  width: "100%", height: 38, padding: "0 11px",
  border: `1px solid ${invalid ? "var(--accent)" : "var(--border)"}`, borderRadius: 9,
  background: "var(--card)", color: "var(--fg)", fontSize: 13, fontFamily: "inherit", outline: "none",
});

const labelStyle: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 500, marginBottom: 6 };
const errStyle: React.CSSProperties = { fontSize: 11.5, color: "var(--accent)", marginTop: 5 };

/** The required marker. The non-breaking space keeps it welded to the last word
 * of the label, so a label that wraps in a narrow column (Monthly tuition fee
 * (VND/month)) can never leave a lone `*` on the next line. */
function Required() {
  return <span style={{ color: "var(--accent)", whiteSpace: "nowrap" }}>&nbsp;*</span>;
}

function emptyValues(): ClassFormValues {
  return {
    name: "", type: "group", level: "", fee: "", classroom: "", status: "Active", notes: "",
    schedule: [{ day: 1, start: "09:00", end: "10:00" }],
  };
}

function valuesFrom(c: Klass): ClassFormValues {
  return {
    name: c.name, type: c.type, level: c.level ?? "", fee: c.fee, classroom: c.classroom ?? "",
    status: c.status, notes: c.notes ?? "",
    // Seeded in the editor's canonical order (Monday first, then chronological)
    // so a row's position always equals its field-array index. Reordering the
    // array changes nothing about the schedule itself.
    schedule: c.schedule.slice().sort(compareSlots).map((s) => ({
      day: s.day, start: s.start, end: fromMinutes(toMinutes(s.start) + s.duration),
    })),
  };
}

/** Do all slots run at the same time? That is what same-time mode means, so a
 * class opens in the mode that actually describes its schedule. */
function isUniform(schedule: Klass["schedule"]): boolean {
  return schedule.every((s) => s.start === schedule[0].start && s.duration === schedule[0].duration);
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
  const { t, fmt } = useSettings();

  // Three generics: what the fields hold, context, and what validation emits —
  // fee and each slot's day are coerced and From / To becomes a duration, so the
  // shapes genuinely differ.
  const form = useForm<ClassFormValues, unknown, ClassInput>({
    resolver: zodResolver(classFormSchema),
    defaultValues: klass ? valuesFrom(klass) : emptyValues(),
  });
  const { register, handleSubmit, control, reset, formState: { errors } } = form;

  // Re-seed whenever the drawer opens for a different record.
  useEffect(() => {
    if (open) reset(klass ? valuesFrom(klass) : emptyValues());
  }, [open, klass, reset]);

  const typeOptions = TYPE_OPTIONS.map((o) => ({ ...o, label: t(o.label) }));

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
          <label style={labelStyle}>{t("Class name")}<Required /></label>
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
            <label style={labelStyle}>{t("Monthly tuition fee (VND/month)")}<Required /></label>
            {/* Grouped while typing (1500000 -> 1,500,000) through the shared
              * formatter, so it follows the number-format preference. The field
              * itself holds digits only, which is what the schema coerces and
              * what the payload carries — the separators never leave the input. */}
            <Controller
              control={control}
              name="fee"
              render={({ field: f }) => {
                const digits = String(f.value ?? "").replace(/\D/g, "");
                return (
                  <input
                    className="ring"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder={fmt.number(750000)}
                    aria-label={t("Monthly tuition fee (VND/month)")}
                    style={field(!!errors.fee)}
                    value={digits === "" ? "" : fmt.number(Number(digits))}
                    onChange={(e) => f.onChange(e.target.value.replace(/\D/g, ""))}
                    onBlur={f.onBlur}
                  />
                );
              }}
            />
            {errors.fee && <div role="alert" style={errStyle}>{t(errors.fee.message ?? "")}</div>}
          </div>
          <div>
            <label style={labelStyle}>{t("Classroom")}</label>
            <input className="ring" placeholder={t("e.g. Room A")} style={field(false)} {...register("classroom")} />
          </div>
        </div>

        {/* Meeting Schedule — weekdays + From / To, with availability help.
          * The section only exists while the drawer is open, so its mode state
          * is seeded fresh from the record on every open. */}
        <ScheduleEditor
          form={form}
          initialSameTime={klass ? isUniform(klass.schedule) : true}
          excludeId={klass?.id ?? null}
        />

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
