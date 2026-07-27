"use client";

/* Parent create/edit form — ported verbatim from the design comp's drawer
 * "PARENT FORM" block (drawerIsParent): Full name, a Relationship / Phone pair,
 * Email and Notes. Validation is React Hook Form + the shared Zod schema, so the
 * client and the Route Handler enforce exactly the same rules.
 *
 * Required markers follow PROJECT_RULES.md (Full Name, Relationship, Phone),
 * which here happens to match the design's `*`. Email and Notes are optional. */

import { useEffect } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { parentSchema, RELATIONSHIP_OPTIONS, type ParentFormInput, type ParentInput } from "@/lib/schemas";
import { useSettings } from "@/lib/settings-context";
import { Drawer } from "@/components/ui/drawer";
import { Select } from "@/components/ui/select";
import type { Parent } from "@/lib/types";

const field = (invalid: boolean): React.CSSProperties => ({
  width: "100%", height: 38, padding: "0 11px",
  border: `1px solid ${invalid ? "var(--accent)" : "var(--border)"}`, borderRadius: 9,
  background: "var(--card)", color: "var(--fg)", fontSize: 13, fontFamily: "inherit", outline: "none",
});

const labelStyle: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 500, marginBottom: 6 };
const errStyle: React.CSSProperties = { fontSize: 11.5, color: "var(--accent)", marginTop: 5 };

function emptyValues(): ParentFormInput {
  return { name: "", relationship: "", phone: "", email: "", notes: "" };
}

function valuesFrom(p: Parent): ParentFormInput {
  return { name: p.name, relationship: p.relationship, phone: p.phone, email: p.email ?? "", notes: p.notes ?? "" };
}

export function ParentDrawer({
  open, parent, saving, onClose, onSave,
}: {
  open: boolean;
  /** null = create, a Parent = edit. */
  parent: Parent | null;
  saving: boolean;
  onClose: () => void;
  onSave: (values: ParentInput) => void;
}) {
  const { t } = useSettings();

  const { register, handleSubmit, control, reset, formState: { errors } } =
    useForm<ParentFormInput, unknown, ParentInput>({
      resolver: zodResolver(parentSchema),
      defaultValues: parent ? valuesFrom(parent) : emptyValues(),
    });

  // Re-seed whenever the drawer opens for a different record.
  useEffect(() => {
    if (open) reset(parent ? valuesFrom(parent) : emptyValues());
  }, [open, parent, reset]);

  const relationshipOptions = RELATIONSHIP_OPTIONS.map((r) => ({ value: r, label: t(r) }));

  return (
    <Drawer
      open={open}
      title={t(parent ? "Edit parent" : "Add parent")}
      subtitle={parent ? parent.name : t("Create a new parent")}
      saveLabel={t(parent ? "Save changes" : "Create parent")}
      saving={saving}
      onClose={onClose}
      onSave={handleSubmit(onSave)}
    >
      <form onSubmit={handleSubmit(onSave)} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Full name */}
        <div>
          <label style={labelStyle}>{t("Full name")} <span style={{ color: "var(--accent)" }}>*</span></label>
          <input className="ring" placeholder={t("e.g. Jennifer Chen")} style={field(!!errors.name)} {...register("name")} />
          {errors.name && <div role="alert" style={errStyle}>{t(errors.name.message ?? "")}</div>}
        </div>

        {/* Relationship / Phone */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label style={labelStyle}>{t("Relationship")} <span style={{ color: "var(--accent)" }}>*</span></label>
            <Controller
              control={control}
              name="relationship"
              render={({ fieldState, field: f }) => (
                <Select
                  ariaLabel={t("Relationship")}
                  value={f.value ?? ""}
                  placeholder={t("Select a relationship")}
                  options={relationshipOptions}
                  invalid={!!fieldState.error}
                  onChange={f.onChange}
                />
              )}
            />
            {errors.relationship && <div role="alert" style={errStyle}>{t(errors.relationship.message ?? "")}</div>}
          </div>
          <div>
            <label style={labelStyle}>{t("Phone")} <span style={{ color: "var(--accent)" }}>*</span></label>
            <input className="ring" placeholder="(555) 0142" style={field(!!errors.phone)} {...register("phone")} />
            {errors.phone && <div role="alert" style={errStyle}>{t(errors.phone.message ?? "")}</div>}
          </div>
        </div>

        {/* Email — optional in the schema, so no `*` (matches validation). */}
        <div>
          <label style={labelStyle}>{t("Email")}</label>
          <input className="ring" placeholder="name@email.com" style={field(!!errors.email)} {...register("email")} />
          {errors.email && <div role="alert" style={errStyle}>{t(errors.email.message ?? "")}</div>}
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
