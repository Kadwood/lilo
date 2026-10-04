import { useRef, useState } from "react";
import { useStore } from "zustand";
import { AnchoredPopover } from "./AnchoredPopover";
import { appearanceStore, setReduceTransparency, setTheme, type ThemeChoice } from "../state/appearanceStore";

const THEMES: { id: ThemeChoice; label: string }[] = [
  { id: "system", label: "System" },
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
];

const MATERIAL_NOTE: Record<string, string> = {
  "liquid-glass": "Liquid Glass window",
  vibrancy: "Frosted window",
  mica: "Mica window",
  solid: "Solid window",
};

/** The look of the app: light or dark, and "Reduce transparency" (also switched on by the macOS accessibility setting). */
export function AppearanceMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const theme = useStore(appearanceStore, (s) => s.theme);
  const reduce = useStore(appearanceStore, (s) => s.reduceTransparency);
  const system = useStore(appearanceStore, (s) => s.systemReduceTransparency);
  const material = useStore(appearanceStore, (s) => s.material);

  return (
    <div className="appearance" ref={ref}>
      <button className="appearance-button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((v) => !v)} title="Appearance">
        Appearance
      </button>
      {open && (
        <AnchoredPopover anchor={ref} align="end" onClose={() => setOpen(false)}>
        <div className="appearance-pop popover" role="dialog" aria-label="Appearance">
          <div className="field-label small">Theme</div>
          <div className="segmented" role="group" aria-label="Theme">
            {THEMES.map((t) => (
              <button key={t.id} className={theme === t.id ? "active" : ""} aria-pressed={theme === t.id} onClick={() => setTheme(t.id)}>
                {t.label}
              </button>
            ))}
          </div>
          <label className="toggle-line">
            <input type="checkbox" checked={reduce || system} disabled={system} onChange={(e) => setReduceTransparency(e.target.checked)} />
            <span>Reduce transparency</span>
          </label>
          <p className="muted small">
            {system ? "On because your computer's accessibility settings ask for it. " : "Makes panels solid. Turns on by itself if your computer's accessibility settings ask for it. "}
            {MATERIAL_NOTE[material]}.
          </p>
        </div>
        </AnchoredPopover>
      )}
    </div>
  );
}
