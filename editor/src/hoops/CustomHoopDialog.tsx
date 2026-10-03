import { useState } from "react";
import { useStore } from "zustand";
import { HoopError, validateCustomHoop, type CustomHoopInput, type Hoop } from "@lilo/engine/light";
import { useModalFocus } from "../shell/useModalFocus";
import { useEditor } from "../state/store";
import { hoopStore, rememberHoop, saveCustomHoop } from "../state/hoopStore";

const SHAPES: { id: CustomHoopInput["shape"]; label: string }[] = [
  { id: "rect", label: "Rectangle" },
  { id: "round", label: "Round" },
  { id: "oval", label: "Oval" },
];

const num = (s: string): number => (s.trim() === "" ? NaN : Number(s));

/** A small drawing of the hoop being described, scaled to fit. */
function Preview({ w, h, shape, radius }: { w: number; h: number; shape: CustomHoopInput["shape"]; radius: number }) {
  const ok = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
  const box = 120;
  const k = ok ? box / Math.max(w, h) : 1;
  const pw = ok ? w * k : 0;
  const ph = ok ? h * k : 0;
  return (
    <svg className="hoop-preview" viewBox={`0 0 ${box + 16} ${box + 16}`} role="img" aria-label="Preview of the hoop">
      {ok &&
        (shape === "rect" || shape === "cap" ? (
          <rect x={8 + (box - pw) / 2} y={8 + (box - ph) / 2} width={pw} height={ph} rx={Math.min(radius * k, pw / 2, ph / 2)} />
        ) : (
          <ellipse cx={8 + box / 2} cy={8 + box / 2} rx={pw / 2} ry={ph / 2} />
        ))}
    </svg>
  );
}

/** Add or edit one of your own hoops: name, size, shape and corner radius. */
export function CustomHoopDialog({ editingId, onClose }: { editingId: string | null; onClose: () => void }) {
  const { actions, state } = useEditor();
  const custom = useStore(hoopStore, (s) => s.custom);
  const existing: Hoop | undefined = editingId ? custom.find((h) => h.id === editingId) : undefined;
  const ref = useModalFocus<HTMLFormElement>();
  const [name, setName] = useState(existing?.name ?? "");
  const [w, setW] = useState(String(existing?.widthMm ?? state.design?.hoop.widthMm ?? 130));
  const [h, setH] = useState(String(existing?.heightMm ?? state.design?.hoop.heightMm ?? 180));
  const [shape, setShape] = useState<CustomHoopInput["shape"]>((existing?.shape as CustomHoopInput["shape"]) ?? "rect");
  const [radius, setRadius] = useState(String(existing?.cornerRadiusMm ?? 6));
  const [error, setError] = useState<string | null>(null);
  const [useIt, setUseIt] = useState(!editingId);

  const input: CustomHoopInput = { name, widthMm: num(w), heightMm: shape === "round" ? num(w) : num(h), shape, cornerRadiusMm: shape === "rect" ? num(radius) : undefined };
  const problems = validateCustomHoop(input, custom, editingId ?? undefined);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (problems.length) {
      setError(problems.join(" "));
      return;
    }
    try {
      const saved = await saveCustomHoop(input, editingId ?? undefined);
      if (useIt) {
        actions.setHoop(saved);
        rememberHoop(saved);
      } else if (editingId && state.design?.hoop.id === editingId) {
        // editing the hoop in use: the design follows it
        actions.setHoop(saved);
      }
      onClose();
    } catch (err) {
      setError(err instanceof HoopError ? err.message : `Could not save: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form
        className="dialog custom-hoop"
        role="dialog"
        aria-modal="true"
        aria-label={editingId ? "Edit hoop" : "Add a hoop"}
        tabIndex={-1}
        ref={ref}
        onSubmit={(e) => void submit(e)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <h2>{editingId ? "Edit hoop" : "Add a hoop"}</h2>
        <p className="muted small">Use the sewing area printed on the hoop or in your machine's manual: the part the needle can reach.</p>
        <div className="custom-hoop-body">
          <div className="custom-hoop-fields">
            <label className="field">
              Name
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Jacket back hoop" maxLength={60} />
            </label>
            <div className="field" role="group" aria-label="Shape">
              Shape
              <div className="segmented">
                {SHAPES.map((s) => (
                  <button type="button" key={s.id} className={shape === s.id ? "active" : ""} aria-pressed={shape === s.id} onClick={() => setShape(s.id)}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="custom-hoop-size">
              <label className="field">
                {shape === "round" ? "Diameter (mm)" : "Width (mm)"}
                <input type="number" inputMode="decimal" min={10} max={1000} step={1} value={w} onChange={(e) => setW(e.target.value)} />
              </label>
              {shape !== "round" && (
                <label className="field">
                  Height (mm)
                  <input type="number" inputMode="decimal" min={10} max={1000} step={1} value={h} onChange={(e) => setH(e.target.value)} />
                </label>
              )}
              {shape === "rect" && (
                <label className="field">
                  Corner radius (mm)
                  <input type="number" inputMode="decimal" min={0} step={1} value={radius} onChange={(e) => setRadius(e.target.value)} />
                </label>
              )}
            </div>
          </div>
          <Preview w={input.widthMm} h={input.heightMm} shape={shape} radius={num(radius) || 0} />
        </div>
        <label className="check">
          <input type="checkbox" checked={useIt} onChange={(e) => setUseIt(e.target.checked)} /> Use this hoop for the design
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <span className="spacer" />
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            {editingId ? "Save" : "Add hoop"}
          </button>
        </div>
      </form>
    </div>
  );
}
