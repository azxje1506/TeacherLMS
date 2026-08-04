"use client";

/* Meeting Schedule — the create/edit drawer's scheduling section.
 *
 * Day chips own WHICH weekdays a class runs, in both modes. The switch only
 * decides whether those days share one time:
 *
 *  - Same time for all selected days (default): one Start → End pair, written
 *    to every selected weekday. Turning the switch off therefore already leaves
 *    each day filled in — nothing to copy, nothing lost.
 *  - Different times: one compact Start → End row per slot, under its weekday.
 *    A weekday may hold more than one lesson (a `+` adds one starting exactly
 *    where the previous ends, so it is back-to-back and valid by construction);
 *    overlapping times on one weekday are rejected by `classFormSchema` inline
 *    and by `classSchema` at the API.
 *
 * The field array is kept in canonical order (Monday first, then chronological)
 * by inserting each new slot at its place, so a row's position is always its RHF
 * index — no display-only sorting.
 *
 * From / To is presentation only: `classFormSchema` converts it back to the
 * stored `start` + `duration` before the payload ever leaves the client, so the
 * API, lesson generation, calendar and attendance see exactly what they always
 * did. Conflicts and suggestions come from the read-only availability endpoint —
 * a preview of the server's overlap rule, never a substitute for it.
 */

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useFieldArray, type UseFormReturn } from "react-hook-form";
import { fromMinutes, minutesBetween, toMinutes } from "@/lib/calc";
import { SLOT_MAX_MINUTES, SLOT_MIN_MINUTES, type ClassFormValues, type ClassInput } from "@/lib/schemas";
import { useSettings } from "@/lib/settings-context";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { classKeys, fetchAvailability, type AvailabilityParams } from "./api";
import { WEEK_ORDER, chipStyle, compareSlots, dowFull, dowShort } from "./class-ui";

type ClassForm = UseFormReturn<ClassFormValues, unknown, ClassInput>;
type FormSlot = ClassFormValues["schedule"][number];
type Slot = { day: number; start: string; end: string };

const labelStyle: React.CSSProperties = { display: "block", fontSize: 12.5, fontWeight: 500, marginBottom: 8 };
const errStyle: React.CSSProperties = { fontSize: 11.5, color: "var(--accent)", marginTop: 5 };
const hintStyle: React.CSSProperties = { fontSize: 11.5, color: "var(--muted)" };

const timeField = (invalid: boolean): React.CSSProperties => ({
  width: "100%", height: 38, padding: "0 8px",
  border: `1px solid ${invalid ? "var(--accent)" : "var(--border)"}`, borderRadius: 8,
  background: "var(--card)", color: "var(--fg)", fontSize: 13, fontFamily: "inherit", outline: "none",
});

const rowButton: React.CSSProperties = {
  minWidth: 34, width: 34, height: 38, border: "1px solid var(--border)", borderRadius: 8,
  background: "var(--card)", color: "var(--muted)",
  display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
};

const arrowIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", color: "var(--muted-2)" }}>
    <path d="M5 12h14" /><path d="m13 6 6 6-6 6" />
  </svg>
);

const warnIcon = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }}>
    <path d="M10.3 3.7 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0z" /><path d="M12 9v4" /><path d="M12 17h.01" />
  </svg>
);

/** The day/start/end of a form slot, read through the schema's loose input types. */
function readSlot(s: FormSlot): Slot {
  return { day: Number(s.day), start: String(s.start ?? ""), end: String(s.end ?? "") };
}

/** Where a new slot belongs so the array stays in canonical order. */
function insertionIndex(slots: Slot[], day: number, start: string): number {
  let at = 0;
  while (at < slots.length && compareSlots(slots[at], { day, start }) <= 0) at++;
  return at;
}

export function ScheduleEditor({
  form, initialSameTime, excludeId,
}: {
  form: ClassForm;
  /** Which mode describes the record being edited (all slots at one time or
   * not). Read once at mount — the drawer unmounts this section when it closes,
   * so every open seeds the mode from that record afresh. */
  initialSameTime: boolean;
  /** The class being edited, so its own slots never count as conflicts. */
  excludeId: string | null;
}) {
  const { t, lang } = useSettings();
  const { register, setValue, watch, trigger, formState: { errors } } = form;
  const { fields, insert, remove, replace } = useFieldArray({ control: form.control, name: "schedule" });
  const [sameTime, setSameTime] = useState(initialSameTime);

  const slots = (watch("schedule") ?? []).map(readSlot);
  // While weekdays are selected the first slot carries the common time; this
  // keeps it around when the last one is dropped, so re-selecting restores it.
  const [lastCommon, setLastCommon] = useState({ start: "09:00", end: "10:00" });
  const common = slots.length > 0 ? { start: slots[0].start, end: slots[0].end } : lastCommon;

  // Validate as soon as anything about the schedule changes rather than at save.
  const scheduleKey = JSON.stringify(slots);
  const settled = useRef(false);
  useEffect(() => {
    if (!settled.current) { settled.current = true; return; }
    trigger("schedule");
  }, [scheduleKey, trigger]);

  /* Switching modes changes this section's height. Hold the drawer's scroll
   * position across the swap so the fields above it cannot be dragged out of
   * place by the browser clamping scrollTop to a shorter document. */
  const rootRef = useRef<HTMLDivElement>(null);
  const keepScroll = useRef<number | null>(null);
  const scrollBox = () => rootRef.current?.closest<HTMLElement>("[data-drawer-body]") ?? null;
  useLayoutEffect(() => {
    const box = scrollBox();
    if (box && keepScroll.current !== null) box.scrollTop = keepScroll.current;
    keepScroll.current = null;
  }, [sameTime]);

  const scheduleError = errors.schedule?.message ?? errors.schedule?.root?.message;

  /** Apply one Start → End to every selected weekday (same-time mode). */
  const setCommonTime = (start: string, end: string) => {
    setLastCommon({ start, end });
    slots.forEach((_, i) => {
      setValue(`schedule.${i}.start`, start, { shouldDirty: true });
      setValue(`schedule.${i}.end`, end, { shouldDirty: true });
    });
  };

  /** A day chip owns every slot on that weekday. */
  const toggleDay = (day: number) => {
    const on = slots.reduce<number[]>((acc, s, i) => (s.day === day ? [...acc, i] : acc), []);
    if (on.length > 0) remove(on);
    else insert(insertionIndex(slots, day, common.start), { day, start: common.start, end: common.end });
  };

  /** Add a second lesson on a weekday, starting where its last one ends. */
  const addTimeOn = (day: number) => {
    const onDay = slots.filter((s) => s.day === day);
    const last = onDay[onDay.length - 1];
    const start = last ? last.end : common.start;
    const minutes = last ? minutesBetween(last.start, last.end) : minutesBetween(common.start, common.end);
    const end = fromMinutes(Math.min(toMinutes(start) + minutes, 24 * 60 - 1));
    insert(insertionIndex(slots, day, start), { day, start, end });
  };

  const switchMode = (next: boolean) => {
    keepScroll.current = scrollBox()?.scrollTop ?? null;
    // Off -> on: every row already holds its own time, so adopt the first row's
    // and keep one row per weekday. On -> off: the rows already carry the common
    // time (that is exactly what same-time mode wrote), so nothing to copy.
    if (next) {
      const kept: FormSlot[] = [];
      for (const s of slots) {
        if (!kept.some((k) => Number(k.day) === s.day)) {
          kept.push({ day: s.day, start: common.start, end: common.end });
        }
      }
      replace(kept);
      setLastCommon(common);
    }
    setSameTime(next);
  };

  return (
    <div ref={rootRef}>
      <label style={labelStyle}>
        {t("Meeting Schedule")}
        {/* nbsp keeps the required marker on the label's last line. */}
        <span style={{ color: "var(--accent)", whiteSpace: "nowrap" }}>&nbsp;*</span>
      </label>

      {/* Mode switch — one time for every selected day, or a time per lesson. */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, height: 44, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--card)" }}>
        <span style={{ fontSize: 12.5, fontWeight: 500 }}>{t("Use same time for all selected days")}</span>
        <Switch checked={sameTime} onChange={switchMode} ariaLabel={t("Use same time for all selected days")} />
      </div>

      {/* Days — the weekday set, shared by both modes. */}
      <div style={{ marginTop: 14 }}>
        <label style={labelStyle}>{t("Days")}</label>
        <div role="group" aria-label={t("Days")} style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {WEEK_ORDER.map((day) => {
            const on = slots.some((s) => s.day === day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDay(day)}
                style={{ ...chipStyle(on), height: 32, padding: "0 11px" }}
              >
                {dowShort(day, lang)}
              </button>
            );
          })}
        </div>
      </div>

      {/* Only the time controls swap; `key` replays the comp's opacity-only
        * selIn so nothing moves while the mode changes. */}
      <div key={sameTime ? "same" : "per"} style={{ marginTop: 14, animation: "selIn .18s ease both" }}>
        {sameTime ? (
          <div>
            <label style={labelStyle}>{t("Time")}</label>
            <TimeRow
              start={common.start}
              end={common.end}
              startInvalid={!!errors.schedule?.[0]?.start}
              endInvalid={!!errors.schedule?.[0]?.end}
              onChange={setCommonTime}
            />
            <RowError message={errors.schedule?.[0]?.start?.message ?? errors.schedule?.[0]?.end?.message} />
            <SlotAdvice
              days={slots.map((s) => s.day)}
              start={common.start}
              end={common.end}
              excludeId={excludeId}
              onPick={setCommonTime}
            />
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {fields.map((f, i) => {
              const slot = slots[i];
              if (!slot) return null;
              const onDay = slots.filter((s) => s.day === slot.day);
              const firstOfDay = slots.findIndex((s) => s.day === slot.day) === i;
              const lastOfDay = onDay[onDay.length - 1] === slot;
              return (
                <div key={f.id}>
                  {firstOfDay && (
                    <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>{dowFull(slot.day, lang)}</div>
                  )}
                  <TimeRow
                    startInvalid={!!errors.schedule?.[i]?.start}
                    endInvalid={!!errors.schedule?.[i]?.end}
                    startProps={register(`schedule.${i}.start`)}
                    endProps={register(`schedule.${i}.end`)}
                    trailing={
                      <>
                        {onDay.length > 1 ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => remove(i)}
                                aria-label={t("Remove lesson time")}
                                className="icon-danger"
                                style={rowButton}
                              >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 12h14" /></svg>
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>{t("Remove lesson time")}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <span style={{ width: 34 }} />
                        )}
                        {lastOfDay ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                type="button"
                                onClick={() => addTimeOn(slot.day)}
                                aria-label={t("Add a second time on this day")}
                                className="btn-ghost"
                                style={rowButton}
                              >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>{t("Add a second time on this day")}</TooltipContent>
                          </Tooltip>
                        ) : (
                          <span style={{ width: 34 }} />
                        )}
                      </>
                    }
                  />
                  <RowError message={errors.schedule?.[i]?.start?.message ?? errors.schedule?.[i]?.end?.message} />
                  <SlotAdvice
                    days={[slot.day]}
                    start={slot.start}
                    end={slot.end}
                    excludeId={excludeId}
                    onPick={(start, end) => {
                      setValue(`schedule.${i}.start`, start, { shouldDirty: true });
                      setValue(`schedule.${i}.end`, end, { shouldDirty: true });
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {scheduleError && <div role="alert" style={{ ...errStyle, marginTop: 10 }}>{t(String(scheduleError))}</div>}
    </div>
  );
}

/** Start → End. Controlled (same-time mode) or registered per row (per-day). */
function TimeRow({
  start, end, startInvalid, endInvalid, onChange, startProps, endProps, trailing,
}: {
  start?: string;
  end?: string;
  startInvalid: boolean;
  endInvalid: boolean;
  onChange?: (start: string, end: string) => void;
  startProps?: React.ComponentProps<"input">;
  endProps?: React.ComponentProps<"input">;
  trailing?: React.ReactNode;
}) {
  const { t } = useSettings();
  const bound = (which: "start" | "end") =>
    onChange
      ? {
          value: which === "start" ? start : end,
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            which === "start" ? onChange(e.target.value, end ?? "") : onChange(start ?? "", e.target.value),
        }
      : which === "start" ? startProps : endProps;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <input className="ring" type="time" aria-label={t("Start")} style={{ ...timeField(startInvalid), flex: 1 }} {...bound("start")} />
      {arrowIcon}
      <input className="ring" type="time" aria-label={t("End")} style={{ ...timeField(endInvalid), flex: 1 }} {...bound("end")} />
      {trailing}
    </div>
  );
}

function RowError({ message }: { message?: string }) {
  const { t } = useSettings();
  if (!message) return null;
  return <div role="alert" style={errStyle}>{t(message)}</div>;
}

/** Debounce a serialized request key so typing in a time field does not fire a
 * request per keystroke. "" means "nothing to ask". */
function useDebouncedKey(key: string, ms: number): string {
  const [settled, setSettled] = useState(key);
  useEffect(() => {
    const id = setTimeout(() => setSettled(key), ms);
    return () => clearTimeout(id);
  }, [key, ms]);
  return settled;
}

/** Free windows for one schedule row (or, in same-time mode, for the whole set
 * of selected weekdays at once), plus a warning when another Active class already
 * teaches then. Suggestions stand on their own as recommended times; a conflict
 * is shown above them, never instead of them. */
function SlotAdvice({
  days, start, end, excludeId, onPick,
}: {
  days: number[];
  start: string;
  end: string;
  excludeId: string | null;
  onPick: (start: string, end: string) => void;
}) {
  const { t, fmt, lang } = useSettings();

  const duration = minutesBetween(start, end);
  const askable =
    days.length > 0 && Number.isFinite(duration) &&
    duration >= SLOT_MIN_MINUTES && duration <= SLOT_MAX_MINUTES;
  const params: AvailabilityParams = { days: [...days].sort((a, b) => a - b), start, duration, excludeId };
  const key = useDebouncedKey(askable ? JSON.stringify(params) : "", 300);
  const asked: AvailabilityParams | null = key ? (JSON.parse(key) as AvailabilityParams) : null;

  const { data } = useQuery({
    queryKey: classKeys.availability(asked ?? params),
    queryFn: () => fetchAvailability(asked!),
    enabled: asked !== null,
    staleTime: 15_000,
  });

  if (!askable) return null;
  if (!data) return <div style={{ ...hintStyle, marginTop: 10 }}>{t("Checking availability…")}</div>;

  const { conflicts, suggestions } = data;
  if (conflicts.length === 0 && suggestions.length === 0) return null;
  const first = suggestions[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
      {conflicts.length > 0 && (
        <div style={{ border: "1px solid var(--border)", borderRadius: 10, background: "var(--amber-soft)", padding: "11px 12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, color: "var(--amber)", fontSize: 12.5, fontWeight: 600 }}>
            {warnIcon}
            {t("Schedule Conflict")}
          </div>
          {conflicts.map((c) => (
            <div key={`${c.classId}-${c.day}-${c.start}`} style={{ marginTop: 8, fontSize: 12.5, color: "var(--fg-2)" }}>
              <div style={{ fontWeight: 600, color: "var(--fg)" }}>{c.name}{c.level ? ` · ${c.level}` : ""}</div>
              <div style={{ marginTop: 2 }}>{dowFull(c.day, lang)} · {fmt.range(c.start, c.end)}</div>
            </div>
          ))}
          {first && (
            <button
              type="button"
              onClick={() => onPick(first.start, first.end)}
              className="btn-ghost"
              style={{ height: 32, marginTop: 11, padding: "0 12px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", color: "var(--fg)", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" }}
            >
              {t("Use Suggested Time")}
            </button>
          )}
        </div>
      )}

      {suggestions.length > 0 && (
        <div>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--muted)", marginBottom: 7 }}>
            {t("Suggested Available Times")}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {/* Each chip is a complete From – To window that is free on every
              * selected weekday; the tick states that outright rather than
              * leaving "suggested" to be read as "maybe". */}
            {suggestions.map((s) => (
              <Tooltip key={`${s.start}-${s.end}`}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => onPick(s.start, s.end)}
                    className="btn-ghost"
                    style={{ ...chipStyle(false), height: 30, fontSize: 12, gap: 6, color: "var(--fg-2)" }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none", color: "var(--green)" }}>
                      <path d="M20 6 9 17l-5-5" />
                    </svg>
                    {fmt.range(s.start, s.end)}
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("Free on every selected day")}</TooltipContent>
              </Tooltip>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
