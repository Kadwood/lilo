import { useCallback, useRef, useState } from "react";
import { checkSafe, safeRangeFor, type SafeCheck, type SafeSliderParam } from "@lilo/engine/light";
import { formatDuration } from "../state/player";
import { useEditor } from "../state/store";
import { Field } from "./controls";
import { safeContextOf, SLIDER_LIMITS } from "./safety";

/** "+1,240 stitches · +1 min 30 s": what a change did to the stitch count and the sew time. */
export function formatDelta(stitches: number, seconds: number): string {
  const sign = (n: number) => (n < 0 ? "−" : "+");
  const s = Math.round(stitches);
  const t = Math.round(seconds);
  if (s === 0 && t === 0) return "No change to the stitches or the time.";
  return `${sign(s)}${Math.abs(s).toLocaleString()} stitch${Math.abs(s) === 1 ? "" : "es"} · ${sign(t)}${formatDuration(Math.abs(t))}`;
}

/**
 * "What will this change?": how the stitch count and sew time moved since you started on this slider.
 * It reads the live plan the editor already re-makes in the engine worker after every edit (debounced),
 * so nothing here blocks the screen. `begin` notes where you started; call it when a drag or edit begins.
 */
export function useStitchDelta(): { begin: () => void; line: string | null } {
  const { state } = useEditor();
  const stats = state.planResult?.stats ?? null;
  const start = useRef<{ stats: NonNullable<typeof stats>; stitches: number; seconds: number } | null>(null);
  const [, bump] = useState(0);
  const begin = useCallback(() => {
    if (!stats) return;
    start.current = { stats, stitches: stats.stitchCount, seconds: stats.estimatedSeconds };
    bump((n) => n + 1);
  }, [stats]);
  const s = start.current;
  if (!s || !stats) return { begin, line: null };
  if (state.planning) return { begin, line: "Working it out…" };
  if (stats === s.stats) return { begin, line: null };
  return { begin, line: formatDelta(stats.stitchCount - s.stitches, stats.estimatedSeconds - s.seconds) };
}

export interface SafeSliderProps {
  label: string;
  param: SafeSliderParam;
  /** The value shown (the mean when several shapes are selected). */
  value: number;
  onChange: (v: number) => void;
  onDone?: () => void;
  unit?: string;
  help?: string;
  hint?: string;
  /** Override the slider's own range (the object panel keeps its old ones). Default: `SLIDER_LIMITS`. */
  limits?: { min: number; max: number; step: number };
  /** The status to show instead of the one worked out from `value` (the card gives the worst of many shapes). */
  check?: SafeCheck;
  /** Extra line under the slider, e.g. "3 shapes: 0.38 to 0.45 mm". */
  note?: string;
  disabled?: boolean;
  /** Hint id passed on to `Field`. */
  hid?: string;
  /** Show the "what will this change?" line. Default true. */
  preview?: boolean;
}

/**
 * One slider with the green band drawn behind it, a status dot, a plain-words reason when it is amber and
 * a live "what will this change?" line. Used by the Stitch safety card and by each object's settings.
 * Amber never blocks anything: Lilo still sews it and still exports it.
 */
export function SafeSlider({ label, param, value, onChange, onDone, unit = "mm", help, hint, limits, check, note, disabled, hid, preview = true }: SafeSliderProps) {
  const { state } = useEditor();
  const ctx = safeContextOf(state.design);
  const range = safeRangeFor(param, ctx);
  const lim = limits ?? SLIDER_LIMITS[param];
  const pct = (v: number) => Math.min(100, Math.max(0, ((v - lim.min) / (lim.max - lim.min)) * 100));
  const band = { from: range.min === null ? 0 : pct(range.min), to: range.max === null ? 100 : pct(range.max) };
  const c = check ?? checkSafe(param, value, ctx);
  const delta = useStitchDelta();
  return (
    <Field
      label={label}
      value={value}
      min={lim.min}
      max={lim.max}
      step={lim.step}
      unit={unit}
      help={help}
      hint={hint}
      hid={hid}
      disabled={disabled}
      band={band}
      safeStatus={c.status}
      onChange={onChange}
      onDone={onDone}
      onStart={delta.begin}
      below={
        <>
          {c.status !== "ok" && (
            <p className="safe-reason" role="status">
              {c.reason}
            </p>
          )}
          {note && <p className="muted small safe-note">{note}</p>}
          {preview && delta.line && (
            <p className="muted small safe-preview" aria-label={`${label}: what this changes`}>
              {delta.line}
            </p>
          )}
        </>
      }
    />
  );
}
