"use client";

/* DateField — a native date input that has a visible empty state.
 *
 * WHY THIS EXISTS. `<input type="date">` does not support the `placeholder`
 * attribute, and what it draws while it holds no value belongs to the browser:
 * Chrome prints its own "mm/dd/yyyy", and mobile Safari prints nothing at all —
 * more so with the UA appearance switched off, which globals.css needs in order
 * to stop the control defining its own width. Gate 5 Phase 0 reported the
 * consequence: Due date looked like an empty box, and the only way to find out
 * what it wanted was to tap it.
 *
 * WHAT THIS IS NOT. It is not a date picker. There is no calendar here, no
 * parsing, no formatting and no value of its own. The native input underneath is
 * untouched and still does all of the work: it is the focusable control, it owns
 * the value, it opens the platform's own picker, and it hands the same
 * `yyyy-mm-dd` string to react-hook-form that it always did. Replacing reliable
 * native date selection with a custom component to solve a presentation problem
 * would have been a much larger change than the problem is.
 *
 * All this adds is a placeholder the browser refuses to draw, positioned over
 * the input, `pointer-events:none` so every tap still lands on the control.
 * globals.css (".date-field") hides the UA's own empty hint while the field is
 * unfocused so the two can never overlap, and hands it straight back on focus so
 * a keyboard user types against segments they can see.
 *
 * EMPTINESS IS THE FORM'S TO KNOW, not this component's. It is passed in rather
 * than tracked here, because the form already knows: a `reset()` — which every
 * drawer does when it opens for a different record — changes the value without
 * any event this component could observe, so local state would go stale exactly
 * when a teacher opened the drawer a second time.
 */

export function DateField({
  placeholder, empty, className = "ring", ...inputProps
}: React.ComponentProps<"input"> & {
  /** Guidance shown while the field has no value. Existing product copy. */
  placeholder: string;
  /** Whether the form currently holds no date for this field. */
  empty: boolean;
}) {
  /* The placeholder is a description of the control rather than its name — the
   * <label> already names it — so it is wired up with aria-describedby. A screen
   * reader user gets the same guidance a sighted one does, and it stops being
   * announced the moment there is a value to announce instead. */
  const describedBy = inputProps.id ? `${inputProps.id}-placeholder` : undefined;

  return (
    <div className="date-field" data-empty={empty ? "1" : "0"}>
      <input
        type="date"
        className={className}
        aria-describedby={empty ? describedBy : undefined}
        {...inputProps}
      />
      {empty && (
        <span id={describedBy} className="date-ph">
          {placeholder}
        </span>
      )}
    </div>
  );
}
