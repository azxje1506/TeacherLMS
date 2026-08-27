"use client";

/* The dedicated Review composer — ONE full-page surface for Create, View and Edit.
 *
 * Ported from design-reference/review-detail-editor-preview-{top,bottom}.png:
 * a sticky header carrying the student's identity on the left and the review
 * action on the right, an editor in the left pane, and the generated monthly
 * report, live, in the right one.
 *
 * ---- THREE STAGES, AND WHY -------------------------------------------------
 *
 * A saved review is a historical record. It opens as something a teacher READS
 * — the values, the report, no Save button — and becomes editable only when they
 * say so. Create has no view stage; there is nothing saved to look at yet.
 *
 *   Write review -> create -> Save review -> /reviews/{id} -> VIEW
 *   VIEW -> Edit review -> EDIT -> Save changes -> VIEW
 *
 * `stage` is LOCAL SCREEN STATE. It is never persisted, never sent and never
 * read back: a Review document still carries no status field, and Sprint 8 still
 * has no Draft, Published or Final. There is no /edit route either — a mode is
 * not an address.
 *
 * ---- THE CROSS-MONTH FIX ---------------------------------------------------
 *
 * React Hook Form reads `defaultValues` once per mount. On a sibling navigation
 * — /reviews/A to /reviews/B through the month selector — the route param and
 * the fetched context change IN PLACE, and when B was already in the query cache
 * the swap happens with no loading state to unmount anything. The form went on
 * holding A's ten ratings and five prose fields while the header, the selector
 * and the id used for the save had all become B's. Saving then wrote A's answers
 * into B: a real cross-month overwrite, not a display artefact.
 *
 * Two independent guards now close it, because one JSX attribute is too easy to
 * drop:
 *
 *  1. the ROUTE keys this component on the record it is showing, so React
 *     remounts it (see the two page files);
 *  2. this component ALSO watches `composerIdentity(data)` and re-seeds the form
 *     from `baselineValues(data)` whenever it changes — and only then, so a
 *     background refetch of the SAME record can never clobber work in progress.
 *
 * And the save target is read from the same object the form was seeded from
 * (`saveTargetId`), so "the values on screen" and "the record they are written
 * to" cannot come from two places and disagree.
 *
 * ---- WHAT THE PREVIEW IS ---------------------------------------------------
 *
 * Every render builds a `MonthlyReviewReport` from the form's CURRENT values
 * through the pure `buildMonthlyReviewReportDraft`. Move a rating and the
 * overall score, its label, its colour, the bars, the radar and the
 * strongest/weakest lines move with it — before anything is written. No request
 * is made, no cache is touched, and nothing is created by looking at a preview.
 * In View the form is read-only, so the report is simply the persisted review.
 *
 * Attendance and Homework are NOT the form's to move: they are derived on the
 * server and arrive per month on the read model. Typing cannot change them;
 * changing the MONTH can, because a different month genuinely has different
 * figures — and it does so without a request, because every offered month came
 * in one.
 *
 * ---- THE PHONE'S SHAPE (620px and below) -----------------------------------
 *
 * Back, Preview, the student's identity and the review's action cannot share one
 * narrow row without all four becoming unreadable, and human verification found
 * them trying to. At 620px the screen is therefore three regions, top to bottom:
 *
 *   Back                                  Preview     <- navigation only
 *   Noah Rodriguez                                    <- the student, a block
 *   Monthly review · July 2026                           of its own, no avatar
 *   ...the form, or the persisted review...
 *   [ Cancel editing ][      Save changes      ]      <- ONE sticky action bar
 *
 * Preview stays at the top because it changes PRESENTATION rather than
 * persistence: it opens the report and writes nothing. Everything that writes —
 * Save review, Save changes, Edit review, Cancel editing — is in the bar, and in
 * the bar only, so no Review action is ever offered twice on one screen.
 *
 * HOW THAT IS ENFORCED, after the first attempt failed in the browser: the two
 * copies live in two plain wrapper elements, `.rvc-actions-desktop` and
 * `.rvc-actions-mobile`, and globals.css switches them as a COMPLEMENTARY PAIR
 * at 620px, both rules stated together. Visibility is a property of the region,
 * never of a button — because these buttons carry `display:"inline-flex"` as an
 * inline style, and an inline declaration beats any stylesheet `display:none`
 * that is not `!important`. Tagging the buttons and hiding them, which is what
 * the previous pass did, produced rules that were present and never won.
 *
 * The avatar is what the width is paid with, never the name: a 34px tint tells a
 * teacher nothing the name does not. It is addressed by its own class and hidden
 * with `!important`, for the same cascade reason.
 *
 * 620 IS THE ONLY LINE. Above it the header owns the actions at every width;
 * below it the bar does. There is no band where ownership is split, which is
 * what makes "both visible" unreachable rather than merely unlikely.
 *
 * ---- NO DEAD CONTROLS ------------------------------------------------------
 *
 * The reference's Print and Export PDF are Gate 4.4E's. A button that looks like
 * it exports and does nothing is worse than no button, so they are absent rather
 * than disabled; the header keeps their space and hierarchy.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSettings } from "@/lib/settings-context";
import { useToast } from "@/components/ui/toast";
import { useScrollLock } from "@/lib/use-scroll-lock";
import { ConfirmDialog } from "@/components/ui/dialog";
import { Select } from "@/components/ui/select";
import { Avatar } from "@/components/students/student-ui";
import { MonthlyReviewReportView } from "@/components/reviews/monthly-review-report";
import { ReviewProseFields, ReviewSkillFields } from "@/components/reviews/review-form-fields";
import { noParentPillStyle } from "@/components/reviews/reviews-ui";
import {
  createReview, reviewKeys, updateReview, ReviewApiError,
} from "@/components/reviews/api";
import { emptyValues, toCreateBody, toUpdateBody, type ReviewFormValues } from "@/components/reviews/form";
import {
  baselineValues, composerIdentity, initialStage, isEditable, monthChoice, monthOptions,
  monthSelectorEnabled, primaryActionKey, saveTargetId, selectedMonth, type ComposerStage,
} from "@/components/reviews/composer-state";
import {
  buildMonthlyReviewReportDraft, previousReviewOf,
  type MonthlyReviewReport, type ReviewComposerData, type ReviewReportDraft,
} from "@/lib/review-report";
import { reviewCreateSchema } from "@/lib/schemas";
import { EM } from "@/lib/format";
import type { ReviewCreateBody, ReviewUpdateBody } from "@/lib/schemas";

/* ------------------------------------------------------------------ chrome */

const iconBack = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
);
const iconEye = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
);
const iconPencil = (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
);
const iconClose = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
);
const iconStar = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 2.6 5.8 6.4.7-4.8 4.3 1.4 6.2L12 17l-5.6 3 1.4-6.2L3 9.5l6.4-.7z" /></svg>
);
const iconAlert = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.3 3.7 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" /></svg>
);
const iconTrend = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 17 6-6 4 4 8-8" /><path d="M15 7h6v6" /></svg>
);

const ghostBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
  height: 36, padding: "0 13px",
  border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)",
  color: "var(--fg-2)", fontSize: 13, fontWeight: 500, fontFamily: "inherit",
  cursor: "pointer", whiteSpace: "nowrap", flex: "none",
};
const primaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7,
  height: 36, padding: "0 16px", border: "none", borderRadius: 9,
  background: "var(--primary)", color: "var(--primary-fg)",
  fontSize: 13, fontWeight: 600, fontFamily: "inherit", cursor: "pointer",
  whiteSpace: "nowrap", flex: "none",
};
const panel: React.CSSProperties = {
  minWidth: 0, background: "var(--card)", border: "1px solid var(--border)",
  borderRadius: "var(--r)", boxShadow: "var(--sh)", padding: 18,
};
const capStyle: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase",
  color: "var(--muted-2)",
};

/* -------------------------------------------------------------- the screen */

export function ReviewComposer({ data }: { data: ReviewComposerData }) {
  const { t, fmt } = useSettings();
  const { toast } = useToast();
  const router = useRouter();
  const qc = useQueryClient();

  /** Create / View / Edit. A persisted review opens in View. */
  const [stage, setStage] = useState<ComposerStage>(() => initialStage(data.mode));
  const editable = isEditable(stage);
  const creating = stage === "create";

  /** WHICH RECORD this is — the string the re-seed guard watches. */
  const identity = composerIdentity(data);
  /** The review a save must address, read from the same object the form is
   * seeded from, so the two cannot disagree. */
  const targetId = saveTargetId(data);

  /** The pristine baseline for this record. A fresh object with no reference
   * into the query cache — see `baselineValues`. */
  const defaults = useMemo(() => baselineValues(data), [data]);

  const { register, control, handleSubmit, reset, setValue, formState: { errors, isDirty } } =
    useForm<ReviewFormValues>({
      resolver: zodResolver(reviewCreateSchema) as never,
      defaultValues: defaults,
    });

  /** What "pristine" means RIGHT NOW.
   *
   * Not the same as `defaults`: after a successful save the baseline is what was
   * just written, and the refetch that would eventually make `defaults` agree
   * has not landed yet. `Cancel editing` restores THIS, so cancelling after a
   * save returns to the saved values rather than to whatever the page was
   * originally loaded with. */
  const baselineRef = useRef<ReviewFormValues>(defaults);
  const seededFor = useRef(identity);

  const seed = useCallback((values: ReviewFormValues) => {
    baselineRef.current = values;
    reset(values);
  }, [reset]);

  /** RE-SEED WHEN THE RECORD CHANGES — AND ONLY THEN.
   *
   * This is the second of the two guards against the cross-month defect. The
   * route's `key` normally remounts this component; if anything ever stops it
   * doing so, this still notices that `data` now describes a different review
   * and rebuilds the form and the baseline from THAT record, so a month switch
   * can never leave one month's answers sitting in another month's form.
   *
   * Guarded on IDENTITY, never on `data` itself: the object identity of a React
   * Query result changes on every background refetch, and resetting on that
   * would throw away whatever the teacher was in the middle of typing — which is
   * the bug the drawer's late-arriving month effect had to be written around. */
  useEffect(() => {
    if (seededFor.current === identity) return;
    seededFor.current = identity;
    seed(defaults);
    setStage(initialStage(data.mode));
  }, [identity, defaults, data.mode, seed]);

  /* Every value, on every keystroke — this is what makes the preview live. */
  const watched = useWatch({ control }) as Partial<ReviewFormValues> | undefined;
  const draft = useMemo<ReviewReportDraft>(() => ({
    month: watched?.month ?? defaults.month,
    skills: watched?.skills ?? defaults.skills,
    comment: watched?.comment ?? "",
    strengths: watched?.strengths ?? "",
    improvements: watched?.improvements ?? "",
    goals: watched?.goals ?? "",
    parentNotes: watched?.parentNotes ?? "",
  }), [watched, defaults]);

  /** The report, rebuilt from the draft. Pure: the same context and draft always
   * give the same document, and neither is mutated to produce it. */
  const report = useMemo(() => buildMonthlyReviewReportDraft(data, draft), [data, draft]);

  /* ---- unsaved-change protection --------------------------------------- */

  /** VIEW IS NEVER DIRTY. Nothing in it can be changed, so leaving it never
   * prompts — and React Hook Form's own flag is ignored there rather than
   * trusted, because a stale `isDirty` must not be able to trap a teacher on a
   * page they only read. */
  const dirty = editable && isDirty;

  /* THREE THINGS CAN COST UNSAVED WORK, and all three ask the same question with
   * the same words. Exactly one is ever pending. */
  /** Where a guarded navigation is trying to go, or null when none is pending. */
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  /** True while `Cancel editing` is waiting on the confirmation. */
  const [pendingCancel, setPendingCancel] = useState(false);
  /** The Create month a teacher has asked to switch to, or null. */
  const [pendingMonth, setPendingMonth] = useState<string | null>(null);
  const confirming = pendingHref !== null || pendingCancel || pendingMonth !== null;

  /** THE ONLY WAY OFF THIS PAGE that this component initiates. Back and the
   * month selector both call it, so guarding one function guards both. Nothing
   * intercepts the router globally: a link elsewhere on the page is somebody
   * else's navigation, and a framework-wide interceptor would be exactly the
   * brittle hack this gate rules out. */
  const leaveTo = (href: string) => {
    if (dirty) setPendingHref(href);
    else router.push(href);
  };

  /* A refresh or a tab close is the browser's navigation, not ours, so the only
   * thing available is the native prompt — armed ONLY while there is something
   * to lose. The dialog's wording belongs to the browser; nothing here tries to
   * customise it. */
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  /** Leave Edit and go back to reading. Restores the pristine baseline, so a
   * discarded edit leaves nothing behind. */
  const returnToView = () => {
    reset(baselineRef.current);
    setStage("view");
  };

  const requestCancelEdit = () => {
    if (dirty) setPendingCancel(true);
    else returnToView();
  };

  /** Start a FRESH draft for another month, in Create.
   *
   * EACH CREATE MONTH IS AN INDEPENDENT REVIEW, and this is what makes that
   * true. Carrying the ratings and words across a month change was the earlier
   * behaviour, and human testing found it read as though a review were being
   * COPIED into a month nobody had written — which, on a screen whose whole job
   * is one month's assessment, is the worst possible thing to imply.
   *
   * So a month change resets to the canonical pristine baseline: ten ratings at
   * their neutral start, five blank prose fields, the destination month. That
   * reset becomes the new baseline, so switching and immediately leaving prompts
   * nothing.
   *
   * THERE IS NO PER-MONTH DRAFT CACHE. Nothing is stashed on the way out, so
   * coming back to a month a teacher has already abandoned gives them the same
   * fresh form as anyone else — never a half-written draft they thought they had
   * discarded. */
  const startMonth = (month: string) => {
    seed(emptyValues(data.student.id, month));
  };

  const requestMonth = (month: string) => {
    if (dirty) setPendingMonth(month);
    else startMonth(month);
  };

  /* ---- the preview overlay --------------------------------------------- */

  const [previewOpen, setPreviewOpen] = useState(false);
  /* PREVIEW NEVER SAVES AND NEVER EDITS. Closing it returns to the exact form
   * state, because the form is never unmounted — the overlay renders the report
   * beside it, not instead of it. */
  useScrollLock(previewOpen);
  useEffect(() => {
    if (!previewOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPreviewOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [previewOpen]);

  /* ---- saving ----------------------------------------------------------- */

  /** A review changes reviews, and the Dashboard's "Reviews to write" counter.
   *
   * THE DASHBOARD IS MARKED STALE WITHOUT BEING FETCHED. `GET /api/dashboard`
   * advances the lesson lifecycle, which WRITES to Lessons — so an active
   * refetch would turn saving a review into a lesson mutation nobody asked for.
   *
   * `reviewKeys.all` covers the index, every per-student cache AND both composer
   * reads in one call, because all of them live under ["reviews"]. Nothing else
   * is invalidated: a review changes no student, class, lesson, register or
   * assignment. */
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: reviewKeys.all });
    qc.invalidateQueries({ queryKey: ["dashboard"], refetchType: "none" });
  };

  const createMutation = useMutation({
    mutationFn: (body: ReviewCreateBody) => createReview(body),
    onSuccess: (saved) => {
      invalidate();
      /* THE BASELINE BECOMES WHAT WAS SAVED, before navigating — so the page
       * being left is no longer dirty and the guard has nothing to prompt
       * about. */
      seed(draftToValues(data.student.id, draft));
      toast(t("Review saved"));
      /* REPLACE, NOT PUSH. The create page has done its job and must not stay in
       * history behind the record it produced: going Back to it would offer to
       * write the month that was just written. The destination is the persisted
       * review's own page — which opens in View, so the teacher plainly sees
       * that their review is now saved. Never the Dashboard. */
      router.replace(`/reviews/${saved.id}`);
    },
    onError: (e: Error) => {
      toast(t(e.message), "error");
      /* A duplicate month usually means this client's picture is stale — the
       * month was written elsewhere, or in another tab — so the reviews caches
       * are refreshed and the selector corrected. The form stays exactly as it
       * is, with the teacher's words intact. One refetch, no retry loop. */
      if (e instanceof ReviewApiError && e.code === "review_already_exists") {
        qc.invalidateQueries({ queryKey: reviewKeys.all });
      }
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReviewUpdateBody }) => updateReview(id, body),
    onSuccess: () => {
      invalidate();
      /* THE PAGE STAYS PUT AND RETURNS TO READING. The baseline moves to what
       * was written, so the form is pristine again and no Save button remains
       * until the teacher deliberately presses Edit review. The preview is
       * unchanged — it was already showing these values. */
      seed(draftToValues(data.student.id, draft));
      setStage("view");
      toast(t("Review saved"));
    },
    onError: (e: Error) => toast(t(e.message), "error"),
  });

  const saving = createMutation.isPending || updateMutation.isPending;

  const submit = handleSubmit((values) => {
    if (stage === "create") createMutation.mutate(toCreateBody(values));
    /* THE TARGET COMES FROM THE LOADED RECORD, not from a route param read
     * somewhere else — so a save can only ever address the review whose values
     * are in the form. */
    else if (stage === "edit" && targetId) updateMutation.mutate({ id: targetId, body: toUpdateBody(values) });
  });

  /* ---- the month selector ------------------------------------------------ */

  /* ONE COMPACT TRIGGER, ONE TWELVE-MONTH LIST, BOTH MODES. Twelve buttons was a
   * wall that grew noisier with every month and appeared to collapse the moment
   * a review was saved, because Create listed the window and the persisted route
   * listed only the months that had reviews. It is the same window in both now;
   * what differs is which rows may be chosen and what each says about itself. */
  const options = useMemo(() => monthOptions(data, stage), [data, stage]);
  const shownMonth = selectedMonth(data, draft.month, stage);
  /* WHILE EDITING, THE MONTH IS CONTEXT, NOT A CHOICE. The field stays visible
   * and keeps its value; the trigger is disabled rather than opening a list of
   * destinations a teacher must not take mid-edit. Save changes or Cancel
   * editing returns them to View, where it becomes navigational again. */
  const monthEnabled = monthSelectorEnabled(stage);

  const selectOptions = options.map((o) => {
    const label = fmt.monthLabel(o.month);
    /* The state is spelled out rather than implied by a greyed row: "Reviewed"
     * tells a teacher that June is done, and "No review" tells them why they
     * cannot jump to May from here. */
    const suffix = o.state === "reviewed" ? ` · ${t("Reviewed")}`
      : o.state === "none" ? ` · ${t("No review")}`
      : "";
    return { value: o.month, label: `${label}${suffix}`, disabled: o.disabled };
  });

  const onMonthChange = (month: string) => {
    const choice = monthChoice(data, month, stage);
    /* CREATE starts a fresh draft for that month — see `requestMonth`, which
     * asks first when there is work to lose.
     *
     * VIEW navigates to the review that holds that month, through the same
     * guard. It never "selects": a saved review's month is fixed at creation,
     * and no control here can move it.
     *
     * EDIT reaches neither branch — `monthChoice` answers "none" for every month
     * while editing, and the trigger is disabled besides. */
    if (choice.kind === "select") requestMonth(choice.month);
    else if (choice.kind === "navigate") leaveTo(`/reviews/${choice.reviewId}`);
  };

  /* ---- header ------------------------------------------------------------ */

  const backBtn = (
    <button
      type="button"
      onClick={() => leaveTo("/reviews")}
      aria-label={t("Close")}
      className="btn-ghost rvc-back"
      style={{ ...ghostBtn, padding: "0 12px 0 9px" }}
    >
      {iconBack}
      <span className="rvc-btn-label">{t("Close")}</span>
    </button>
  );

  const previewBtn = (
    <button
      type="button"
      onClick={() => setPreviewOpen(true)}
      aria-label={t("Preview")}
      className="btn-ghost rvc-preview-btn"
      style={ghostBtn}
    >
      {iconEye}
      <span className="rvc-btn-label">{t("Preview")}</span>
    </button>
  );

  /* The primary action, by stage. View offers Edit review and NO save: a screen
   * that shows "Save changes" while nothing can be changed is lying about what
   * it will do.
   *
   * ONE DEFINITION, TWO REGIONS — AND THE REGION IS WHAT IS SWITCHED.
   *
   * The previous attempt tagged each header button with a class and hid the
   * BUTTONS at 620px. That rendered as a no-op in the browser: `primaryBtn` and
   * `ghostBtn` carry `display:"inline-flex"` as an INLINE style, and an inline
   * declaration outranks any stylesheet rule that is not `!important`. Every
   * hide was lost in the cascade, so View showed Edit review in the header AND
   * in the footer at the same time — while a source-scanning test confirmed the
   * rule was present. It was present. It never won.
   *
   * So visibility is no longer a property of a button. Each copy lives inside a
   * plain wrapper — `.rvc-actions-desktop` or `.rvc-actions-mobile` — which
   * carries NO inline style, and globals.css switches the two wrappers as a
   * complementary pair in one place. Nothing inside a region needs to know
   * anything about widths, and there is no width at which both are shown. */
  const primaryActionFor = (surface: "desktop" | "mobile") => {
    const bar = surface === "mobile";
    /* The bar's button fills the row and keeps a 44px thumb target. The header's
     * is the comp's own 36px inline action. Nothing else differs. */
    const style = bar ? { ...primaryBtn, flex: 1, height: 44 } : primaryBtn;
    return stage === "view" ? (
      <button
        type="button"
        onClick={() => setStage("edit")}
        className="btn-primary"
        style={style}
      >
        {iconPencil}
        {t(primaryActionKey(stage))}
      </button>
    ) : (
      <button
        type="button"
        onClick={submit}
        disabled={saving}
        className="btn-primary"
        style={style}
      >
        {t(primaryActionKey(stage))}
      </button>
    );
  };

  /* 'Cancel editing', on either surface — and ONE handler for both.
   *
   * requestCancelEdit already holds the dirty guard, so the sticky bar asks the
   * same single question the header asked and introduces no second confirmation
   * path: dirty prompts "Discard unsaved changes?", pristine returns to View at
   * once. */
  const cancelEditBtn = (surface: "desktop" | "mobile") => {
    const bar = surface === "mobile";
    return (
      <button
        type="button"
        onClick={requestCancelEdit}
        className="btn-ghost"
        style={bar ? { ...ghostBtn, height: 44 } : ghostBtn}
      >
        {t("Cancel editing")}
      </button>
    );
  };

  /** THE REVIEW ACTIONS FOR ONE REGION, in the order that region shows them.
   *
   * Both regions are built here, from the same three decisions, so neither can
   * offer an action the other does not — and each is wrapped by its owner below.
   * Which one the browser shows is entirely globals.css's business. */
  const reviewActions = (surface: "desktop" | "mobile") => (
    <>
      {dirty && <span className="rvc-dirty">● {t("Unsaved changes")}</span>}
      {stage === "edit" && cancelEditBtn(surface)}
      {primaryActionFor(surface)}
    </>
  );

  const header = (
    <div className="rvc-head">
      <div className="rvc-head-nav">
        {backBtn}
        <div className="rvc-head-id">
          {/* ADDRESSED BY NAME, NOT BY POSITION. The rule that drops the avatar
            * at 620px used to be `.rvc-head-id > *:first-child`, which says
            * "whatever happens to be first" rather than "the avatar" — and the
            * disc's own inline `display:flex` beat it in the cascade anyway, so
            * it stayed on screen. See .rvc-student-avatar in globals.css. */}
          <Avatar
            className="rvc-student-avatar"
            name={data.student.name}
            initials={data.student.initials}
            avatar={data.student.avatar}
            color={data.student.color}
            size={34}
            fontSize={12.5}
          />
          <div className="rvc-id-text">
            <div className="rvc-id-name">{data.student.name}</div>
            {/* Two context lines, one shown at a time. Above 768px the grade is
              * the secondary line, as the reference draws it; below it the month
              * matters more than the school and the grade would only compete
              * with the name for room. */}
            <div className="rvc-id-grade">{t("Monthly review")} · {t(data.student.gradeLabel)}</div>
            <div className="rvc-id-period">
              {t("Monthly review")}{shownMonth ? ` · ${fmt.monthLabel(shownMonth)}` : ""}
            </div>
          </div>
        </div>
        {/* Back and Preview are NAVIGATION and survive every width — Preview
          * because it changes presentation rather than persistence.
          *
          * Every Review action sits inside .rvc-actions-desktop, which is the
          * region that owns them above 620px and the whole of what disappears
          * below it. Preview is deliberately OUTSIDE that wrapper: it is not a
          * Review action and does not travel to the footer. */}
        <div className="rvc-head-actions">
          {previewBtn}
          <div className="rvc-actions-desktop">
            {reviewActions("desktop")}
          </div>
        </div>
      </div>
    </div>
  );

  /* CREATE WITH NOTHING LEFT TO WRITE. Every month in the window is already
   * reviewed, so there is no create to make: no thirteenth month is invented,
   * and this does not quietly become an Edit of one of the twelve. */
  if (creating && data.month.current === null) {
    return (
      <div className="rvc">
        {header}
        <div style={{ padding: "56px 24px", textAlign: "center" }}>
          <p style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 420, margin: "0 auto" }}>
            {t("This student already has a review for every month in the window.")}
          </p>
        </div>
      </div>
    );
  }

  const previous = previousReviewOf(data.history, draft.month);
  const scoreColor = report.summary.performanceColor;

  const editor = (
    <div className="rvc-editor">
      <div className="rvc-editor-inner" style={{ display: "flex", flexDirection: "column", gap: 20 }}>

        {/* ---- teacher summary --------------------------------------------
          * Deterministic analytics only, and every figure is the SAME object the
          * report draws, so the two panes cannot disagree. The reference's
          * "needs attention" line is absent: no stored field carries a concern
          * and no rule produces one. */}
        <div style={panel}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
            <div style={capStyle}>{t("Teacher summary")}</div>
            <span style={{ flex: "none", fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 99, whiteSpace: "nowrap", background: `color-mix(in srgb, ${scoreColor} 13%, var(--card))`, color: scoreColor }}>
              {t(report.summary.performanceLabel)} · <span style={{ fontFamily: "'Geist Mono',monospace" }}>{report.summary.overallScore.toFixed(1)}</span>
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(min(120px,100%),1fr))", gap: 8, marginBottom: 14 }}>
            <MiniTile label={t("Overall")} value={report.summary.overallScore.toFixed(1)} color={scoreColor} />
            <MiniTile label={t("Attendance")} value={pct(report.summary.attendance?.pct, t("No data"))} />
            <MiniTile label={t("Homework")} value={pct(report.summary.homework?.pct, t("No data"))} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {report.teacherSummary.strongest && (
              <SummaryLine icon={iconStar} color="var(--green)" label={t("Best skill")}
                value={`${t(report.teacherSummary.strongest.label)} · ${report.teacherSummary.strongest.rating}`} />
            )}
            {report.teacherSummary.weakest && (
              <SummaryLine icon={iconAlert} color="var(--amber)" label={t("Weakest skill")}
                value={`${t(report.teacherSummary.weakest.label)} · ${report.teacherSummary.weakest.rating}`} />
            )}
            {report.teacherSummary.improvement ? (
              <SummaryLine icon={iconTrend} color="var(--sky)" label={t("Biggest improvement")}
                value={`${t(report.skills.find((s) => s.key === report.teacherSummary.improvement!.key)?.label ?? "")} · ${report.teacherSummary.improvement.from} → ${report.teacherSummary.improvement.to}`} />
            ) : previous === null ? (
              <SummaryLine icon={iconTrend} color="var(--muted-2)" label={t("Biggest improvement")}
                value={t("First review — no prior month")} muted />
            ) : null}
          </div>

          {/* The PREVIOUS review's own words, as context for the month being
            * written. Never copied into this draft: a review is the teacher's
            * account of THIS month. It follows the selected month, because
            * `previousReviewOf` is asked about the draft's month and nothing
            * else — so it cannot leak from the month that was open before. */}
          {previous && previous.comment.trim() !== "" && (
            <div style={{ borderTop: "1px solid var(--border)", marginTop: 14, paddingTop: 12 }}>
              <div style={capStyle}>{t("Latest teacher note")}</div>
              <p style={{ fontSize: 12.5, color: "var(--fg-2)", lineHeight: 1.55, margin: "5px 0 0", overflowWrap: "anywhere" }}>
                {previous.comment}
              </p>
            </div>
          )}
        </div>

        {/* PROJECT_RULES: a feature that involves parent communication must say
          * clearly when a student has no linked parent. Informational only — it
          * blocks nothing, changes nothing and notifies nobody. */}
        {!data.parentLinked && (
          <div>
            <span style={noParentPillStyle()}>{t("No linked parent")}</span>
          </div>
        )}

        {/* ---- review month ------------------------------------------------ */}
        {/* The field is full-width inside its own column and capped only on a
          * roomy screen, so a phone gets a trigger the width of the form rather
          * than a narrow control floating inside it — see .rvc-month. */}
        <div className="rvc-month">
          <label style={{ ...capStyle, display: "block", marginBottom: 7 }} id="rvc-month-label">
            {t("Review month")}
          </label>
          <Select
            value={shownMonth}
            options={selectOptions}
            onChange={onMonthChange}
            placeholder={t("Month")}
            ariaLabel={t("Review month")}
            invalid={!!errors.month}
            disabled={!monthEnabled}
          />
          {!monthEnabled && (
            <div style={{ fontSize: 11.5, color: "var(--muted-2)", marginTop: 6 }}>
              {t("A review's month is fixed when it is created.")}
            </div>
          )}
          {errors.month && <div role="alert" style={{ fontSize: 11.5, color: "var(--accent)", marginTop: 6 }}>{t(errors.month.message ?? "")}</div>}
        </div>

        {/* ---- the form ---------------------------------------------------- */}
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", minWidth: 0, gap: 20 }}>
          <div>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
              <div style={capStyle}>{t("Skill ratings")} · 1–5</div>
              <div style={{ fontSize: 12, fontWeight: 600, color: scoreColor, whiteSpace: "nowrap" }}>
                {t("Avg rating")} <span style={{ fontFamily: "'Geist Mono',monospace" }}>{report.summary.overallScore.toFixed(1)}</span> · {t(report.summary.performanceLabel)}
              </div>
            </div>
            <ReviewSkillFields
              control={control}
              register={register}
              setValue={setValue}
              errors={errors}
              variant="composer"
              readOnly={!editable}
            />
          </div>

          <ReviewProseFields
            control={control}
            register={register}
            setValue={setValue}
            errors={errors}
            variant="composer"
            readOnly={!editable}
          />
        </form>
      </div>
    </div>
  );

  return (
    <div className="rvc" data-stage={stage}>
      {header}

      <div className="rvc-split">
        {editor}
        {/* The live preview. Below 620px this is removed from the document
          * entirely by globals.css and the overlay below is what shows it. */}
        <div className="rvc-preview">
          <MonthlyReviewReportView report={report} />
        </div>
      </div>

      {/* THE PHONE'S ACTION REGION — the other half of the complementary pair.
        *
        * Back, Preview, the student's identity and the review's action cannot
        * share one narrow row without all four becoming unreadable, so at 620px
        * the header keeps navigation only and EVERY Review action is here, at
        * the bottom of the screen where a thumb is — Save review in Create,
        * Edit review in View, Cancel editing + Save changes in Edit.
        *
        * IT IS RENDERED AT EVERY STAGE, and which region the browser shows is
        * decided in exactly one place: the paired rules in globals.css. There is
        * no width test in JavaScript, because a second breakpoint here would be
        * free to disagree with the first. */}
      <div className="rvc-actions-mobile">
        {reviewActions("mobile")}
      </div>

      {previewOpen && <PreviewOverlay report={report} onClose={() => setPreviewOpen(false)} />}

      {/* The app's existing centre dialog and its existing copy — not a second
        * confirm architecture and not a second sentence for the same decision.
        *
        * IT IS A PORTALLED MODAL LAYER and takes part in no header layout: it
        * renders into <body> at z-index 90/91, above this page's sticky header
        * and above the preview overlay, so Back, Preview and Save all stay
        * reachable underneath and nothing is pushed sideways to make room.
        *
        * "Keep editing" simply drops the prompt: the form underneath is never
        * touched, so every value and the caret are where they were — and the
        * month selector is still showing the month actually on screen, because
        * it is bound to the loaded record rather than to the click. */}
      <ConfirmDialog
        open={confirming}
        destructive
        title={t("Discard unsaved changes?")}
        message={t("Your changes haven't been saved. If you leave now, they will be lost.")}
        cancelLabel={t("Keep editing")}
        confirmLabel={t("Discard changes")}
        onCancel={() => { setPendingHref(null); setPendingCancel(false); setPendingMonth(null); }}
        onConfirm={() => {
          const href = pendingHref;
          const cancelling = pendingCancel;
          const month = pendingMonth;
          setPendingHref(null);
          setPendingCancel(false);
          setPendingMonth(null);
          /* Cancelling an edit restores the persisted values and returns to
           * reading; a Create month switch starts that month fresh; a navigation
           * leaves. None of the three saves anything. */
          if (cancelling) returnToView();
          else if (month) startMonth(month);
          else if (href) router.push(href);
        }}
      />
    </div>
  );
}

/* ------------------------------------------------------------ the overlay */

/** The full-screen report, on a phone.
 *
 * THE COMP'S OWN OVERLAY, NOT A NEW MODAL PRIMITIVE. `review-overlay`,
 * `report-body` and `report-scroll` are the design's own classes, and
 * globals.css already carries both their screen rules and the print rules that
 * unwrap them onto a page — which is what Gate 4.4E will print.
 *
 * IT SHOWS AND DOES NOTHING ELSE. There is no save here and no field: it renders
 * the same `MonthlyReviewReport` the split preview renders, over a form that was
 * never unmounted, so closing it returns to the exact unsaved state.
 *
 * Portalled to <body> for the reason the Drawer is: a page root running a
 * filling `fadeUp` animation becomes the containing block for fixed-position
 * descendants, which would confine this to the page's content box. */
function PreviewOverlay({ report, onClose }: { report: MonthlyReviewReport; onClose: () => void }) {
  const { t, fmt } = useSettings();

  return createPortal(
    <div className="review-overlay" role="dialog" aria-modal="true" aria-label={t("Monthly Progress Report")}>
      <div className="rvc-head">
        <div className="rvc-head-nav">
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="rvc-id-name">{t("Monthly Progress Report")}</div>
            <div style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {report.student.name} · {fmt.monthLabel(report.period)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("Close")}
            className="btn-ghost"
            style={{ ...ghostBtn, padding: "0 12px 0 10px" }}
          >
            {iconClose}
            {t("Close")}
          </button>
        </div>
      </div>
      <div className="report-body">
        <div className="report-scroll">
          <MonthlyReviewReportView report={report} />
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ------------------------------------------------------------------- bits */

/** `null` renders "No data", never 0% — the same rule every other Reviews
 * surface applies, for the same reason: an empty denominator is not a zero. */
function pct(value: number | null | undefined, noData: string): string {
  return typeof value === "number" ? `${value}%` : noData;
}

/** The form values a successful save has just written — the new pristine
 * baseline. Built from the draft rather than from the server's echo so the
 * fields the teacher is looking at are exactly the fields the baseline holds,
 * and with a FRESH skills object so the baseline can never alias the form's. */
function draftToValues(studentId: string, draft: ReviewReportDraft): ReviewFormValues {
  return { studentId, ...draft, skills: { ...draft.skills } };
}

function MiniTile({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ minWidth: 0, background: "var(--card-2)", border: "1px solid var(--border)", borderRadius: 10, padding: "9px 11px" }}>
      <div style={{ fontSize: 10, fontWeight: 600, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted-2)" }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-.02em", marginTop: 3, color: color ?? "var(--fg)", fontFamily: "'Geist Mono',monospace", overflowWrap: "anywhere" }}>
        {value}
      </div>
    </div>
  );
}

function SummaryLine({ icon, color, label, value, muted = false }: {
  icon: React.ReactNode; color: string; label: string; value: string; muted?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
      <span style={{ color, flex: "none", display: "flex" }}>{icon}</span>
      <span style={{ fontSize: 12, color: "var(--muted)", flex: "none" }}>{label}</span>
      <span style={{ flex: 1, minWidth: 0, textAlign: "right", fontSize: 12.5, fontWeight: muted ? 500 : 600, color: muted ? "var(--muted)" : "var(--fg-2)", overflowWrap: "anywhere" }}>
        {value || EM}
      </span>
    </div>
  );
}

/* NOTE ON WHAT THIS FILE NEVER IMPORTS. `perfColor` and `perfLabel` appear
 * nowhere above: the performance word and its colour band arrive already
 * resolved on the report DTO, so this screen never grades a number itself and
 * cannot disagree with the document beside it about what a 3.1 means. Neither
 * does anything here compute an average, a ranking or a percentage — every
 * figure it renders was derived in src/lib/review-report.ts. */
