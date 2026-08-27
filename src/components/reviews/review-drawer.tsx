"use client";

/* The Write / Edit monthly review drawer.
 *
 * BUILT UNDER THE GATE 2 DESIGN WAIVER. The imported design file carries the
 * Reviews INDEX in full but no review form, so the fields here are composed from
 * the sources the waiver names and from nothing else: the existing `Drawer`
 * chrome, the existing field family, the approved create/update field list, and
 * copy that already exists in the design's own dictionary — "Monthly review",
 * "Review month", "Teacher comment", "Write an overall reflection on the month…",
 * "Strengths", "What is this student doing well?", "Areas for improvement",
 * "Where should we focus next?", "Learning goals", "Goals for next month…",
 * "Parent notes", "A private note for the family…", "Save review", "Save
 * changes", and the ten skill labels, every one of which is an existing entry.
 * Nothing is written for this screen.
 *
 * NO FIELD BEYOND THE EIGHT. There is no status control, no class control, no
 * lesson control and no delete — not because they are hidden, but because a
 * review has no status, belongs to no session, and is a historical record of a
 * month that nothing in Sprint 8 removes.
 *
 * ON AN EDIT, THE OWNERSHIP CONTROLS ARE NOT RENDERED. The student and the month
 * are fixed when a review is created, so the month appears as static context
 * beside the student's name rather than as a control — this app's convention for
 * a field a form may not change (the homework drawer omits its class, the class
 * drawer carries `status` through without drawing one).
 *
 * What actually guarantees those fields are never written is `toUpdateBody`,
 * which names six fields and no others, and the server, which refuses any key
 * outside them.
 *
 * THE FIELDS ARE NOT DRAWN HERE ANY MORE. Gate 4.4D added a dedicated full-page
 * composer for Create and Edit, and rather than let two surfaces hold two copies
 * of the same ten radiogroups and five textareas, they were extracted whole into
 * review-form-fields.tsx and BOTH render that. Nothing about this panel changed:
 * the same fields, the same names, the same placeholders, the same keyboard
 * behaviour, the same "drawer" geometry. What changed is that there is now one
 * of them.
 *
 * THIS DRAWER HAS NO REMAINING CONSUMER. Gate 4.4D routes the Reviews index, the
 * Student Profile and the review timeline to the dedicated composer, so nothing
 * opens this panel any more. It is retained, unrouted, for Gate 4.5 to remove —
 * deleting a working component in the same gate that replaces it would put two
 * risks in one change.
 *
 * THE CLIENT NEVER COMPUTES A MONTH. The twelve selectable months and which of
 * them are taken arrive from the server (`GET /api/reviews/student/:id`). This
 * component picks one of them or none; it holds no clock, and it cannot offer a
 * thirteenth.
 */

import { useEffect } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useSettings } from "@/lib/settings-context";
import { Drawer } from "@/components/ui/drawer";
import { Select } from "@/components/ui/select";
import { Avatar } from "@/components/students/student-ui";
import { ReviewProseFields, ReviewSkillFields } from "@/components/reviews/review-form-fields";
import {
  emptyValues, firstAvailableMonth, hasAvailableMonth, toCreateBody, toUpdateBody, valuesFrom,
  type ReviewFormValues,
} from "@/components/reviews/form";
import { reviewCreateSchema } from "@/lib/schemas";
import type { ReviewMonthOption } from "@/lib/reviews";
import type { ReviewDetail } from "@/lib/reviews-service";
import type { ReviewCreateBody, ReviewUpdateBody } from "@/lib/schemas";

/** Edit mode offers no months at all — one shared empty array, so the reference
 * is stable across renders. */
const NO_MONTHS: ReviewMonthOption[] = [];

const field = (invalid: boolean): React.CSSProperties => ({
  // min/max-width are the drawer contract, not decoration: a control that
  // reports an intrinsic width wider than the panel makes the panel scroll
  // sideways. See globals.css, "Native date field".
  width: "100%", minWidth: 0, maxWidth: "100%", height: 38, padding: "0 11px",
  border: `1px solid ${invalid ? "var(--accent)" : "var(--border)"}`,
  borderRadius: 9, background: "var(--card)", color: "var(--fg)",
  fontSize: 13, fontFamily: "inherit", outline: "none",
});

const labelStyle: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 500, marginBottom: 6 };
const errStyle: React.CSSProperties = { fontSize: 11.5, color: "var(--accent)", marginTop: 5 };

/** The student a review is about, as the drawer needs to show them. Both the
 * index card and the student payload can supply this. */
export interface ReviewDrawerStudent {
  id: string;
  name: string;
  initials: string;
  color: string;
  avatar: string | null;
  gradeLabel: string;
}

interface BaseProps {
  open: boolean;
  student: ReviewDrawerStudent;
  /** False when the student has no resolvable parent — shown, never acted on. */
  parentLinked: boolean;
  saving: boolean;
  onClose: () => void;
}

/* Create and Edit are separate shapes rather than one shape with optional
 * handlers, so it is impossible to open the drawer on an existing review without
 * supplying something that can save it — and impossible to pass month options to
 * an edit, which may not change its month. */
type CreateProps = BaseProps & {
  review: null;
  /** The twelve selectable months, newest first, from the server. */
  months: ReviewMonthOption[];
  monthsLoading?: boolean;
  onCreate: (body: ReviewCreateBody) => void;
  onUpdate?: never;
};

type EditProps = BaseProps & {
  review: ReviewDetail;
  months?: never;
  monthsLoading?: never;
  onCreate?: never;
  onUpdate: (id: string, body: ReviewUpdateBody) => void;
};

export type ReviewDrawerProps = CreateProps | EditProps;

export function ReviewDrawer(props: ReviewDrawerProps) {
  const { open, student, parentLinked, saving, onClose, review } = props;
  const { t, fmt } = useSettings();
  const editing = review !== null;
  /* A stable empty array in edit mode: a fresh [] every render would make the
   * month effect below re-run on every render. An edit has no month options
   * because an edit may not change its month. */
  const months = props.review === null ? props.months : NO_MONTHS;
  const monthsLoading = props.review === null && props.monthsLoading === true;

  /* The server's own create schema validates the form, so the drawer cannot
   * disagree with the API about what is required or about which sentence says
   * so — including the group rule that at least one assessment note must be
   * written, which it attaches to `comment`. It suits an edit too: the student
   * and month are carried from the record, so they satisfy it without being
   * editable, and `toUpdateBody` is what keeps them off the wire. */
  const { register, control, handleSubmit, reset, setValue, formState: { errors, isDirty } } =
    useForm<ReviewFormValues>({
      resolver: zodResolver(reviewCreateSchema) as never,
      defaultValues: emptyValues(student.id, ""),
    });

  // Re-seed whenever the drawer opens for a different record, exactly as the
  // Class, Parent, Student and Homework drawers do.
  useEffect(() => {
    if (open) reset(review ? valuesFrom(review) : emptyValues(student.id, ""));
  }, [open, review, student.id, reset]);

  /* The months arrive after the drawer opens, so the default is applied when
   * they land — and only into a month the teacher has not already chosen, so a
   * late response cannot move a selection out from under them. */
  const month = useWatch({ control, name: "month" });
  useEffect(() => {
    if (!open || editing || month || isDirty) return;
    const next = firstAvailableMonth(months);
    /* RESET, not setValue — the default month must become part of the form's
     * BASELINE rather than a change against it. A server-supplied default is
     * not something the teacher did, so a drawer opened and immediately closed
     * must not claim to have unsaved work (see the Drawer's `dirty` contract).
     *
     * Guarded on `isDirty` as well as on `month`, so a slow response can never
     * reset a form somebody has already started typing into. */
    if (next) reset(emptyValues(student.id, next));
  }, [open, editing, month, isDirty, months, reset, student.id]);

  /* A create needs a month it is allowed to write. While the months are loading
   * there is nothing to save yet; once they have landed, a student whose last
   * twelve months are all reviewed has no create to make — and the footer button
   * says so by being disabled, rather than by refusing a press. No thirteenth
   * month is invented, and the button never becomes an Edit. */
  const canSave = editing || (!monthsLoading && hasAvailableMonth(months));

  const submit = handleSubmit((values) => {
    if (props.review !== null) props.onUpdate(props.review.id, toUpdateBody(values));
    else props.onCreate(toCreateBody(values));
  });

  const monthOptions = months.map((m) => ({
    value: m.month,
    label: fmt.monthLabel(m.month),
    disabled: m.taken,
  }));

  return (
    <Drawer
      dirty={isDirty}
      open={open}
      title={t("Monthly review")}
      subtitle={editing ? `${student.name} · ${fmt.monthLabel(review.month)}` : student.name}
      saveLabel={t(editing ? "Save changes" : "Save review")}
      saving={saving}
      canSave={canSave}
      onClose={onClose}
      onSave={submit}
    >
      <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: 16 }}>
        {/* Who this review is about. Fixed in both modes: a review addressed to
          * the wrong student is a different review, not an edit of this one. */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <Avatar
            name={student.name}
            initials={student.initials}
            avatar={student.avatar}
            color={student.color}
            size={44}
            fontSize={15}
          />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {student.name}
            </div>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{t(student.gradeLabel)}</div>
          </div>
        </div>

        {/* PROJECT_RULES: a feature that involves parent communication must say
          * clearly when a student has no linked parent. It is information only —
          * it blocks nothing, changes no data and notifies nobody. */}
        {!parentLinked && (
          <div style={{ fontSize: 12, color: "var(--muted)", background: "var(--card-2)", border: "1px solid var(--border)", borderRadius: 9, padding: "9px 11px", lineHeight: 1.5 }}>
            {t("No parent linked. Edit this student to assign one.")}
          </div>
        )}

        {/* Month: a control on a create, static context on an edit. */}
        {!editing ? (
          <div>
            <label style={labelStyle}>{t("Review month")}</label>
            <Controller
              control={control}
              name="month"
              render={({ field: f }) => (
                <Select
                  value={String(f.value ?? "")}
                  options={monthOptions}
                  onChange={f.onChange}
                  placeholder={t("Month")}
                  ariaLabel={t("Review month")}
                  invalid={!!errors.month}
                />
              )}
            />
            {errors.month && <div role="alert" style={errStyle}>{t(errors.month.message ?? "")}</div>}
          </div>
        ) : (
          <div>
            <label style={labelStyle}>{t("Review month")}</label>
            <div style={{ ...field(false), display: "flex", alignItems: "center", color: "var(--muted)" }}>
              {fmt.monthLabel(review.month)}
            </div>
          </div>
        )}

        {/* The ten ratings and the five prose fields — ONE implementation,
          * shared with the dedicated composer, in this panel's own geometry.
          * The group prose rule reports inside ReviewProseFields, on `comment`. */}
        <ReviewSkillFields
          control={control}
          register={register}
          setValue={setValue}
          errors={errors}
          variant="drawer"
        />
        <ReviewProseFields
          control={control}
          register={register}
          setValue={setValue}
          errors={errors}
          variant="drawer"
        />
      </form>
    </Drawer>
  );
}
