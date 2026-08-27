"use client";

/* The Review form's FIELDS — the ten rating controls and the five prose boxes —
 * as one implementation shared by every surface that edits a review.
 *
 * WHY THIS FILE EXISTS. Gate 4.4D adds a dedicated full-page composer for both
 * Create and Edit. Without this extraction there would now be two copies of the
 * same ten radiogroups and the same five textareas — two places for a skill key
 * to be missed, two places for a placeholder to drift, two keyboard
 * implementations to keep in step, and two things to fix when the ten skills
 * change. There is one, and both the composer and the Gate 4.3 drawer render it.
 *
 * IT DECIDES NOTHING. There is no validation here, no default, no month rule and
 * no submit: the resolver is the server's own `reviewCreateSchema`, the values
 * and the bodies are shaped by src/components/reviews/form.ts, and the ten
 * canonical keys, their labels and the rating bounds come from the domain. This
 * file draws controls over a form somebody else owns.
 *
 * TWO GEOMETRIES, ONE CONTROL. `variant` selects the drawer's own field metrics
 * or the composer's taller ones. The SEMANTICS are identical in both — the same
 * radiogroup, the same roving tabindex, the same arrow keys, the same
 * `aria-checked`, the same registered field names — and so is the palette. See
 * `ratingSegmentStyle`, which owns the one visual difference.
 *
 * THE GROUP PROSE RULE REPORTS ON `comment`, and only there: at least one of
 * comment / strengths / improvements / goals must be written, so one message is
 * shown rather than four duplicates, and none of the four carries a required
 * marker because none of them is individually required.
 *
 * READ-ONLY IS A REAL STATE, NOT A STYLE. A saved review opens as something the
 * teacher READS; `readOnly` disables the ten rating controls and marks the five
 * textareas read-only, so a keyboard, a screen reader and a stray tap all get
 * the same answer as the eye does. The VALUES still render at full contrast —
 * this is a document being read, not a form being withheld.
 */

import { useWatch, type Control, type FieldErrors, type UseFormRegister, type UseFormSetValue } from "react-hook-form";
import { useSettings } from "@/lib/settings-context";
import { ratingSegmentStyle } from "@/components/reviews/reviews-ui";
import { REVIEW_RATING_MAX, REVIEW_RATING_MIN, SKILL_KEYS, SKILL_LABEL } from "@/lib/reviews";
import type { ReviewFormValues } from "@/components/reviews/form";

/** The five points of the scale, smallest first. Derived from the domain's own
 * bounds so the control cannot offer a rating the schema would refuse. */
const RATINGS = Array.from(
  { length: REVIEW_RATING_MAX - REVIEW_RATING_MIN + 1 },
  (_, i) => REVIEW_RATING_MIN + i
);

/** Which surface is rendering. "drawer" reproduces the Gate 4.3 panel exactly;
 * "composer" is the dedicated page's own metrics, from its reference. */
export type ReviewFieldsVariant = "drawer" | "composer";

/* The drawer's field family — min/max-width are its contract, not decoration: a
 * control that reports an intrinsic width wider than the panel makes the panel
 * scroll sideways. See globals.css, "Native date field". */
const fieldBase: React.CSSProperties = {
  width: "100%", minWidth: 0, maxWidth: "100%", height: 38, padding: "0 11px",
  border: "1px solid var(--border)",
  borderRadius: 9, background: "var(--card)", color: "var(--fg)",
  fontSize: 13, fontFamily: "inherit", outline: "none",
};

/* Derived from the field family, exactly as the student, parent, class and
 * homework drawers derive theirs, so a change to the family reaches the textarea
 * too. The composer's boxes are taller because the page has the room the panel
 * does not — the only difference between the two. */
function areaStyle(
  variant: ReviewFieldsVariant,
  invalid: boolean,
  readOnly = false
): React.CSSProperties {
  return {
    ...fieldBase,
    borderColor: invalid ? "var(--accent)" : "var(--border)",
    height: "auto", minHeight: variant === "composer" ? 108 : 76,
    padding: "10px 12px", lineHeight: 1.5,
    /* A read-only box is not resizable and takes the app's recessed surface —
     * the same --card-2 every other "this is context, not a control" panel
     * uses. The TEXT keeps --fg, because the teacher's words are the point. */
    resize: readOnly ? "none" : "vertical",
    background: readOnly ? "var(--card-2)" : "var(--card)",
    cursor: readOnly ? "default" : "auto",
  };
}

const labelStyle: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 500, marginBottom: 6 };
const errStyle: React.CSSProperties = { fontSize: 11.5, color: "var(--accent)", marginTop: 5 };

export interface ReviewFieldsProps {
  control: Control<ReviewFormValues>;
  register: UseFormRegister<ReviewFormValues>;
  setValue: UseFormSetValue<ReviewFormValues>;
  errors: FieldErrors<ReviewFormValues>;
  variant?: ReviewFieldsVariant;
  /** True in the persisted review's View stage: the values are shown and none
   * of them can be changed. Optional and false by default, so the drawer and
   * the Create composer are unaffected. */
  readOnly?: boolean;
}

/** The ten skills, in canonical SKILLS order, each as a five-point radiogroup.
 *
 * THE KEYS AND LABELS ARE THE DOMAIN'S. `SKILL_KEYS` and `SKILL_LABEL` both
 * derive from constants.ts, so a dimension added or renamed there reaches this
 * control without a line changing here, and no skill key is ever retyped.
 *
 * ROVING TABINDEX: one tab stop per skill, then the arrow keys a radiogroup is
 * expected to answer to. The next value is clamped to the domain's own bounds,
 * so the keyboard cannot reach a rating the schema would refuse either. */
export function ReviewSkillFields({ control, setValue, variant = "drawer", readOnly = false }: ReviewFieldsProps) {
  const { t } = useSettings();
  const skills = useWatch({ control, name: "skills" });
  const segmentVariant = variant === "composer" ? "fill" : "select";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: variant === "composer" ? 10 : 12 }}>
      {SKILL_KEYS.map((key) => {
        const label = t(SKILL_LABEL[key] ?? key);
        const value = skills?.[key];
        /* The composer puts the label and the scale on one line, as its
         * reference does; the drawer stacks them, as its panel always has.
         * Nothing else about the control differs. */
        const inline = variant === "composer";
        return (
          <div
            key={key}
            style={inline
              ? { display: "flex", alignItems: "center", gap: 12, minWidth: 0 }
              : undefined}
          >
            <label
              style={inline
                ? { flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, overflowWrap: "anywhere" }
                : labelStyle}
              id={`rv-skill-${key}`}
            >
              {label}
            </label>
            <div
              role="radiogroup"
              aria-labelledby={`rv-skill-${key}`}
              aria-readonly={readOnly || undefined}
              style={inline
                ? { display: "flex", gap: 6, minWidth: 0, flex: "0 1 240px" }
                : { display: "flex", gap: 6, minWidth: 0 }}
            >
              {RATINGS.map((rating) => {
                /* CHECKED IS ALWAYS "this is the chosen rating", in both
                 * variants. The fill variant paints the segments below it too,
                 * but it does not claim they are checked — a radiogroup has
                 * exactly one checked option, and assistive technology is told
                 * the same thing on both surfaces. */
                const active = value === rating;
                return (
                  <button
                    key={rating}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={`${label} ${rating}`}
                    /* DISABLED, not merely unstyled. A read-only rating that a
                     * keyboard could still move would be a control that lies
                     * about itself. The whole group leaves the tab order. */
                    disabled={readOnly}
                    tabIndex={readOnly ? -1 : active ? 0 : -1}
                    onKeyDown={(e) => {
                      if (readOnly) return;
                      const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1
                        : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
                      if (step === 0) return;
                      e.preventDefault();
                      const next = Math.min(
                        REVIEW_RATING_MAX,
                        Math.max(REVIEW_RATING_MIN, (value ?? rating) + step)
                      );
                      setValue(`skills.${key}`, next, { shouldValidate: true, shouldDirty: true });
                      (e.currentTarget.parentElement?.children[next - REVIEW_RATING_MIN] as HTMLElement)?.focus();
                    }}
                    onClick={() => {
                      if (readOnly) return;
                      setValue(`skills.${key}`, rating, { shouldValidate: true, shouldDirty: true });
                    }}
                    style={{
                      ...ratingSegmentStyle(rating, value, segmentVariant),
                      /* The VALUE keeps its full contrast — a read-only review
                       * is a document, not a greyed-out form. Only the
                       * affordance goes. */
                      cursor: readOnly ? "default" : "pointer",
                      opacity: 1,
                    }}
                  >
                    {rating}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** The five prose fields the teacher authors.
 *
 * EVERY LABEL AND PLACEHOLDER IS AN EXISTING DICTIONARY ENTRY, exactly as the
 * Gate 4.3 drawer's were. Nothing is written for a new screen.
 *
 * `parentNotes` IS NOT PART OF THE GROUP RULE. It is a message addressed to the
 * parent rather than the teacher's account of the month, so a review carrying
 * only parent notes has recorded no assessment at all — which is why the
 * composer marks it optional out loud and the group message never points here. */
export function ReviewProseFields({ register, errors, variant = "drawer", readOnly = false }: ReviewFieldsProps) {
  const { t } = useSettings();
  const gap = variant === "composer" ? 18 : 16;
  /* A read-only box shows what was written and offers no placeholder: a
   * placeholder is an invitation to type, and there is nothing to type into. */
  const ph = (text: string) => (readOnly ? undefined : t(text));

  return (
    <div style={{ display: "flex", flexDirection: "column", minWidth: 0, gap }}>
      <div>
        <label style={labelStyle} htmlFor="rv-comment">{t("Teacher comment")}</label>
        <textarea
          id="rv-comment"
          className="ring"
          readOnly={readOnly}
          placeholder={ph("Write an overall reflection on the month…")}
          style={areaStyle(variant, !!errors.comment, readOnly)}
          {...register("comment")}
        />
        {errors.comment && <div role="alert" style={errStyle}>{t(errors.comment.message ?? "")}</div>}
      </div>

      <div>
        <label style={labelStyle} htmlFor="rv-strengths">{t("Strengths")}</label>
        <textarea
          id="rv-strengths"
          className="ring"
          readOnly={readOnly}
          placeholder={ph("What is this student doing well?")}
          style={areaStyle(variant, false, readOnly)}
          {...register("strengths")}
        />
      </div>

      <div>
        <label style={labelStyle} htmlFor="rv-improvements">{t("Areas for improvement")}</label>
        <textarea
          id="rv-improvements"
          className="ring"
          readOnly={readOnly}
          placeholder={ph("Where should we focus next?")}
          style={areaStyle(variant, false, readOnly)}
          {...register("improvements")}
        />
      </div>

      <div>
        <label style={labelStyle} htmlFor="rv-goals">{t("Learning goals")}</label>
        <textarea
          id="rv-goals"
          className="ring"
          readOnly={readOnly}
          placeholder={ph("Goals for next month…")}
          style={areaStyle(variant, false, readOnly)}
          {...register("goals")}
        />
      </div>

      <div>
        <label style={labelStyle} htmlFor="rv-parent-notes">
          {t("Parent notes")}
          {variant === "composer" && (
            <span style={{ color: "var(--muted-2)", fontWeight: 400 }}> · {t("optional")}</span>
          )}
        </label>
        <textarea
          id="rv-parent-notes"
          className="ring"
          readOnly={readOnly}
          placeholder={ph("A private note for the family…")}
          style={areaStyle(variant, false, readOnly)}
          {...register("parentNotes")}
        />
      </div>
    </div>
  );
}
