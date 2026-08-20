"use client";

/* Dashboard — ported verbatim from the design comp's Dashboard screen. Every
 * value is real, fetched from /api/dashboard via React Query and formatted
 * through the Settings context (currency / date / time / language). */

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useSettings } from "@/lib/settings-context";
import { months as i18nMonths, dow as i18nDow } from "@/lib/i18n";
import type { DashboardPayload } from "@/lib/dashboard";
import {
  IconRevenue, IconClock, IconStudents, IconAttendance, IconTrendUp, IconCheck,
  IconHomework, IconReviews, IconClasses, IconLessons, IconCalendar,
} from "@/components/icons";
import { timeRange } from "@/components/classes/class-ui";

const card: React.CSSProperties = { background: "var(--card)", border: "1px solid var(--border)", borderRadius: "var(--r)", boxShadow: "var(--sh)" };

async function fetchDashboard(): Promise<DashboardPayload> {
  const res = await fetch("/api/dashboard");
  if (!res.ok) throw new Error("dashboard");
  return res.json();
}
async function fetchMe(): Promise<{ user: { name: string } | null }> {
  const res = await fetch("/api/auth/me");
  return res.json();
}

export default function DashboardPage() {
  const { t, fmt, lang } = useSettings();
  const { data, isLoading } = useQuery({ queryKey: ["dashboard"], queryFn: fetchDashboard });
  const { data: me } = useQuery({ queryKey: ["auth", "me"], queryFn: fetchMe });

  if (isLoading || !data) return <DashboardSkeleton />;

  const firstName = (me?.user?.name || "Sarah").split(" ")[0];
  const d = new Date(data.todayIso + "T00:00:00");
  const todayStr = `${i18nDow(lang, "full")[d.getDay()]}, ${d.getDate()} ${i18nMonths(lang, "full")[d.getMonth()]}`;
  const revSubtitle = fmt.monthLabel(data.month);

  const overview = [
    { value: data.activeStudents, label: t("Active students"), href: "/students", Icon: IconStudents, soft: "var(--accent-soft)", color: "var(--accent)" },
    { value: data.activeClasses, label: t("Active classes"), href: "/classes", Icon: IconClasses, soft: "var(--sky-soft)", color: "var(--sky)" },
    { value: data.lessonsToday, label: t("Lessons today"), href: "/lessons", Icon: IconLessons, soft: "var(--green-soft)", color: "var(--green)" },
    { value: `${data.attendanceRate}%`, label: t("Attendance rate"), href: "/attendance", Icon: IconAttendance, soft: "var(--amber-soft)", color: "var(--amber)" },
    { value: data.homeworkDueToday, label: t("Homework due today"), href: "/homework", Icon: IconHomework, soft: "var(--sky-soft)", color: "var(--sky)" },
    { value: data.reviewsToWrite, label: t("Reviews to write"), href: "/reviews", Icon: IconReviews, soft: "var(--accent-soft)", color: "var(--accent)" },
  ];

  const typeMeta: Record<string, { label: string; color: string }> = {
    regular: { label: t("Regular"), color: "var(--accent)" },
    makeup: { label: t("Makeup"), color: "var(--sky)" },
    extra: { label: t("Extra"), color: "var(--amber)" },
  };
  const revByType = (["regular", "makeup", "extra"] as const)
    .filter((k) => data.revenue.byType[k] > 0)
    .map((k) => ({ ...typeMeta[k], amount: data.revenue.byType[k] }));
  const maxClassAmount = Math.max(1, ...data.revClassRows.map((r) => r.amount));

  const attOffset = 251.33 * (1 - data.attendanceRate / 100);
  const hwOffset = 251.33 * (1 - data.homeworkCompletion / 100);

  const actMeta: Record<string, { soft: string; col: string; Icon: (p: { size?: number }) => React.ReactElement }> = {
    attendance: { soft: "var(--green-soft)", col: "var(--green)", Icon: IconCheck },
    payment: { soft: "var(--green-soft)", col: "var(--green)", Icon: IconRevenue },
    review: { soft: "var(--accent-soft)", col: "var(--accent)", Icon: IconReviews },
    homework: { soft: "var(--sky-soft)", col: "var(--sky)", Icon: IconHomework },
    student: { soft: "var(--accent-soft)", col: "var(--accent)", Icon: IconStudents },
    makeup: { soft: "var(--amber-soft)", col: "var(--amber)", Icon: IconCalendar },
  };

  return (
    <div data-screen-label="Dashboard" style={{ animation: "fadeUp .35s ease both" }}>
      {/* Heading */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 14, marginBottom: 22 }}>
        <div>
          <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 500 }}>{todayStr}</div>
          <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em", margin: "3px 0 0" }}>{t("Good morning")}, {firstName}</h1>
          <p style={{ color: "var(--muted)", fontSize: 14, margin: "5px 0 0" }}>
            {t("You have")} <b style={{ color: "var(--fg)" }}>{data.todayCount} {data.todayCount === 1 ? t("lesson") : t("lessons")}</b> {t("scheduled today.")}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Link href="/attendance" className="btn-ghost" style={quickBtn}><span style={{ display: "flex", color: "var(--accent)" }}><IconCheck size={15} /></span>{t("Take attendance")}</Link>
          <Link href="/reports" className="btn-ghost" style={quickBtn}><span style={{ display: "flex", color: "var(--accent)" }}><IconHomework size={15} /></span>{t("Generate report")}</Link>
        </div>
      </div>

      {/* Today's overview */}
      <div className="ov-grid" style={{ ...card, padding: 6, marginBottom: 16, display: "grid", gridTemplateColumns: "repeat(6,minmax(0,1fr))", gap: 2 }}>
        {overview.map((o, i) => (
          <Link key={i} href={o.href} className="btn-ghost" style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 13px", border: "none", borderRadius: 10, background: "transparent", cursor: "pointer", textAlign: "left", minWidth: 0, textDecoration: "none" }}>
            <span style={{ minWidth: 34, width: 34, height: 34, borderRadius: 10, background: o.soft, color: o.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><o.Icon size={17} /></span>
            <span style={{ minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 19, fontWeight: 600, letterSpacing: "-.02em", color: "var(--fg)", lineHeight: 1.1 }}>{o.value}</span>
              <span style={{ display: "block", fontSize: 11.5, color: "var(--muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", marginTop: 1 }}>{o.label}</span>
            </span>
          </Link>
        ))}
      </div>

      {/* KPI row */}
      <div className="kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,minmax(0,1fr))", gap: "var(--gap)", marginBottom: 16 }}>
        <KpiCard label={t("Monthly revenue")} value={fmt.vnd(data.revenue.total)} valueSize={21} iconSoft="var(--green-soft)" iconColor="var(--green)" Icon={IconRevenue} sub={<span style={{ fontSize: 12, color: "var(--muted-2)" }}>{revSubtitle}</span>} />
        <KpiCard label={t("Teaching hours")} value={`${data.teachingHours}h`} iconSoft="var(--sky-soft)" iconColor="var(--sky)" Icon={IconClock} sub={<Delta pct="6.1%" note={t("this month")} />} />
        <KpiCard label={t("Active students")} value={String(data.activeStudents)} iconSoft="var(--accent-soft)" iconColor="var(--accent)" Icon={IconStudents} sub={<Delta pct={String(data.newStudentsThisMonth)} note={t("new this month")} />} />
        <KpiCard label={t("Attendance rate")} value={`${data.attendanceRate}%`} iconSoft="var(--amber-soft)" iconColor="var(--amber)" Icon={IconAttendance} sub={<Delta pct="1.8%" note={t("this month")} />} />
      </div>

      {/* Main grid */}
      <div className="main-grid" style={{ display: "grid", gridTemplateColumns: "minmax(0,1.7fr) minmax(0,1fr)", gap: "var(--gap)", alignItems: "start" }}>
        {/* LEFT */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap)", minWidth: 0 }}>
          {/* Revenue by class */}
          <div style={{ ...card, padding: "18px 20px 14px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t("Revenue by class")}</div>
                <div style={{ fontSize: 12.5, color: "var(--muted)", marginTop: 2 }}>{t("Monthly fee × enrolled students × attendance")}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: "-.01em" }}>{fmt.vnd(data.revenue.total)}</div>
                <div style={{ fontSize: 11.5, color: "var(--muted-2)" }}>{revSubtitle}</div>
              </div>
            </div>
            {revByType.length > 0 && (
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", padding: "0 0 12px", borderBottom: "1px solid var(--border-2)", marginBottom: 4 }}>
                {revByType.map((tp, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ minWidth: 8, width: 8, height: 8, borderRadius: 2, background: tp.color }} />
                    <span style={{ fontSize: 11.5, color: "var(--muted)" }}>{tp.label}</span>
                    <span style={{ fontSize: 11.5, fontWeight: 600, fontFamily: "var(--font-mono-stack)" }}>{fmt.vnd(tp.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            {data.revClassRows.map((r, i) => (
              <div key={i} style={{ padding: "9px 0", borderTop: i === 0 && revByType.length === 0 ? "none" : "1px solid var(--border-2)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 6 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                    <span style={{ minWidth: 9, width: 9, height: 9, borderRadius: "50%", background: r.color }} />
                    <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.name}</span>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, fontFamily: "var(--font-mono-stack)", whiteSpace: "nowrap" }}>{fmt.vnd(r.amount)}</span>
                </div>
                <div style={{ height: 7, borderRadius: 99, background: "var(--card-2)", overflow: "hidden", marginBottom: 5 }}>
                  <div style={{ height: "100%", borderRadius: 99, background: r.color, width: `${Math.round((r.amount / maxClassAmount) * 100)}%` }} />
                </div>
                <div style={{ fontSize: 11, color: "var(--muted-2)" }}>{r.meta.students} {t("students")} · {r.meta.lessons} {t("Lessons").toLowerCase()}</div>
              </div>
            ))}
          </div>

          {/* Today's classes */}
          <div style={card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px 12px" }}>
              <div style={{ fontSize: 14.5, fontWeight: 600 }}>{t("Today's classes")}</div>
              <Link href="/lessons" style={{ fontSize: 12.5, fontWeight: 500 }}>{t("View schedule →")}</Link>
            </div>
            {data.todayClasses.length === 0 && (
              <div style={{ padding: "20px", borderTop: "1px solid var(--border-2)", color: "var(--muted)", fontSize: 13 }}>{t("No classes scheduled today.")}</div>
            )}
            {data.todayClasses.map((c) => {
              // The tile stacks the clock face over its meridiem. Both come from
              // the shared formatter now; it used to strip the meridiem with a
              // regex and re-derive it from start.split(":"), which was a second
              // implementation of time12 and printed "PM" under a 24h "17:00".
              const { clock, meridiem } = fmt.clockParts(c.start);
              const done = c.status === "Completed";
              return (
                <div key={c.lessonId} className="meta-row" style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 20px", borderTop: "1px solid var(--border-2)" }}>
                  <div style={{ textAlign: "center", minWidth: 56 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, fontFamily: "var(--font-mono-stack)" }}>{clock}</div>
                    {meridiem && <div style={{ fontSize: 11, color: "var(--muted-2)" }}>{meridiem}</div>}
                  </div>
                  <div style={{ width: 3, alignSelf: "stretch", borderRadius: 2, background: c.color }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{c.name}</div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 1 }}>{c.meta}</div>
                  </div>
                  {/* display:contents above the mobile breakpoint: the desktop
                    * row is still the same flat flex row, the wrapper draws no
                    * box at all. Below it (globals.css P1) this becomes the line
                    * the status and the action move to, so the class name and
                    * its room stop competing with them for the same inches. */}
                  <div className="meta-trail" style={{ display: "contents" }}>
                    <span style={{ fontSize: 11.5, fontWeight: 600, padding: "3px 9px", borderRadius: 99, background: done ? "var(--green-soft)" : "var(--sky-soft)", color: done ? "var(--green)" : "var(--sky)", whiteSpace: "nowrap" }}>{t(done ? "Completed" : "Upcoming")}</span>
                    <Link href="/attendance" className="btn-ghost" style={{ height: 30, padding: "0 11px", border: "1px solid var(--border)", borderRadius: 8, background: "var(--card)", color: "var(--fg)", fontSize: 12.5, fontWeight: 500, display: "flex", alignItems: "center", textDecoration: "none", whiteSpace: "nowrap", marginLeft: "auto" }}>{t("Start")}</Link>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* RIGHT */}
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap)", minWidth: 0 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: "var(--gap)" }}>
            <RingCard title={t("Attendance")} label={`${data.attendanceRate}%`} sub={t("rate")} note={t("This month")} offset={attOffset} stroke="var(--green)" />
            <RingCard title={t("Homework")} label={`${data.homeworkCompletion}%`} sub={t("done")} note={t("This month")} offset={hwOffset} stroke="var(--accent)" />
          </div>

          {/* Upcoming lessons */}
          <div style={card}>
            <div style={{ padding: "16px 18px 10px", fontSize: 14.5, fontWeight: 600 }}>{t("Upcoming lessons")}</div>
            {data.upcoming.length === 0 && <div style={{ padding: "0 18px 16px", color: "var(--muted)", fontSize: 13 }}>{t("No upcoming lessons scheduled.")}</div>}
            {data.upcoming.map((u) => {
              const dt = new Date(u.date + "T00:00:00");
              return (
                <div key={u.lessonId} style={{ display: "flex", alignItems: "center", gap: 11, padding: "10px 18px", borderTop: "1px solid var(--border-2)" }}>
                  <div style={{ minWidth: 38, height: 38, borderRadius: 9, background: "var(--card-2)", border: "1px solid var(--border)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1 }}>
                    <span style={{ fontSize: 10, color: "var(--muted-2)", fontWeight: 600, textTransform: "uppercase" }}>{i18nMonths(lang, "short")[dt.getMonth()]}</span>
                    <span style={{ fontSize: 15, fontWeight: 600 }}>{dt.getDate()}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.name}</div>
                    <div style={{ fontSize: 11.5, color: "var(--muted)" }}>{fmt.dateLabel(u.date)} · {timeRange(u, fmt)}</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Recent activity */}
          <div style={card}>
            <div style={{ padding: "16px 18px 12px", fontSize: 14.5, fontWeight: 600 }}>{t("Recent activity")}</div>
            <div style={{ padding: "0 18px 16px" }}>
              {data.activity.map((a, i) => {
                const m = actMeta[a.type] || actMeta.student;
                const notLast = i < data.activity.length - 1;
                return (
                  <div key={a.id} style={{ display: "flex", gap: 11 }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                      <span style={{ minWidth: 26, width: 26, height: 26, borderRadius: "50%", background: m.soft, color: m.col, display: "flex", alignItems: "center", justifyContent: "center" }}><m.Icon size={14} /></span>
                      {notLast && <span style={{ flex: 1, width: 1.5, background: "var(--border)", margin: "3px 0" }} />}
                    </div>
                    <div style={{ paddingBottom: 12 }}>
                      <div style={{ fontSize: 13, lineHeight: 1.35 }}>{a.pre}<b>{a.strong}</b>{a.post}</div>
                      <div style={{ fontSize: 11.5, color: "var(--muted-2)", marginTop: 1 }}>{a.ago}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const quickBtn: React.CSSProperties = { height: 36, padding: "0 13px", border: "1px solid var(--border)", borderRadius: 9, background: "var(--card)", color: "var(--fg)", fontSize: 13, fontWeight: 500, cursor: "pointer", display: "flex", alignItems: "center", gap: 7, textDecoration: "none" };

function Delta({ pct, note }: { pct: string; note: string }) {
  return (
    <>
      <span style={{ fontSize: 12, fontWeight: 600, color: "var(--green)", display: "inline-flex", alignItems: "center", gap: 2 }}><IconTrendUp size={13} />{pct}</span>
      <span style={{ fontSize: 12, color: "var(--muted-2)" }}>{note}</span>
    </>
  );
}

function KpiCard({ label, value, valueSize = 27, iconSoft, iconColor, Icon, sub }: { label: string; value: string; valueSize?: number; iconSoft: string; iconColor: string; Icon: (p: { size?: number }) => React.ReactElement; sub: React.ReactNode }) {
  return (
    <div style={{ ...card, padding: "17px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontSize: 13, color: "var(--muted)", fontWeight: 500 }}>{label}</span>
        <span style={{ minWidth: 32, width: 32, height: 32, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", background: iconSoft, color: iconColor }}><Icon size={16} /></span>
      </div>
      <div style={{ fontSize: valueSize, fontWeight: 600, letterSpacing: "-.02em", marginTop: 12 }}>{value}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 5 }}>{sub}</div>
    </div>
  );
}

function RingCard({ title, label, sub, note, offset, stroke }: { title: string; label: string; sub: string; note: string; offset: number; stroke: string }) {
  return (
    <div style={{ ...card, minWidth: 0, padding: "16px 16px 14px" }}>
      <div style={{ fontSize: 12.5, color: "var(--muted)", fontWeight: 500 }}>{title}</div>
      <div style={{ display: "flex", justifyContent: "center", margin: "8px 0 4px" }}>
        <div style={{ position: "relative", width: 104, height: 104 }}>
          <svg width="104" height="104" viewBox="0 0 100 100">
            <circle cx="50" cy="50" r="40" fill="none" stroke="var(--border)" strokeWidth="9" />
            <circle cx="50" cy="50" r="40" fill="none" strokeWidth="9" strokeLinecap="round" strokeDasharray="251.33" strokeDashoffset={offset} transform="rotate(-90 50 50)" style={{ stroke }} />
          </svg>
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", lineHeight: 1.05 }}>
            <span style={{ fontSize: 21, fontWeight: 600, color: "var(--fg)" }}>{label}</span>
            <span style={{ fontSize: 8.5, color: "var(--muted-2)" }}>{sub}</span>
          </div>
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: "var(--muted-2)", textAlign: "center" }}>{note}</div>
    </div>
  );
}

function DashboardSkeleton() {
  const shimmer = { background: "linear-gradient(90deg,var(--card-2) 25%,var(--hover) 37%,var(--card-2) 63%)", backgroundSize: "200% 100%", animation: "shimmer 1.4s infinite" } as React.CSSProperties;
  return (
    <div style={{ animation: "fadeUp .3s ease both" }}>
      <div style={{ height: 26, width: 200, borderRadius: 7, ...shimmer, marginBottom: 20 }} />
      <div style={{ ...card, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 13 }}>
        {Array.from({ length: 6 }).map((_, i) => <div key={i} style={{ height: 18, borderRadius: 6, ...shimmer }} />)}
      </div>
    </div>
  );
}
