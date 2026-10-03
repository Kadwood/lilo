import { useId, type ReactNode } from "react";

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
  return (
    <details className="section" open={open} data-section={id ?? title.toLowerCase()}>
      <summary>
        <span>{title}</span>
        {help && <HelpTip text={help} />}
      </summary>
      <div className="section-body">{children}</div>
    </details>
  );
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
  unit?: string;
  /** Show the number, but let the range go further than the slider (typed values). */
  digits?: number;
}

/** A labelled slider with a number box beside it. */
export function Field({ label, value, min, max, step, onChange, onDone, help, unit, digits }: FieldProps) {
  const id = useId();
  const shown = digits !== undefined ? Number(value.toFixed(digits)) : value;
  return (
    <div className="field-line">
      <label htmlFor={id} className="field-label">
        {label}
        {help && <HelpTip text={help} />}
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
    </div>
  );
}

export function Toggle({ label, checked, onChange, help }: { label: string; checked: boolean; onChange: (v: boolean) => void; help?: string }) {
  return (
    <label className="toggle-line">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
      {help && <HelpTip text={help} />}
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string; help?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} className={value === o.id ? "active" : ""} aria-pressed={value === o.id} title={o.help} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
