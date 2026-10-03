import { useEffect, useState } from "react";
import { FORMATS, type FormatExt, type Origin, type PlanStats, type PlanWarning } from "@lilo/engine/light";
import { useEngine } from "../engine/context";
import { BeforeYouSew } from "../sewing/BeforeYouSew";
import { useModalFocus } from "./useModalFocus";
import { getPlatform } from "../platform";
import { formatDuration } from "../state/player";
import { useEditor } from "../state/store";

const H: Origin["h"][] = ["left", "center", "right"];
const V: Origin["v"][] = ["top", "center", "bottom"];

export type ExportFormat = FormatExt | "png";

/** Every format Lilo writes, PES first (the default), then the picture. */
export const EXPORT_CHOICES: { id: ExportFormat; label: string; note: string }[] = [
  ...(["pes", "dst", "jef", "vp3", "exp", "xxx", "u01", "pec"] as const).map((ext) => {
    const f = FORMATS.find((x) => x.ext === ext)!;
    return {
      id: ext as ExportFormat,
      label: f.label,
      note: f.hasColors ? "Keeps thread colours." : "No thread colours in this format: only the colour changes are kept.",
    };
  }),
  { id: "png", label: "PNG image", note: "A picture of the stitches, 1600 px, not a machine file." },
];

const PNG_SIZE = 1600;
const KNOWN_EXT = new RegExp(`\\.(${[...FORMATS.map((f) => f.ext), "png", "lilo"].join("|")})$`, "i");

/** A safe file stem from a project name. */
export const cleanName = (name: string) => (name.trim() || "design").replace(/[\\/:*?"<>|]+/g, "_").replace(KNOWN_EXT, "");

export interface Prepared {
  bytes: Uint8Array;
  /** The same bytes (the Send dialog sends PES). */
  pes: Uint8Array;
  stats: PlanStats;
  warnings: PlanWarning[];
}

/** Makes the file for a format and origin: from the design, the pixel grid, whatever the dialog is exporting. */
export type Prepare = (format: ExportFormat, origin: Origin, label: string) => Promise<Prepared>;

/** Run `prepare` whenever its inputs change; stale answers are dropped. `deps` are what `prepare` reads. */
export function usePreparedWith(prepare: Prepare, format: ExportFormat, origin: Origin, label: string, deps: readonly unknown[]): { prepared: Prepared | null; error: string | null } {
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setPrepared(null);
    setError(null);
    prepare(format, origin, label)
      .then((p) => alive && setPrepared(p))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [format, origin, label, ...deps]);
  return { prepared, error };
}

const prepared = (bytes: Uint8Array, stats: PlanStats, warnings: PlanWarning[]): Prepared => ({ bytes, pes: bytes, stats, warnings });

/** Compute the file for the current design in `format` (re-runs when the design, format or origin changes). */
export function usePrepared(format: ExportFormat, origin: Origin, label: string): { prepared: Prepared | null; error: string | null } {
  const engine = useEngine();
  const { state } = useEditor();
  const design = state.design;
  const planResult = state.planResult;
  return usePreparedWith(
    async (f, o, l) => {
      if (!design) throw new Error("There is nothing to export yet.");
      if (f === "png") {
        const bytes = await engine.call("exportImage", design, PNG_SIZE);
        if (!planResult) throw new Error("Still stitching: try again in a moment.");
        return prepared(bytes, planResult.stats, planResult.warnings);
      }
      const r = await engine.call("exportFormat", design, f, { origin: o, label: l });
      return prepared(r.bytes, r.stats, r.warnings);
    },
    format,
    origin,
    label,
    [engine, design, format === "png" ? planResult : null],
  );
}

/** PES for the current design (Send uses this). */
export const usePreparedPes = (origin: Origin, label: string) => usePrepared("pes", origin, label);

export function WarningList({ warnings }: { warnings: PlanWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="warnings" aria-label="Warnings">
      {warnings.map((w, i) => (
        <li key={i}>{w.message}</li>
      ))}
    </ul>
  );
}

/**
 * Export: pick a format, see the stats, file name, 3x3 origin and validation warnings, then Save. What
 * is exported comes from `prepare` (the design, or the pixel grid); `deps` are what it reads.
 */
export function ExportPanel({
  defaultName,
  objects,
  prepare,
  deps,
  onClose,
  onSaved,
  before,
}: {
  defaultName: string;
  /** Shown in the stats. */
  objects: number;
  prepare: Prepare;
  deps: readonly unknown[];
  onClose: () => void;
  onSaved: (msg: string) => void;
  /** Shown under the warnings: the "Before you sew" card (not for pixel art, which has no sewing setup). */
  before?: React.ReactNode;
}) {
  const modal = useModalFocus<HTMLDivElement>();
  const [name, setName] = useState(() => cleanName(defaultName));
  const [format, setFormat] = useState<ExportFormat>("pes");
  const [origin, setOrigin] = useState<Origin>({ h: "center", v: "center" });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const label = cleanName(name);
  const { prepared, error } = usePreparedWith(prepare, format, origin, label, deps);
  const choice = EXPORT_CHOICES.find((c) => c.id === format)!;

  const save = async () => {
    if (!prepared) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await getPlatform().saveFile(`${label}.${format}`, prepared.bytes);
      if (saved) {
        onSaved(`Saved ${saved}`);
        onClose();
      }
    } catch (e) {
      setSaveError(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <div ref={modal} tabIndex={-1} className="dialog dialog-wide" role="dialog" aria-modal="true" aria-labelledby="export-title" onKeyDown={(e) => e.key === "Escape" && onClose()}>
        <h2 id="export-title">Export</h2>

        <div className="format-list" role="radiogroup" aria-label="File format">
          {EXPORT_CHOICES.map((c) => (
            <button key={c.id} role="radio" aria-checked={format === c.id} className={`format${format === c.id ? " active" : ""}`} onClick={() => setFormat(c.id)} title={c.note}>
              <strong>{c.id.toUpperCase()}</strong>
              <span>{c.label}</span>
            </button>
          ))}
        </div>
        <p className="muted small" role="note">
          {choice.note}
        </p>

        {prepared ? (
          <dl className="stats" aria-label="Export stats">
            <div><dt>Stitches</dt><dd>{prepared.stats.stitchCount.toLocaleString()}</dd></div>
            <div><dt>Objects</dt><dd>{objects}</dd></div>
            <div><dt>Colour changes</dt><dd>{prepared.stats.colorChanges}</dd></div>
            <div><dt>Size</dt><dd>{prepared.stats.widthMm.toFixed(1)} × {prepared.stats.heightMm.toFixed(1)} mm</dd></div>
            <div><dt>Time</dt><dd>≈ {formatDuration(prepared.stats.estimatedSeconds)}</dd></div>
          </dl>
        ) : (
          !error && <p className="muted" role="status">Preparing…</p>
        )}
        {error && <p className="error">{error}</p>}

        <label className="field">
          File name
          <span className="name-row">
            <input value={name} onChange={(e) => setName(e.target.value)} aria-label="File name" />
            <span className="muted">.{format}</span>
          </span>
        </label>

        {format !== "png" && (
          <div className="field" role="radiogroup" aria-label="Origin point">
            <span>Origin (the point the machine sews around)</span>
            <div className="origin-grid">
              {V.map((v) =>
                H.map((h) => {
                  const on = origin.h === h && origin.v === v;
                  return (
                    <button
                      key={`${h}-${v}`}
                      role="radio"
                      aria-checked={on}
                      aria-label={`${v} ${h}`.replace("center center", "centre").replace("center", "centre")}
                      className={on ? "active" : ""}
                      onClick={() => setOrigin({ h, v })}
                    >
                      {on ? "●" : "○"}
                    </button>
                  );
                }),
              )}
            </div>
          </div>
        )}

        {prepared && <WarningList warnings={prepared.warnings} />}
        {before}
        {saveError && <p className="error">{saveError}</p>}

        <div className="dialog-actions">
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
          <button className="primary" onClick={save} disabled={!prepared || saving}>
            Save {format === "png" ? "PNG" : format.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Export the design in the editor. */
export function ExportDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (msg: string) => void }) {
  const engine = useEngine();
  const { state } = useEditor();
  const design = state.design;
  const planResult = state.planResult;
  const prepare: Prepare = async (f, o, l) => {
    if (!design) throw new Error("There is nothing to export yet.");
    if (f === "png") {
      const bytes = await engine.call("exportImage", design, PNG_SIZE);
      if (!planResult) throw new Error("Still stitching: try again in a moment.");
      return prepared(bytes, planResult.stats, planResult.warnings);
    }
    const r = await engine.call("exportFormat", design, f, { origin: o, label: l });
    return prepared(r.bytes, r.stats, r.warnings);
  };
  return (
    <ExportPanel
      defaultName={state.projectName}
      objects={design?.objects.filter((o) => o.visible !== false).length ?? 0}
      prepare={prepare}
      deps={[engine, design, planResult]}
      onClose={onClose}
      onSaved={onSaved}
      before={<BeforeYouSew />}
    />
  );
}
