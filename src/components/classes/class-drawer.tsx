"use client";

/* Class create/edit form — ported from the design comp's drawer "CLASS FORM"
 * block (drawerIsClass): Class name, a Type / Level pair, a Monthly fee /
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
 * preserved by the server on update. `status` is carried through unchanged by
 * the form (a hidden field) so editing an Archived class never silently
 * reactivates it; changing it is an explicit act — the Archive / Restore action
 * at the foot of the drawer (Sprint 5.4), which confirms first and goes through
 * the same update path the detail header always used. */

import { useEffect, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { classFormSchema, type ClassFormValues, type ClassInput } from "@/lib/schemas";
import { fromMinutes, toMinutes } from "@/lib/calc";
import { useSettings } from "@/lib/settings-context";
import { Drawer } from "@/components/ui/drawer";
import { Select } from "@/components/ui/select";
import { Combobox } from "@/components/ui/combobox";
import { ConfirmDialog } from "@/components/ui/dialog";
import { TYPE_OPTIONS, compareSlots } from "./class-ui";
import { classKeys, fetchClassrooms } from "./api";
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
 * of its label, so it can never be left stranded alone on a second line. The
 * fee label is worded to fit the drawer's half-width column in one line
 * ("Monthly fee (VND/month)"); this is the belt to that braces. */
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
  open, klass, saving, onClose, onSave, onSetStatus, statusSaving = false,
}: {
  open: boolean;
  /** null = create, a Klass = edit. */
  klass: Klass | null;
  saving: boolean;
  onClose: () => void;
  onSave: (values: ClassInput) => void;
  /** Archive / restore the class being edited. Omit to hide the action. */
  onSetStatus?: (status: Klass["status"]) => void;
  statusSaving?: boolean;
}) {
  const { t, fmt } = useSettings();
  const [confirmStatus, setConfirmStatus] = useState(false);

  // Classrooms already in use, for the Classroom field's suggestions. Only
  // fetched while the drawer is open, and shared with every other consumer of
  // the key — a class mutation invalidates ["classes"] and refreshes it.
  const { data: classrooms } = useQuery({
    queryKey: classKeys.classrooms,
    queryFn: fetchClassrooms,
    enabled: open,
    staleTime: 60_000,
  });

  // Three generics: what the fields hold, context, and what validation emits —
  // fee and each slot's day are coerced and From / To becomes a duration, so the
  // shapes genuinely differ.
  const form = useForm<ClassFormValues, unknown, ClassInput>({
    resolver: zodResolver(classFormSchema),
    defaultValues: klass ? valuesFrom(klass) : emptyValues(),
  });
  const { register, handleSubmit, control, reset, formState: { errors, isDirty } } = form;

  // Re-seed whenever the drawer opens for a different record.
  useEffect(() => {
    if (open) reset(klass ? valuesFrom(klass) : emptyValues());
  }, [open, klass, reset]);

  /** Closing the drawer dismisses a confirm raised from inside it, so it can
   * never be left pending for the next class the drawer opens for. */
  const close = () => { setConfirmStatus(false); onClose(); };

  const typeOptions = TYPE_OPTIONS.map((o) => ({ ...o, label: t(o.label) }));
  const isArchived = klass?.status === "Archived";
  const nextStatus: Klass["status"] = isArchived ? "Active" : "Archived";

  return (
    <Drawer
      open={open}
      title={t(klass ? "Edit class" : "Create class")}
      subtitle={klass ? klass.name : t("Set up a new class")}
      saveLabel={t(klass ? "Save changes" : "Create class")}
      saving={saving}
      onClose={close}
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

        {/* Monthly fee / Classroom */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>{t("Monthly fee (VND/month)")}<Required /></label>
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
                    aria-label={t("Monthly fee (VND/month)")}
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
            {/* Free text with suggestions: the rooms other classes already use
              * are offered, but a brand-new name is typed straight in. There is
              * no Room entity — the server normalizes the spelling on save, so
              * "room a" and "ROOM A" land on the one classroom. */}
            <Controller
              control={control}
              name="classroom"
              render={({ field: f }) => (
                <Combobox
                  ariaLabel={t("Classroom")}
                  placeholder={t("e.g. Room A")}
                  value={String(f.value ?? "")}
                  options={classrooms ?? []}
                  onChange={f.onChange}
                  onBlur={f.onBlur}
                  emptyLabel="No classroom matches — press save to add it"
                />
              )}
            />
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

        {/* Archive / Restore — edit only. It is a status change on the stored
          * record, not part of this form's payload, so it never carries unsaved
          * edits with it and the hidden `status` field stays untouched. */}
        {klass && onSetStatus && (
          <div style={{ borderTop: "1px solid var(--border-2)", paddingTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{t("Class status")}</div>
              <div style={{ fontSize: 11.5, color: "var(--muted)", marginTop: 3, lineHeight: 1.45 }}>
                {t(isArchived
                  ? "Bring this class back into the Active list and resume its lessons."
                  : "Keep the class and its history, but stop scheduling new lessons.")}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setConfirmStatus(true)}
              disabled={statusSaving}
              className={isArchived ? "icon-restore" : "btn-ghost"}
              style={{ height: 34, padding: "0 13px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", color: isArchived ? "var(--green)" : "var(--fg)", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" }}
            >
              {t(isArchived ? "Restore class" : "Archive class")}
            </button>
          </div>
        )}
      </form>

      {/* The same centre dialog every confirm uses, layered above the drawer.
        * Archive / Restore acts on the STORED record, so edits sitting in the
        * form are not part of it — when the form is dirty the confirm says so
        * outright and is treated as destructive, because pressing through it
        * really does throw those edits away. A clean form gets the plain
        * confirm. */}
      <ConfirmDialog
        open={open && confirmStatus && !!klass}
        destructive={isDirty}
        title={t(isArchived ? "Restore class" : "Archive class")}
        message={
          isDirty
            ? `${t("You have unsaved changes.")} ${t(isArchived
                ? "Restoring this class will discard those changes."
                : "Archiving this class will discard those changes.")}`
            : isArchived
              ? `${t("This puts")} ${klass?.name ?? ""} ${t("back in the Active list.")}`
              : `${t("This hides")} ${klass?.name ?? ""} ${t("from the Active list. You can restore it at any time.")}`
        }
        confirmLabel={t(isArchived ? "Restore" : "Archive")}
        busy={statusSaving}
        onCancel={() => setConfirmStatus(false)}
        onConfirm={() => { setConfirmStatus(false); onSetStatus?.(nextStatus); }}
      />
    </Drawer>
  );
}
