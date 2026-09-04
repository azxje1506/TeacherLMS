"use client";

/* Finance — the Overview tab, ported from the design comp's FINANCE screen.
 *
 * Three KPI cards, the money summary with its collection bar and four tiles,
 * outstanding students beside top performing classes, and revenue by class with
 * its expandable per-student grid.
 *
 * THE FOURTH TILE IS THE POINT OF THIS SCREEN'S HONESTY. The comp itself draws
 * "Lesson revenue · completed lessons · informational" with a DASHED border,
 * beside three solid bill-derived tiles — the design already separates money
 * asked for from money earned, and this port keeps that separation in the markup
 * and in the code's vocabulary. Everything here reads `billing.*` except that
 * one tile, which reads `revenue.total`.
 *
 * `No data` IS NEVER `0đ`. Every amount that can be unknown goes through
 * `money()`, so a `Partially Paid` bill whose amount was never recorded — and
 * any total containing one — says so instead of claiming nothing was collected.
 * The collection bar renders a neutral unknown state rather than a proportion it
 * cannot compute.
 *
 * GHOSTS ARE COUNTED AND NEVER NAMED. The totals include bills whose student no
 * longer exists; the lists do not. No id, name or placeholder row for a deleted
 * person is rendered.
 *
 * HISTORICAL ACCOUNTING AND ACTIONABLE PEOPLE ARE TWO DIFFERENT QUESTIONS, and
 * Gate 5.5 separates them. An aggregate may legitimately include tuition whose
 * student is gone; a list a teacher works FROM may not, and it may not hint that
 * it is hiding somebody either. So the disclosure is no longer the comp's
 * "+N more" — which read as a control that would reveal four more names to chase
 * — but a sentence, and it appears in exactly the two places where a total is
 * genuinely larger than the rows under it: the month's money summary, and one
 * class's expanded student detail. Outstanding students and Payments carry
 * nothing: they are lists of people to act on, and every row in them is live.
 *
 * NO PAYMENT CONTROLS. The comp has Record / Manage buttons but no payment form
 * anywhere in it, so none is drawn — PROJECT_RULES forbids inventing missing UI,
 * and a disabled button that suggests a working feature is worse than nothing.
 *
 * THE MOBILE SHAPE IS CSS, NOT A SECOND COMPONENT. The three panels the human
 * pass called too dense at <=620px keep this markup exactly; globals.css's
 * Finance block restacks them. Desktop and tablet are untouched, which is what
 * "tablet already passed" has to mean.
 */

import { useState } from "react";
import { useSettings } from "@/lib/settings-context";
import type { FinanceMonthPayload } from "@/lib/finance-service";
import {
  NOT_DETERMINED, NOT_RECORDED, NO_BILLING_BODY, NO_BILLING_TITLE, RATE_BASIS,
  STATUS_LABEL, UNKNOWN_SEGMENT, barWidth, billingState, financeNoteStyle,
  historicalNote, historicalPartialNote, money, partialNote, rankByCollected,
  rateText, sortByOutstanding, statusBadgeStyle, statusColor,
} from "./finance-ui";

/** Every place a scope's incomplete amounts have to be explained draws the same
 * pair of sentences from the same two counts: the records a teacher could still
 * settle, and the ones that are closed history. Rendered as captions, never as
 * warnings, and never at zero. */
function IncompleteNotes({ scope, style }: {
  scope: { unknownLiveAmountBills: number; unknownHistoricalAmountBills: number };
  style?: React.CSSProperties;
}) {
  const { t } = useSettings();
  if (scope.unknownLiveAmountBills === 0 && scope.unknownHistoricalAmountBills === 0) return null;
  return (
    <>
      {scope.unknownLiveAmountBills > 0 && (
        <div data-testid="fin-partial-note" style={{ ...financeNoteStyle, ...style }}>
          {partialNote(scope.unknownLiveAmountBills, t)}
        </div>
      )}
      {scope.unknownHistoricalAmountBills > 0 && (
        <div data-testid="fin-historical-partial-note" style={{ ...financeNoteStyle, ...style }}>
          {historicalPartialNote(scope.unknownHistoricalAmountBills, t)}
        </div>
      )}
    </>
  );
}

const cardStyle: React.CSSProperties = {
  background: "var(--card)", border: "1px solid var(--border)",
  borderRadius: "var(--r)", boxShadow: "var(--sh)",
};

const kpiIconStyle = (fg: string, bg: string): React.CSSProperties => ({
  minWidth: 32, width: 32, height: 32, borderRadius: 9, display: "flex",
  alignItems: "center", justifyContent: "center", background: bg, color: fg,
});

const kpiLabelStyle: React.CSSProperties = {
  fontSize: 12, color: "var(--muted)", fontWeight: 600,
  textTransform: "uppercase", letterSpacing: ".05em",
};

const kpiValueStyle = (color?: string): React.CSSProperties => ({
  fontSize: 18, fontWeight: 600, letterSpacing: "-.03em", marginTop: 13,
  fontFamily: "'Geist Mono',monospace", whiteSpace: "nowrap",
  overflow: "hidden", textOverflow: "ellipsis",
  ...(color ? { color } : {}),
});

/* The caption keeps its designed content and `note` is an extra muted line
 * under it, rather than the caption being replaced when amounts are incomplete.
 * Both facts matter and they are different: the caption says how many bills are
 * settled, the note says how many amounts were never written down. */
function Kpi({ label, icon, iconFg, iconBg, value, valueColor, caption, note }: {
  label: string; icon: React.ReactNode; iconFg: string; iconBg: string;
  value: string; valueColor?: string; caption: string; note?: React.ReactNode;
}) {
  return (
    <div style={{ ...cardStyle, padding: "18px 16px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={kpiLabelStyle}>{label}</span>
        <span style={kpiIconStyle(iconFg, iconBg)}>{icon}</span>
      </div>
      <div style={kpiValueStyle(valueColor)}>{value}</div>
      <div style={{ fontSize: 12, color: "var(--muted-2)", marginTop: 5 }}>{caption}</div>
      {note}
    </div>
  );
}

const iconWallet = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /><path d="M16 12h3" /></svg>
);
const iconCheck = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
);
const iconClock = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
);

export function FinanceOverview({ data }: { data: FinanceMonthPayload }) {
  const { t, fmt } = useSettings();
  /* THE ONE PLACE THIS TAB STILL HAS AN UNKNOWN. No aggregate uses one: a month
   * or a class always reports the money it can prove. This is for a single
   * bill's single field — an outstanding row whose amount was never recorded —
   * where "so this cannot be worked out" is genuinely the whole truth. The
   * per-student grid needs the other half of the pair and declares it itself. */
  const notDetermined = t(NOT_DETERMINED);
  const monthLabel = fmt.monthLabel(data.month);
  const { billing, revenue } = data;

  const [expanded, setExpanded] = useState<string | null>(null);

  /* A MONTH WITH NO BILLS IS NOT A MONTH OF ZEROES. Every total would be a
   * truthful zero and the screen would still answer the wrong question: "0đ
   * collected of 0đ billed, 0 of 0 bills paid, everyone has paid" reads as a
   * month that went perfectly, when nothing was ever billed. So the billing
   * half of this tab becomes one explicit empty state that says which.
   *
   * AND NOTHING ELSE IS ON IT. An earlier pass left the dashed lesson-revenue
   * tile below this card, reasoning that lessons were taught even where no bill
   * was raised. On a screen with nothing else on it that tile is not context,
   * it is a lone unexplained figure under an empty state — the separation it
   * exists to express only reads when there is billing beside it to be separate
   * FROM. Lesson revenue keeps its whole tab, one click away. */
  if (billingState(billing) === "empty") {
    return (
      <>
        <div data-testid="fin-billing-empty" style={{ border: "1px dashed var(--border)", borderRadius: 16, background: "var(--card)", padding: "56px 24px", textAlign: "center", marginBottom: "var(--gap)" }}>
          <div style={{ minWidth: 52, width: 52, height: 52, borderRadius: "var(--r)", background: "var(--card-2)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 14px", color: "var(--muted)" }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /><path d="M16 12h3" /></svg>
          </div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{t(NO_BILLING_TITLE)}</div>
          <p style={{ color: "var(--muted)", fontSize: 13.5, maxWidth: 400, margin: "8px auto 0" }}>
            {t(NO_BILLING_BODY)}
          </p>
        </div>
      </>
    );
  }

  /* THREE SEGMENTS, AND THEY ADD UP. `knownCollected + knownOutstanding +
   * unknownAmount === billed` holds by construction in `totalsFor`, so the bar
   * is full at every width and no segment has to be stretched to close a gap.
   * The third one is the honest part: it is the slice of the month whose split
   * nobody recorded, drawn in a neutral tone because it is a fact about old
   * bookkeeping and not a problem to fix. */
  const collectedW = barWidth(billing.knownCollected, billing.billed);
  const outstandingW = barWidth(billing.knownOutstanding, billing.billed);
  const unknownW = barWidth(billing.unknownAmount, billing.billed);

  const ranked = rankByCollected(billing.perClass);
  const byOutstanding = sortByOutstanding(billing.perClass);

  return (
    <>
      {/* ---- Revenue KPIs. `.kpi-grid` is the app's existing escape: three
        * across, two at <=1100 and one at <=620. The comp's raw
        * repeat(3,minmax(0,1fr)) would put a 13,100,000d monospace figure into a
        * ~110px card on a phone. */}
      <div className="kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "var(--gap)", marginBottom: "var(--gap)" }}>
        <Kpi
          label={t("Expected revenue")}
          icon={iconWallet} iconFg="var(--sky)" iconBg="var(--sky-soft)"
          value={fmt.vnd(billing.billed)}
          caption={`${t("Total billable")} · ${monthLabel}`}
        />
        {/* THE MONEY THAT IS KNOWN IS ALWAYS SHOWN. These two used to be
          * replaced wholesale the moment one bill in the month lacked a
          * recorded amount — 8,550,000đ of collected tuition hidden behind one
          * 700,000đ record. They now show what the month can prove, and say
          * underneath how much of it is still unaccounted for.
          *
          * "x of y bills paid" counts bills SETTLED IN FULL. A partial that
          * moved real money does not raise x; its money is already inside the
          * figure above. The two are different statements and both are true. */}
        <Kpi
          label={t("Collected revenue")}
          icon={iconCheck} iconFg="var(--green)" iconBg="var(--green-soft)"
          value={fmt.vnd(billing.knownCollected)}
          valueColor="var(--green)"
          caption={`${billing.counts.paid} ${t("of")} ${billing.counts.total} ${t("bills paid")}`}
          note={<IncompleteNotes scope={billing} style={{ marginTop: 4 }} />}
        />
        <Kpi
          label={t("Outstanding balance")}
          icon={iconClock} iconFg="var(--accent)" iconBg="var(--accent-soft)"
          value={fmt.vnd(billing.knownOutstanding)}
          valueColor="var(--accent)"
          caption={t("Unpaid + partial still due")}
          note={<IncompleteNotes scope={billing} style={{ marginTop: 4 }} />}
        />
      </div>

      {/* ---- Money summary ---- */}
      <div style={{ ...cardStyle, padding: "20px 22px", marginBottom: "var(--gap)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{t("Money summary")} · {monthLabel}</div>
            <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>
              {t("Expected = Collected + Outstanding · Rate = Collected ÷ Expected")}
            </div>
          </div>
        </div>

        {/* THE BAR IS ALWAYS DRAWN, AND IT ALWAYS ADDS UP. It used to vanish
          * entirely the moment one amount was missing, leaving a teacher with a
          * blank track where four fifths of a real proportion could have been.
          * Now the two known slices are drawn at their true widths and the rest
          * is a third, neutral segment: the part of the billed total whose split
          * nobody recorded.
          *
          * THAT SEGMENT IS NOT MONEY NOT COLLECTED. It is the whole fee of a
          * bill we know was partly paid and cannot split, so it is neither
          * green nor accent — a muted band, because it is a fact about old
          * bookkeeping rather than a debt or a warning. */}
        <div style={{ display: "flex", height: 16, borderRadius: 99, overflow: "hidden", background: "var(--card-2)", marginBottom: 9 }}>
          {collectedW && <div style={{ height: "100%", background: "var(--green)", width: collectedW }} />}
          {outstandingW && <div style={{ height: "100%", background: "var(--accent)", width: outstandingW }} />}
          {unknownW && <div data-testid="fin-bar-unknown" style={{ height: "100%", background: "var(--muted-2)", opacity: .35, width: unknownW }} />}
        </div>

        <div className="fin-summary-legend" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 18 }}>
          <div className="fin-metric" style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ minWidth: 9, width: 9, height: 9, borderRadius: 3, background: "var(--green)" }} />
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {t("Collected")} <b style={{ color: "var(--fg)", fontFamily: "'Geist Mono',monospace" }}>{fmt.vnd(billing.knownCollected)}</b>
            </span>
          </div>
          <div className="fin-metric" style={{ display: "flex", alignItems: "center", gap: 7 }}>
            <span style={{ minWidth: 9, width: 9, height: 9, borderRadius: 3, background: "var(--accent)" }} />
            <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
              {t("Outstanding")} <b style={{ color: "var(--fg)", fontFamily: "'Geist Mono',monospace" }}>{fmt.vnd(billing.knownOutstanding)}</b>
            </span>
          </div>
          {/* The third segment earns a legend entry only when it exists. */}
          {!billing.amountsComplete && (
            <div className="fin-metric" data-testid="fin-legend-unknown" style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ minWidth: 9, width: 9, height: 9, borderRadius: 3, background: "var(--muted-2)", opacity: .35 }} />
              <span style={{ fontSize: 12.5, color: "var(--muted)" }}>
                {t(UNKNOWN_SEGMENT)} <b style={{ color: "var(--fg)", fontFamily: "'Geist Mono',monospace" }}>{fmt.vnd(billing.unknownAmount)}</b>
              </span>
            </div>
          )}
          {/* A RATE THAT IS A FLOOR SAYS SO IN THE VALUE, not in a footnote. An
            * exact-looking percentage that is really a lower bound is the same
            * class of mistake as a total that hides what it left out. */}
          <div className="fin-metric" style={{ fontSize: 12.5, color: "var(--muted)" }}>
            <b style={{ color: "var(--fg)" }} data-testid="fin-rate">
              {rateText(billing.collectionRate, billing.amountsComplete, t, t(NOT_DETERMINED))}
            </b> {t("of expected collected")}
            {!billing.amountsComplete && (
              <div data-testid="fin-rate-basis" style={{ ...financeNoteStyle, marginTop: 2 }}>{t(RATE_BASIS)}</div>
            )}
          </div>
        </div>

        {/* Why the month is incomplete, once, under the figures it qualifies. */}
        <IncompleteNotes scope={billing} style={{ marginBottom: 16 }} />

        {/* THE ONE PLACE THE MONTH'S GAP IS EXPLAINED. Everything above this line
          * counts every bill the month holds; every list below names only
          * students who still exist. Where those two disagree, the difference is
          * stated here, once, beside the totals it is about — muted, inert, and
          * in the teacher's vocabulary rather than ours. Never rendered at zero. */}
        {billing.hiddenRecords > 0 && (
          <div data-testid="fin-historical-note" style={{ ...financeNoteStyle, marginBottom: 16 }}>
            {historicalNote(billing.hiddenRecords, t)}
          </div>
        )}

        {/* ---- Four tiles. `.ov-grid` collapses 4 -> 3 -> 2 with the app's own
          * breakpoints rather than the comp's unguarded repeat(4,1fr). */}
        <div className="ov-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: 12 }}>
          <Tile dot="var(--green)" label={t("Paid students")} value={String(billing.counts.paid)} />
          <Tile dot="var(--amber)" label={t("Partially paid")} value={String(billing.counts.partiallyPaid)} />
          <Tile dot="var(--accent)" label={t("Unpaid students")} value={String(billing.counts.unpaid)} />

          <LessonRevenueTile total={revenue.total} />
        </div>
      </div>

      {/* ---- Outstanding students + top performing classes ---- */}
      <div className="main-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: "var(--gap)", alignItems: "start", marginBottom: "var(--gap)" }}>
        <div style={{ ...cardStyle, padding: "18px 20px 12px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
            <div>
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t("Outstanding students")}</div>
              <div style={{ fontSize: 12.5, color: "var(--muted)" }}>{t("Who still owes tuition")}</div>
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, padding: "3px 10px", borderRadius: 99, background: "var(--accent-soft)", color: "var(--accent)" }}>
              {billing.outstandingStudents.length}
            </span>
          </div>

          {billing.outstandingStudents.length === 0 ? (
            <div style={{ padding: "30px 8px", textAlign: "center", borderTop: "1px solid var(--border-2)" }}>
              <div style={{ minWidth: 44, width: 44, height: 44, borderRadius: 12, background: "var(--green-soft)", color: "var(--green)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{t("Everyone has paid")}</div>
              <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                {t("No outstanding tuition for")} {monthLabel}.
              </div>
            </div>
          ) : (
            /* AN ACTIONABLE LIST, AND ONLY THAT. Every row is a student who
             * exists and who a teacher can go and ask for money. Nothing is
             * appended to it — no count of records it could not show, no
             * historical sentence, and above all nothing shaped like a control
             * that would reveal more people. The month's gap is explained once,
             * up in the money summary, where it is about a total.
             *
             * The three parts are already in DOM order — identity, secondary
             * metadata, amount — which is what lets the <=620px block restack
             * them without a second rendering of this list. */
            <div className="fin-out-list" style={{ display: "flex", flexDirection: "column" }}>
              {billing.outstandingStudents.map((s) => (
                <div key={s.billId} className="fin-out-row" style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 0", borderTop: "1px solid var(--border-2)" }}>
                  <span style={{ minWidth: 32, width: 32, height: 32, borderRadius: "50%", background: s.avatarColor, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 600 }}>
                    {s.initials}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="fin-out-name" style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.studentName}</div>
                    <div className="fin-out-meta" style={{ fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {s.className} · {fmt.monthLabel(s.month)}
                    </div>
                    {/* Informational and never blocking. PROJECT_RULES requires
                      * Finance to say so where a student who owes money has no
                      * parent to talk to about it. */}
                    {!s.parentLinked && (
                      <div data-testid="fin-no-parent" className="fin-out-parent" style={{ fontSize: 11, color: "var(--muted-2)", marginTop: 1 }}>
                        {t("No linked parent")}
                      </div>
                    )}
                  </div>
                  <div className="fin-out-amount" style={{ textAlign: "right", flex: "none", fontSize: 13, fontWeight: 600, fontFamily: "'Geist Mono',monospace", color: "var(--accent)" }}>
                    {money(s.amount, fmt, notDetermined)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Top performing classes */}
        <div style={{ ...cardStyle, padding: "18px 20px 12px", minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t("Top performing classes")}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", marginBottom: 6 }}>
            {t("Highest-value classes by collected revenue")}
          </div>
          {ranked.length === 0 && (
            <div style={{ padding: "26px 0", textAlign: "center", fontSize: 13, color: "var(--muted)", borderTop: "1px solid var(--border-2)" }}>
              {t("No billing records for")} {monthLabel}.
            </div>
          )}
          {/* A RANKING CARD, AND NOTHING ELSE. No historical sentence is added
            * here: the metric is "highest-value classes by collected revenue",
            * and a class's collected total needs no reconciliation against a
            * list of names because this card never lists names. Explanatory
            * clutter on a card that reads correctly without it is clutter.
            *
            * The `.fin-tpc-*` hooks carry the <=620px restack: rank, dot and
            * name keep the first line, and the amount takes a full-width line of
            * its own under them with the label the desktop column header would
            * otherwise have supplied. */}
          {ranked.map((c, i) => (
            <div key={c.classId} className="fin-tpc-row" style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 0", borderTop: "1px solid var(--border-2)" }}>
              <span style={{ minWidth: 26, width: 26, height: 26, borderRadius: 8, background: "var(--card-2)", color: "var(--muted)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, fontWeight: 600 }}>{i + 1}</span>
              <span style={{ minWidth: 8, width: 8, height: 8, borderRadius: "50%", background: c.classColor }} />
              <div className="fin-tpc-main" style={{ minWidth: 0, flex: 1 }}>
                <div className="fin-tpc-name" style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.className}</div>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>
                  {c.counts.total} {t("students")} · {rateText(c.collectionRate, c.amountsComplete, t, t(NOT_DETERMINED))} {t("collected")}
                </div>
              </div>
              {/* A CLASS WITH AN INCOMPLETE AMOUNT IS RANKED, NOT EXILED. It
                * used to be dropped out of the ranking entirely and listed
                * below it with `No data`, which said a class that had provably
                * collected 700,000đ had no figure at all. It is now placed on
                * the money it can prove — a FLOOR — and the row says so rather
                * than presenting a floor as a total. */}
              <div className="fin-tpc-amount" style={{ fontSize: 12.5, fontWeight: 600, fontFamily: "'Geist Mono',monospace", color: "var(--green)", flex: "none" }}>
                <span className="fin-tpc-label" style={{ display: "none" }}>{t("Collected")}</span>
                {!c.amountsComplete && <span data-testid="fin-at-least" style={{ fontWeight: 500, color: "var(--muted-2)" }}>≥ </span>}
                {fmt.vnd(c.knownCollected)}
              </div>
            </div>
          ))}
          {/* THERE IS NO SECOND LIST ANY MORE. A class used to fall out of the
            * ranking entirely if any of its bills lacked a recorded amount, and
            * was listed under it with a dash for a rank. Every class now has a
            * collected figure it can prove, so every class is placed; the ones
            * whose figure is a floor are marked in the ranking rather than
            * removed from it. */}
        </div>
      </div>

      {/* ---- Revenue by class, expandable ---- */}
      <div style={{ ...cardStyle, padding: "18px 20px 8px" }}>
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t("Revenue by class")}</div>
          <div style={{ fontSize: 12.5, color: "var(--muted)" }}>
            {t("Sorted by outstanding balance — classes that still owe appear first. Click a row for student detail.")}
          </div>
        </div>

        {byOutstanding.length === 0 && (
          <div style={{ padding: "26px 0", textAlign: "center", fontSize: 13, color: "var(--muted)", borderTop: "1px solid var(--border-2)" }}>
            {t("No billing records for")} {monthLabel}.
          </div>
        )}

        {byOutstanding.map((c) => {
          const open = expanded === c.classId;
          const paidW = barWidth(c.counts.paid, c.counts.total);
          const partialW = barWidth(c.counts.partiallyPaid, c.counts.total);
          const unpaidW = barWidth(c.counts.unpaid, c.counts.total);
          return (
            <div key={c.classId} style={{ borderTop: "1px solid var(--border-2)" }}>
              {/* THE COLLAPSED SUMMARY NO LONGER CARRIES "+N more". A count of
                * records the class holds but cannot list, appended to a run of
                * status counts, read as a fourth status; and it sat on a row
                * whose whole affordance is "press me to see the students",
                * promising exactly the disclosure that cannot happen. The fact
                * moves into the expanded detail, as a sentence, beside the rows
                * it is reconciling against.
                *
                * `.fin-class-*` carry the <=620px restack. The dense part of
                * this row on a phone is the two 88px money columns beside a
                * flexible name; below the breakpoint the name takes the first
                * line and the two amounts share the second. */}
              <button
                onClick={() => setExpanded(open ? null : c.classId)}
                aria-expanded={open}
                className="btn-ghost fin-class-row"
                style={{
                  width: "100%", display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap",
                  padding: "14px 0", border: "none", background: "transparent",
                  color: "var(--fg)", font: "inherit", textAlign: "left", cursor: "pointer",
                }}
              >
                <span style={{ minWidth: 8, width: 8, height: 8, borderRadius: "50%", background: c.classColor, marginTop: 6 }} />
                <span className="fin-class-main" style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="fin-class-name" style={{ minWidth: 0, flex: 1, fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.className}</span>
                    {/* Mobile only, and decorative: `aria-expanded` on the button
                      * is what actually states the accordion's state, at every
                      * width. On a phone there is no hover and no cursor to
                      * reveal that this row opens, so the affordance is drawn. */}
                    <span className="fin-class-chev" aria-hidden="true" style={{ display: "none", flex: "none", color: "var(--muted-2)", transform: open ? "rotate(180deg)" : "none", transition: "transform .15s ease" }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
                    </span>
                  </span>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)", marginTop: 4 }}>
                    {c.counts.paid} {t("paid")} · {c.counts.partiallyPaid} {t("partial")} · {c.counts.unpaid} {t("unpaid")}
                  </span>
                  <span style={{ display: "flex", height: 8, borderRadius: 99, overflow: "hidden", background: "var(--card-2)", marginTop: 8, maxWidth: 420 }}>
                    {paidW && <span style={{ height: "100%", background: "var(--green)", width: paidW }} />}
                    {partialW && <span style={{ height: "100%", background: "var(--amber)", width: partialW }} />}
                    {unpaidW && <span style={{ height: "100%", background: "var(--accent)", width: unpaidW }} />}
                  </span>
                </span>
                {/* Both figures are the class's own confirmed money, and both
                  * carry the same floor marker when one of its bills has no
                  * recorded amount — the class's collected is at least this and
                  * its outstanding is at least this, and neither is a total. */}
                <span className="fin-class-amt fin-class-collected" style={{ textAlign: "right", minWidth: 88 }}>
                  <span style={{ display: "block", fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>{t("Collected")}</span>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600, fontFamily: "'Geist Mono',monospace", marginTop: 3, color: "var(--green)" }}>
                    {!c.amountsComplete && <span style={{ fontWeight: 500, color: "var(--muted-2)" }}>≥ </span>}
                    {fmt.vnd(c.knownCollected)}
                  </span>
                </span>
                <span className="fin-class-amt fin-class-outstanding" style={{ textAlign: "right", minWidth: 88 }}>
                  <span style={{ display: "block", fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>{t("Outstanding")}</span>
                  <span style={{ display: "block", fontSize: 13, fontWeight: 600, fontFamily: "'Geist Mono',monospace", marginTop: 3, color: "var(--accent)" }}>
                    {!c.amountsComplete && <span style={{ fontWeight: 500, color: "var(--muted-2)" }}>≥ </span>}
                    {fmt.vnd(c.knownOutstanding)}
                  </span>
                </span>
              </button>

              {open && <ClassStudentGrid rows={c.rows} hidden={c.hiddenRecords} scope={c} />}
            </div>
          );
        })}
      </div>
    </>
  );
}

/* THE LESSON-REVENUE TILE. Dashed, square dot, its own caption — the comp's own
 * way of saying this one number is not a bill. It is the ONLY value on this tab
 * that comes from `revenue`, and it is a component rather than inline markup
 * because it now renders in two places: inside the four-tile grid, and on its
 * own when the month has no bills to build that grid from. One definition, so
 * the two can never drift into two slightly different tiles. */
function LessonRevenueTile({ total }: { total: number }) {
  const { t, fmt } = useSettings();
  return (
    <div data-testid="fin-lesson-revenue" style={{ border: "1px dashed var(--border-2)", borderRadius: 11, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ minWidth: 9, width: 9, height: 9, borderRadius: 2, background: "var(--sky)" }} />
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("Lesson revenue")}</span>
      </div>
      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 8, fontFamily: "'Geist Mono',monospace", overflow: "hidden", textOverflow: "ellipsis" }}>
        {fmt.vnd(total)}
      </div>
      <div style={{ fontSize: 10, color: "var(--muted-2)", marginTop: 2 }}>
        {t("completed lessons · informational")}
      </div>
    </div>
  );
}

function Tile({ dot, label, value }: { dot: string; label: string; value: string }) {
  return (
    <div style={{ border: "1px solid var(--border-2)", borderRadius: 11, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span style={{ minWidth: 9, width: 9, height: 9, borderRadius: "50%", background: dot }} />
        <span style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      </div>
      <div style={{ fontSize: 22, fontWeight: 600, marginTop: 6 }}>{value}</div>
    </div>
  );
}

/* The comp's six-column per-student grid.
 *
 * THE COMP DRAWS THIS UNPROTECTED — six tracks including four right-aligned
 * money columns and a status badge, with no `min-width` and no scroll container
 * — which Gate 1 identified as the screen's worst overflow risk: at 375px each
 * track would be about 55px. It is wrapped here in the SAME `overflow-x:auto` +
 * `min-width` container the comp itself uses for its Payments table, so the
 * scrolling is local to the grid and the page never exceeds the viewport. The
 * layout, the column set and the order are unchanged. */
function ClassStudentGrid({ rows, hidden, scope }: {
  rows: FinanceMonthPayload["billing"]["perClass"][number]["rows"];
  hidden: number;
  scope: { unknownLiveAmountBills: number; unknownHistoricalAmountBills: number };
}) {
  const { t, fmt } = useSettings();
  const notRecorded = t(NOT_RECORDED);
  const notDetermined = t(NOT_DETERMINED);
  const cols = "minmax(0,1.5fr) 1fr 1fr 1fr 1fr 1fr";

  return (
    <div style={{ paddingBottom: 14 }}>
      <div className="fin-scroll" style={{ overflowX: "auto", overflowY: "hidden", border: "1px solid var(--border-2)", borderRadius: 10 }}>
        <div style={{ minWidth: 640 }}>
          <div style={{ display: "grid", gridTemplateColumns: cols, gap: 8, padding: "9px 14px", background: "var(--card-2)", fontSize: 10.5, fontWeight: 600, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".04em" }}>
            <span>{t("Student")}</span>
            <span style={{ textAlign: "right" }}>{t("Monthly fee")}</span>
            <span style={{ textAlign: "right" }}>{t("Paid")}</span>
            <span style={{ textAlign: "right" }}>{t("Remaining")}</span>
            <span>{t("Status")}</span>
            <span style={{ textAlign: "right" }}>{t("Paid date")}</span>
          </div>
          {rows.map((r) => (
            <div key={r.billId} style={{ display: "grid", gridTemplateColumns: cols, gap: 8, alignItems: "center", padding: "10px 14px", borderTop: "1px solid var(--border-2)" }}>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: "block", fontSize: 12.5, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.studentName}</span>
                {!r.parentLinked && (
                  <span data-testid="fin-no-parent" style={{ display: "block", fontSize: 10.5, color: "var(--muted-2)" }}>{t("No linked parent")}</span>
                )}
              </span>
              <span style={{ fontSize: 12, fontFamily: "'Geist Mono',monospace", textAlign: "right" }}>{fmt.vnd(r.fee)}</span>
              {/* ONE BILL, TWO DIFFERENT MISSING FACTS. Nobody wrote down what
                * was paid, and so what remains cannot be worked out. A single
                * shared label would have flattened a cause into a consequence;
                * these say which is which, and neither is 0đ or half the fee. */}
              <span style={{ fontSize: 12, fontFamily: "'Geist Mono',monospace", textAlign: "right", color: r.collected === null ? "var(--muted-2)" : "var(--green)" }}>
                {money(r.collected, fmt, notRecorded)}
              </span>
              <span style={{ fontSize: 12, fontFamily: "'Geist Mono',monospace", textAlign: "right", color: r.outstanding === null ? "var(--muted-2)" : "var(--accent)" }}>
                {money(r.outstanding, fmt, notDetermined)}
              </span>
              <span><span style={statusBadgeStyle(r.status)}>{t(STATUS_LABEL[r.status] ?? r.status)}</span></span>
              <span style={{ fontSize: 11.5, color: "var(--muted)", textAlign: "right" }}>
                {r.paidDate ? fmt.dateLabel(r.paidDate) : "—"}
              </span>
            </div>
          ))}
          {rows.length === 0 && (
            <div style={{ padding: "18px 14px", fontSize: 12.5, color: "var(--muted)", borderTop: "1px solid var(--border-2)" }}>
              {t("No billing records for")} {t("this month")}.
            </div>
          )}
        </div>
      </div>
      {/* THE ONE PLACE A CLASS'S GAP IS EXPLAINED. The rows above are every
        * student of this class who still exists; the class's Collected and
        * Outstanding figures on the row that opened them count more bills than
        * that. This sentence is the difference, stated where both numbers are on
        * screen at once — and it is a caption, not a control: no handler, no
        * cursor, no underline, and no way to ask it who those students were. */}
      {hidden > 0 && (
        <div data-testid="fin-historical-note" style={{ ...financeNoteStyle, padding: "8px 2px 0" }}>
          {historicalNote(hidden, t)}
        </div>
      )}

      {/* AND WHY THIS CLASS'S OWN FIGURES ARE FLOORS. Two different gaps can
        * affect one class — records with no student, and records with no
        * recorded amount — and the second splits again by whether the teacher
        * could still go and settle it. Each is its own muted, inert caption;
        * none is a warning. */}
      <IncompleteNotes scope={scope} style={{ padding: "8px 2px 0" }} />
    </div>
  );
}

export { statusColor };
