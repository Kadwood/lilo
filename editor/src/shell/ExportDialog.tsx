import { useEffect, useState } from "react";
import type { Origin, PlanWarning, PlanStats } from "@lilo/engine";
import { useEngine } from "../engine/context";
import { getPlatform } from "../platform";
import { formatDuration } from "../state/player";
import { useEditor } from "../state/store";

const H: Origin["h"][] = ["left", "center", "right"];
const V: Origin["v"][] = ["top", "center", "bottom"];

const cleanName = (name: string) => (name.trim() || "design").replace(/[\\/:*?"<>|]+/g, "_").replace(/\.pes$/i, "");

export interface Prepared {
  pes: Uint8Array;
  stats: PlanStats;
  warnings: PlanWarning[];
}

/** Compute the PES for the current design (re-runs when the origin changes). */
export function usePreparedPes(origin: Origin, label: string): { prepared: Prepared | null; error: string | null } {
  const engine = useEngine();
  const { state } = useEditor();
  const design = state.design;
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!design) return;
    let alive = true;
    setPrepared(null);
    setError(null);
    engine
      .exportPes(design, { origin, label })
      .then((r) => alive && setPrepared(r))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [engine, design, origin, label]);
  return { prepared, error };
}

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

/** Export: stats, file name, 3x3 origin, validation warnings, then Save PES. */
export function ExportDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (msg: string) => void }) {
  const { state } = useEditor();
  const [name, setName] = useState(() => cleanName(state.projectName));
  const [origin, setOrigin] = useState<Origin>({ h: "center", v: "center" });
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const label = cleanName(name);
  const { prepared, error } = usePreparedPes(origin, label);
  const design = state.design;

  const save = async () => {
    if (!prepared) return;
    setSaving(true);
    setSaveError(null);
    try {
      const saved = await getPlatform().saveFile(`${label}.pes`, prepared.pes);
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
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="export-title">
        <h2 id="export-title">Export PES</h2>

        {prepared ? (
          <dl className="stats" aria-label="Export stats">
            <div><dt>Stitches</dt><dd>{prepared.stats.stitchCount.toLocaleString()}</dd></div>
            <div><dt>Objects</dt><dd>{design?.objects.filter((o) => o.visible !== false).length ?? 0}</dd></div>
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
            <span className="muted">.pes</span>
          </span>
        </label>

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

        {prepared && <WarningList warnings={prepared.warnings} />}
        {saveError && <p className="error">{saveError}</p>}

        <div className="dialog-actions">
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
          <button className="primary" onClick={save} disabled={!prepared || saving}>
            Save PES
          </button>
        </div>
      </div>
    </div>
  );
}
