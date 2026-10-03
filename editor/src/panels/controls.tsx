import { useId, type ReactNode } from "react";
import { hintById } from "../guide/data";
import { Hint, HintScope, hintIdFor, sectionHintId, useHintScope } from "../guide/Hint";

/** Small form controls shared by the settings panel. Plain elements, styled in styles.css. */

export function HelpTip({ text }: { text: string }) {
  return (
    <span className="help-tip" title={text} role="img" aria-label={`Help: ${text}`} tabIndex={0}>
      ?
    </span>
  );
}

/** A collapsible group with an optional help tooltip. */
export function Section({ title, help, open = true, children, id }: { title: string; help?: string; open?: boolean; children: ReactNode; id?: string }) {
  const key = id ?? title.toLowerCase();
  const hid = sectionHintId(key);
  return (
    <details className="section" open={open} data-section={key}>
      <summary>
        <span>{title}</span>
        <Tip hid={hid} help={help} />
      </summary>
      <HintScope scope={key}>
        <div className="section-body">{children}</div>
      </HintScope>
    </details>
  );
}

/** The "?" for a control: the guide hint when one exists, else the old plain tooltip text, else nothing. */
export function Tip({ hid, help, what }: { hid: string | null; help?: string; what?: string }) {
  if (hid && hintById(hid)) return <Hint id={hid} what={what} />;
  return help ? <HelpTip text={help} /> : null;
}

/** Hint for a satin density (same-side spacing): a leg every density / 2 mm, so 20 / density legs per cm. */
export function satinHint(densityMm: number): string {
  if (!(densityMm > 0)) return "";
  return `≈ ${Math.round(20 / densityMm)} stitches/cm along the column`;
}

/** Hint for a fill row spacing: 10 / spacing rows per cm. */
export function rowsHint(rowSpacingMm: number): string {
  if (!(rowSpacingMm > 0)) return "";
  return `≈ ${Math.round(10 / rowSpacingMm)} rows/cm`;
}

interface FieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  /** Called when the user lets go, so a drag can close its undo group. */
  onDone?: () => void;
  help?: string;
  /** Hint id; by default `<section>.<label>` (see guide/Hint.tsx). */
  hid?: string;
  unit?: string;
  /** A short extra note after the unit, e.g. "≈ 2.5 stitches/mm". */
  hint?: string;
  /** Show the number, but let the range go further than the slider (typed values). */
  digits?: number;
}

/** A labelled slider with a number box beside it. */
export function Field({ label, value, min, max, step, onChange, onDone, help, hid, unit, hint, digits }: FieldProps) {
  const id = useId();
  const scope = useHintScope();
  const hintId = hid ?? (scope ? hintIdFor(scope, label) : null);
  const shown = digits !== undefined ? Number(value.toFixed(digits)) : value;
  return (
    <div className="field-line">
      <label htmlFor={id} className="field-label">
        {label}
        <Tip hid={hintId} help={help} what={hid === "pattern.setting" ? help : undefined} />
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onDone}
        onKeyUp={onDone}
        onBlur={onDone}
        aria-label={label}
      />
      <input
        className="num"
        type="number"
        min={min}
        step={step}
        value={shown}
        aria-label={`${label} value`}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
        onBlur={onDone}
      />
      {unit && <span className="muted small unit">{unit}</span>}
      {hint && (
        <span className="muted small field-hint" aria-label={`${label} hint`}>
          {hint}
        </span>
      )}
    </div>
  );
}

export function Toggle({ label, checked, onChange, help }: { label: string; checked: boolean; onChange: (v: boolean) => void; help?: string }) {
  const scope = useHintScope();
  return (
    <label className="toggle-line">
      <input type="checkbox" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
      <Tip hid={scope ? hintIdFor(scope, label) : null} help={help} />
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string; help?: string }[]; onChange: (v: T) => void; label: string }) {
  const scope = useHintScope();
  const hid = scope ? hintIdFor(scope, label) : null;
  const group = (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} className={value === o.id ? "active" : ""} aria-pressed={value === o.id} title={o.help} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
  if (!hid || !hintById(hid)) return group;
  return (
    <div className="segmented-wrap">
      {group}
      <Hint id={hid} />
    </div>
  );
}
