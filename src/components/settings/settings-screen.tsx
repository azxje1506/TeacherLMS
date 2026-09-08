"use client";

/* Settings — ported from the design comp's SETTINGS screen: the heading with its
 * subtitle, then the Appearance, Language & Region and Workspace cards, in a
 * 760px column.
 *
 * THERE IS NO NOTIFICATIONS CARD, and its absence is the contract rather than an
 * omission. The comp draws one, but the application has no notification source,
 * builder, model or bell menu, and the two reserved keys (`etlms.notifDismissed`,
 * `etlms.notifRead`) are read by nothing anywhere. A "Mark all read" acting on
 * data that does not exist is a promise the app cannot keep — the same reason the
 * header's search triggers stay inert rather than pretending. Notifications is
 * its own sprint (PROJECT_RULES, Settings).
 *
 * THIS PAGE OWNS NO PREFERENCE. Every control reads its selected state from
 * `useSettings()` and writes through that store's own setters; there is no
 * `useState` mirror of a preference here and no `localStorage` call, so the
 * header's theme toggle and the Theme control below cannot disagree — they are
 * the same value read twice, not two values kept in step. That also means there
 * is nothing to save: no Save button, no Apply button, no form.
 *
 * AND IT WRITES NOTHING TO THE SERVER. Preferences live in the browser that set
 * them. There is no Settings endpoint, no server action, no User document write
 * and no session change anywhere in this module — the identity below arrives as
 * two read-only strings from the server component that renders this one.
 *
 * CURRENCY IS A DISPLAY PREFERENCE. Choosing USD changes how `fmt.vnd` RENDERS
 * an amount and nothing else: tuition, fees, billing and every derived figure
 * stay integer VND in the database and in all arithmetic. Nothing here converts,
 * rewrites or reinterprets stored money.
 */

import { useSettings } from "@/lib/settings-context";
import { createFormat, EM } from "@/lib/format";
import { LANGS } from "@/lib/i18n";
import {
  ACCENTS, CURRENCIES, DATE_FORMATS, DENSITIES, NUMBER_FORMATS, SURFACES, THEMES, TIME_FORMATS,
  TODAY_ISO,
} from "@/lib/constants";
import {
  ACCENT_LABEL, DENSITY_LABEL, NUMBER_FORMAT_SAMPLE, SURFACE_LABEL, THEME_LABEL, TIME_FORMAT_LABEL,
  accentSwatchStyle, settingsSegmentStyle, type SettingsSegmentVariant,
} from "@/components/settings/settings-ui";

const cardTitle: React.CSSProperties = { fontSize: 15, fontWeight: 600, margin: "0 0 3px" };
const cardSub: React.CSSProperties = { color: "var(--muted)", fontSize: 12.5, margin: "0 0 16px" };
const groupLabel: React.CSSProperties = { fontSize: 12.5, fontWeight: 600, color: "var(--fg-2)", marginBottom: 7 };
const subLabel: React.CSSProperties = { fontSize: 12, fontWeight: 500, color: "var(--muted)", marginBottom: 7 };

/** One choice in a segmented row.
 *
 * A real `<button>`, so it is reachable and operable from a keyboard without
 * anything being added back; `aria-pressed` is what exposes the selection, the
 * mechanism the register's status segments and the review trend's window control
 * already use. */
function Segment({
  label, active, onClick, variant,
}: {
  label: string;
  /** `null` means NOT KNOWN YET — the browser store has not been read, so this
   * control may not claim to be either pressed or unpressed. It draws the
   * neutral face and omits `aria-pressed` entirely rather than asserting
   * `false`, which would give a screen reader a wrong answer for one render. */
  active: boolean | null;
  onClick: () => void;
  variant?: SettingsSegmentVariant;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active ?? undefined}
      className="ring"
      style={settingsSegmentStyle(active === true, variant)}
    >
      {label}
    </button>
  );
}

/** A row of segments.
 *
 * The row's layout — flex, wrapping and both of the comp's gaps (8 in the roomy
 * groups, 6 in the regional grid, via `tight`) — lives in `.set-seg-row`, not
 * here. A wrap rule stated inline is a wrap rule no narrower width could ever
 * change. `maxWidth` stays a prop because it is a cap the comp gives each group
 * individually, and a cap can only ever make a row narrower than its container,
 * never wider — so nothing has to override it. */
function SegmentRow({ children, tight = false, maxWidth }: { children: React.ReactNode; tight?: boolean; maxWidth?: number }) {
  return <div className={tight ? "set-seg-row tight" : "set-seg-row"} style={{ maxWidth }}>{children}</div>;
}

export function SettingsScreen({ account }: { account: { name: string; email: string } }) {
  const { hydrated, t, fmt, lang, setLang, appearance, setAppearance, regional, setRegional } = useSettings();

  /* WHAT A CONTROL MAY SAY, AND WHEN.
   *
   * For the one render before the browser store has been read, every value in
   * this component is a DEFAULT rather than the teacher's own — so a control that
   * painted `appearance.theme === "light"` as chosen would be stating something
   * it does not know, and visibly correcting itself a frame later. That
   * correction is Gate 6 defect C: the colours were always right (ThemeScript
   * sets them before first paint), but the SELECTION was drawn wrong first.
   *
   * `known` turns each boolean into "unknown" for exactly that render. Every
   * control below goes through it, so no selection can be claimed early and none
   * can be forgotten once the store is readable. */
  const known = (isSelected: boolean): boolean | null => (hydrated ? isSelected : null);

  return (
    <div data-screen-label="Settings" style={{ animation: "fadeUp .3s ease both", maxWidth: 760 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, letterSpacing: "-.02em", margin: "0 0 4px" }}>{t("Settings")}</h1>
      <p style={{ color: "var(--muted)", fontSize: 14, margin: "0 0 22px" }}>
        {t("Personalise your workspace. Preferences are saved to this device.")}
      </p>

      {/* ---------------------------------------------------------- Appearance */}
      <section className="set-card">
        <h2 style={cardTitle}>{t("Appearance")}</h2>
        <p style={cardSub}>{t("Theme, accent colour and layout density.")}</p>

        <div className="set-group">
          <div style={groupLabel}>{t("Theme")}</div>
          <SegmentRow maxWidth={260}>
            {THEMES.map((theme) => (
              <Segment
                key={theme}
                label={t(THEME_LABEL[theme])}
                active={known(appearance.theme === theme)}
                onClick={() => setAppearance({ theme })}
              />
            ))}
          </SegmentRow>
        </div>

        <div className="set-group">
          <div style={groupLabel}>{t("Accent colour")}</div>
          <div className="set-accent-grid">
            {ACCENTS.map((accent) => (
              <div key={accent} style={{ textAlign: "center" }}>
                {/* The swatch carries its own accent as a data attribute so the
                  * stylesheet can paint it; `data-sw-accent` rather than
                  * `data-accent` deliberately, so it cannot also re-bind the
                  * whole palette on this one element. */}
                <button
                  type="button"
                  className="ring set-sw"
                  data-sw-accent={accent}
                  aria-label={t(ACCENT_LABEL[accent])}
                  aria-pressed={known(appearance.accent === accent) ?? undefined}
                  onClick={() => setAppearance({ accent })}
                  style={accentSwatchStyle(known(appearance.accent === accent) === true)}
                />
                <div className="set-accent-label">{t(ACCENT_LABEL[accent])}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="set-pair-appearance">
          <div>
            <div style={groupLabel}>{t("Surface")}</div>
            <SegmentRow>
              {SURFACES.map((surface) => (
                <Segment
                  key={surface}
                  variant="dense"
                  label={t(SURFACE_LABEL[surface])}
                  active={known(appearance.surface === surface)}
                  onClick={() => setAppearance({ surface })}
                />
              ))}
            </SegmentRow>
          </div>
          <div>
            <div style={groupLabel}>{t("Density")}</div>
            <SegmentRow>
              {DENSITIES.map((spacing) => (
                <Segment
                  key={spacing}
                  variant="dense"
                  label={t(DENSITY_LABEL[spacing])}
                  active={known(appearance.spacing === spacing)}
                  onClick={() => setAppearance({ spacing })}
                />
              ))}
            </SegmentRow>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- Language & Region */}
      <section className="set-card">
        <h2 style={cardTitle}>{t("Language & Region")}</h2>
        <p style={cardSub}>{t("Interface language and regional formats for dates, time, currency and numbers.")}</p>

        <div className="set-group">
          <div style={{ ...groupLabel, marginBottom: 3 }}>{t("Interface language")}</div>
          <div style={{ fontSize: 11.5, color: "var(--muted)", marginBottom: 7 }}>{t("Applies immediately across the app.")}</div>
          <SegmentRow maxWidth={320}>
            {/* An endonym is never translated — "Tiếng Việt" reads the same in
              * either language, which is the point of offering it. LANGS is the
              * dictionary's own list, so this cannot offer a language the
              * translator does not know about. */}
            {LANGS.map(([code, endonym]) => (
              <Segment key={code} label={endonym} active={known(lang === code)} onClick={() => setLang(code)} />
            ))}
          </SegmentRow>
        </div>

        <div style={{ ...groupLabel, marginBottom: 10 }}>{t("Regional preferences")}</div>
        <div className="set-pair-regional">
          <div>
            <div style={subLabel}>{t("Date format")}</div>
            <SegmentRow tight>
              {DATE_FORMATS.map((df) => (
                <Segment
                  key={df}
                  variant="dense"
                  label={df}
                  active={known(regional.dateFormat === df)}
                  onClick={() => setRegional("dateFormat", df)}
                />
              ))}
            </SegmentRow>
          </div>
          <div>
            <div style={subLabel}>{t("Time format")}</div>
            <SegmentRow tight>
              {TIME_FORMATS.map((tf) => (
                <Segment
                  key={tf}
                  variant="dense"
                  label={t(TIME_FORMAT_LABEL[tf])}
                  active={known(regional.timeFormat === tf)}
                  onClick={() => setRegional("timeFormat", tf)}
                />
              ))}
            </SegmentRow>
          </div>
          <div>
            <div style={subLabel}>{t("Currency")}</div>
            <SegmentRow tight>
              {CURRENCIES.map((cur) => (
                <Segment
                  key={cur}
                  variant="dense"
                  label={cur}
                  active={known(regional.currency === cur)}
                  onClick={() => setRegional("currency", cur)}
                />
              ))}
            </SegmentRow>
          </div>
          <div>
            <div style={subLabel}>{t("Number format")}</div>
            <SegmentRow tight>
              {NUMBER_FORMATS.map((nf) => (
                <Segment
                  key={nf}
                  variant="dense"
                  /* The label IS the behaviour: the sample is rendered by the
                   * formatter this very option selects, so the button cannot
                   * advertise a grouping it does not produce. */
                  label={createFormat({ ...regional, numberFormat: nf }, lang).number(NUMBER_FORMAT_SAMPLE, 2)}
                  active={known(regional.numberFormat === nf)}
                  onClick={() => setRegional("numberFormat", nf)}
                />
              ))}
            </SegmentRow>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- Workspace */}
      {/* Informational only. Every value here is read: there is no input, no edit
        * control and no handler of any kind, because Sprint 11 changes no account
        * and writes no User document. */}
      <section className="set-card">
        <h2 style={{ fontSize: 15, fontWeight: 600, margin: "0 0 14px" }}>{t("Workspace")}</h2>
        <div className="set-pair-workspace">
          <Fact label={t("Account")} value={account.name ? `${account.name} · ${t("Teacher / Admin")}` : EM} />
          <Fact label={t("Email")} value={account.email || EM} />
          <Fact label={t("Currency")} value={regional.currency} />
          <Fact label={t("Today")} value={fmt.dateLabel(TODAY_ISO)} />
        </div>
      </section>
    </div>
  );
}

/** One read-only Workspace pair. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 11.5, color: "var(--muted-2)", marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13.5, fontWeight: 500 }}>{value}</div>
    </div>
  );
}
