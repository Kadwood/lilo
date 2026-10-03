import { useState } from "react";
import { FABRICS, FABRIC_IDS, QUALITIES, QUALITY_IDS, THREAD_WEIGHTS, THREAD_WEIGHT_IDS, autoObjectCount, type ApplyResult, type FabricId, type Quality, type ThreadWeight } from "@lilo/engine/light";
import { useHoop } from "../hoops/autoPick";
import { fmtSize } from "../hoops/format";
import { setHoopView } from "../state/hoopViewStore";
import { useEditor } from "../state/store";
import { shortFabric, useResolvedSewing, useSewing } from "./useSewing";

const mm = (n: number) => String(Math.round(n));

/** "Suiting · 40 wt · Premium · 130×180": the whole setup in one line. */
export function sewingChip(fabricLabel: string, weight: number, qualityLabel: string, hoop: { widthMm: number; heightMm: number }): string {
  return `${shortFabric(fabricLabel)} · ${weight} wt · ${qualityLabel} · ${mm(hoop.widthMm)}×${mm(hoop.heightMm)}`;
}

/**
 * What the design is sewn on and with: fabric, thread weight, quality and the hoop. Always visible as a
 * chip row; opens into the full card. The choice is part of the design (saved in the .lilo file, one
 * undo step): shapes made by Auto digitize follow it, anything edited by hand stays as it was.
 */
export function SewingCard() {
  const { state, actions } = useEditor();
  const sewing = useSewing();
  const resolved = useResolvedSewing();
  const hoop = useHoop();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ApplyResult | null>(null);
  const auto = state.design ? autoObjectCount(state.design) : 0;

  const change = (patch: { fabric?: FabricId; threadWeight?: ThreadWeight; quality?: Quality }) => setResult(actions.setSewing(patch));
  const chip = sewingChip(resolved.fabric.label, sewing.threadWeight, resolved.quality.label, hoop);

  return (
    <section className="sewing-card" aria-label="Sewing setup">
      <button className="sewing-chip" aria-expanded={open} aria-controls="sewing-card-body" onClick={() => setOpen((v) => !v)} title="What you are sewing on and with">
        <span className="sewing-chip-text">{chip}</span>
        <span className="sewing-chip-caret" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>
      {open && (
        <div className="sewing-body" id="sewing-card-body">
          <label className="field">
            Fabric
            <select aria-label="Fabric" value={sewing.fabric} onChange={(e) => change({ fabric: e.target.value as FabricId })}>
              {FABRIC_IDS.map((f) => (
                <option key={f} value={f} title={FABRICS[f].description}>
                  {FABRICS[f].label}
                </option>
              ))}
            </select>
            <span className="muted small">{FABRICS[sewing.fabric].description}</span>
          </label>
          <label className="field">
            Thread weight
            <select aria-label="Thread weight" value={sewing.threadWeight} onChange={(e) => change({ threadWeight: Number(e.target.value) as ThreadWeight })}>
              {THREAD_WEIGHT_IDS.map((w) => (
                <option key={w} value={w} title={THREAD_WEIGHTS[w].description}>
                  {THREAD_WEIGHTS[w].label}
                </option>
              ))}
            </select>
            <span className="muted small">{THREAD_WEIGHTS[sewing.threadWeight].description}</span>
          </label>
          <label className="field">
            Quality
            <select aria-label="Quality" value={sewing.quality} onChange={(e) => change({ quality: e.target.value as Quality })}>
              {QUALITY_IDS.map((q) => (
                <option key={q} value={q} title={QUALITIES[q].summary}>
                  {QUALITIES[q].label}
                </option>
              ))}
            </select>
            <span className="muted small">{QUALITIES[sewing.quality].summary}</span>
          </label>
          <div className="field">
            Hoop
            <button className="hoop-button" onClick={() => setHoopView({ pickerOpen: true })} aria-label={`Hoop: ${hoop.name}, ${fmtSize(hoop)}. Change`}>
              <span className="hoop-button-icon" aria-hidden="true" data-shape={hoop.shape ?? "rect"} />
              <span className="hoop-button-name">{hoop.name}</span>
              <span className="muted small">{fmtSize(hoop)}</span>
            </button>
          </div>

          <dl className="sewing-facts" aria-label="What this setup calls for">
            <dt>Needle</dt>
            <dd>
              {resolved.fabric.needle.size} {resolved.fabric.needle.type}
            </dd>
            <dt>Stabiliser</dt>
            <dd>
              {resolved.fabric.stabiliser.type}, {resolved.fabric.stabiliser.weight}
            </dd>
            <dt>Topping</dt>
            <dd>{resolved.fabric.topping === "water-soluble" ? "water-soluble" : "none"}</dd>
          </dl>
          <p className="muted small">{resolved.summary}</p>

          {result && state.design && (
            <p className="small" role="status">
              {auto === 0
                ? "Saved. Nothing in this design came from Auto digitize, so no shapes changed."
                : `${result.updated} shape${result.updated === 1 ? "" : "s"} updated${result.kept > 0 ? `; ${result.kept} value${result.kept === 1 ? "" : "s"} you set by hand kept` : ""}. Undo brings the old setup back.`}
            </p>
          )}
          <p className="muted small">Shapes you drew or edited yourself are never changed. Thin strokes that become narrow satin under Premium only change the next time you digitize.</p>
        </div>
      )}
    </section>
  );
}
