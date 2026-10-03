import { useEffect, useMemo, type ReactNode } from "react";
import type { FabricId, Quality, ThreadWeight } from "@lilo/engine/light";
import { CATALOGUES, FABRICS, FABRIC_IDS, QUALITIES, QUALITY_IDS, THREAD_WEIGHTS, THREAD_WEIGHT_IDS, designBounds, resolveSewingSetup } from "@lilo/engine/light";
import { loadShelf, useShelf } from "../state/shelfStore";
import { useEditor } from "../state/store";
import { useSewing } from "../sewing/useSewing";
import { Toggle } from "./controls";

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Left panel: import settings and the live palette. Changing any control re-runs the digitizer. */
export function DigitizePanel({ onOpen, children }: { onOpen: () => void; children?: ReactNode }) {
  const { state, actions } = useEditor();
  const { options, source, design, palette, status } = state;
  const sewing = useSewing();
  const working = status.kind === "working";
  const { shelf } = useShelf();
  useEffect(() => void loadShelf(), []);

  // Current artwork size: the finished design if there is one, else the source image's shape.
  const size = useMemo(() => {
    const b = design ? designBounds(design) : null;
    if (b && b.widthMm > 0 && b.heightMm > 0) return { w: b.widthMm, h: b.heightMm };
    if (source && source.width > 0 && source.height > 0) return { w: source.width, h: source.height };
    return null;
  }, [design, source]);
  const aspect = size ? size.w / size.h : 1;

  const widthShown = options.widthMm ?? (design && size ? round1(size.w) : "");
  const heightShown = options.heightMm ?? (design && size ? round1(size.h) : "");

  const setWidth = (v: number) => {
    if (!Number.isFinite(v) || v <= 0) return;
    actions.setOptions(options.aspectLock ? { widthMm: v, heightMm: round1(v / aspect) } : { widthMm: v });
  };
  const setHeight = (v: number) => {
    if (!Number.isFinite(v) || v <= 0) return;
    actions.setOptions(options.aspectLock ? { heightMm: v, widthMm: round1(v * aspect) } : { heightMm: v });
  };

  return (
    <aside className="panel panel-left" aria-label="Settings">
      <h2>Auto digitize</h2>

      <div className="field">
        <button onClick={onOpen} disabled={working}>
          {source ? "Open another image…" : "Open image…"}
        </button>
        <span className="muted small">{source ? source.name : "or drop PNG / JPG / WEBP / SVG on the canvas"}</span>
      </div>

      <label className="field">
        <span className="field-row">
          Colours <output>{options.colors}</output>
        </span>
        <input
          type="range"
          min={2}
          max={12}
          step={1}
          value={options.colors}
          aria-label="Colour count"
          onChange={(e) => actions.setOptions({ colors: Number(e.target.value) })}
        />
      </label>

      <div className="field">
        <span className="field-row">Size (mm)</span>
        <div className="size-row">
          <input
            type="number"
            min={5}
            max={260}
            step={1}
            aria-label="Width in millimetres"
            placeholder="auto"
            value={widthShown}
            onChange={(e) => setWidth(e.target.valueAsNumber)}
          />
          <span aria-hidden="true">×</span>
          <input
            type="number"
            min={5}
            max={260}
            step={1}
            aria-label="Height in millimetres"
            placeholder="auto"
            value={heightShown}
            onChange={(e) => setHeight(e.target.valueAsNumber)}
          />
        </div>
        <label className="check">
          <input type="checkbox" checked={options.aspectLock} onChange={(e) => actions.setOptions({ aspectLock: e.target.checked })} /> Lock aspect ratio
        </label>
      </div>

      <label className="field">
        <span className="field-row">
          Smallest region <output>{options.minRegionMm2} mm²</output>
        </span>
        <input
          type="range"
          min={0.5}
          max={10}
          step={0.5}
          value={options.minRegionMm2}
          aria-label="Minimum region size"
          onChange={(e) => actions.setOptions({ minRegionMm2: Number(e.target.value) })}
        />
      </label>

      <div className="field" role="group" aria-label="Background">
        <span className="field-row">Background</span>
        <div className="segmented">
          <button className={options.removeBackground ? "active" : ""} aria-pressed={options.removeBackground} onClick={() => actions.setOptions({ removeBackground: true })}>
            Remove
          </button>
          <button className={!options.removeBackground ? "active" : ""} aria-pressed={!options.removeBackground} onClick={() => actions.setOptions({ removeBackground: false })}>
            Keep
          </button>
        </div>
      </div>

      <label className="field">
        Thread brand
        <select value={options.catalogueId} aria-label="Thread brand" onChange={(e) => actions.setOptions({ catalogueId: e.target.value })}>
          {CATALOGUES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} ({c.threads.length})
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        Quality
        <select value={sewing.quality} aria-label="Quality" onChange={(e) => actions.setSewing({ quality: e.target.value as Quality })}>
          {QUALITY_IDS.map((q) => (
            <option key={q} value={q}>
              {QUALITIES[q].label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Thread weight
        <select value={sewing.threadWeight} aria-label="Thread weight" onChange={(e) => actions.setSewing({ threadWeight: Number(e.target.value) as ThreadWeight })}>
          {THREAD_WEIGHT_IDS.map((w) => (
            <option key={w} value={w}>
              {THREAD_WEIGHTS[w].label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Fabric
        <select value={sewing.fabric} aria-label="Fabric" onChange={(e) => actions.setSewing({ fabric: e.target.value as FabricId })}>
          {FABRIC_IDS.map((f) => (
            <option key={f} value={f}>
              {FABRICS[f].label}
            </option>
          ))}
        </select>
      </label>
      <p className="muted small" aria-label="Sewing setup summary">
        {resolveSewingSetup(sewing).summary}
      </p>

      <div className="field">
        <Toggle
          label="Use my threads"
          checked={options.useMyThreads}
          onChange={(v) => actions.setOptions({ useMyThreads: v })}
          help="Match the picture's colours to the spools on My Threads first. If the shelf is empty, the brand above is used."
        />
        {options.useMyThreads && (
          <span className="muted small">{shelf.entries.length > 0 ? `Matching to ${shelf.entries.length} spool${shelf.entries.length === 1 ? "" : "s"} on your shelf.` : "Your shelf is empty, so the brand above is used."}</span>
        )}
      </div>

      <button className="primary wide" onClick={() => void actions.digitize()} disabled={!source || working}>
        {working ? "Digitizing…" : "Digitize"}
      </button>
      <button className="wide" onClick={() => actions.setTool("clickstitch")} disabled={!state.trace || working} title={state.trace ? "Pick the regions of the trace to stitch yourself" : "Open an image first"}>
        Click to stitch…
      </button>

      <h2 className="spaced">Threads used</h2>
      {palette.length === 0 ? (
        <p className="muted small">Colours will appear here.</p>
      ) : (
        <ul className="chips" aria-label="Palette">
          {palette.map((c) => (
            <li key={c.thread.code + c.thread.line} className="chip">
              <span className="swatch" style={{ background: c.thread.hex }} aria-hidden="true" />
              <span className="chip-text">
                <strong>
                  {c.thread.brand} {c.thread.code}
                </strong>{" "}
                {c.thread.name}
              </span>
              {palette.length > 1 && c.share < 1 && <span className="muted small">{Math.round(c.share * 100)}%</span>}
            </li>
          ))}
        </ul>
      )}
      {children}
    </aside>
  );
}
