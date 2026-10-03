import { useEffect, useMemo, useRef, useState } from "react";
import type { FontIndexEntry, TextAlign } from "@lilo/engine/lettering";
import { nextTextGroup, textThread, useTextTarget } from "./adapter";
import { defaultServices, type CustomFontInfo, type FontRef, type LetteringServices } from "./fonts";
import "./lettering.css";

const PRESETS = [6, 10, 15, 25];
const CUSTOM_MIN_MM = 6;
const fmt = (n: number) => String(Math.round(n * 10) / 10);

/** Warning text for a font at a height, or null. Mirrors the engine's own guard. */
export function heightWarning(font: { kind: "builtin"; entry: FontIndexEntry } | { kind: "custom"; name: string }, heightMm: number): string | null {
  if (font.kind === "custom") return heightMm < CUSTOM_MIN_MM ? "Custom fonts sew best above 6 mm. Try a built-in font." : null;
  const { minHeightMm, maxHeightMm, name } = font.entry;
  if (heightMm < minHeightMm) return `${name} is designed for ${fmt(minHeightMm)}-${fmt(maxHeightMm)} mm letters. At ${fmt(heightMm)} mm it will sew poorly. Try a smaller font.`;
  if (heightMm > maxHeightMm) return `${name} is designed for ${fmt(minHeightMm)}-${fmt(maxHeightMm)} mm letters. At ${fmt(heightMm)} mm it will look sparse.`;
  return null;
}

/** The Text panel as a collapsible dock over the canvas: the one thing the editor shell mounts. */
export function TextDock({ defaultOpen = false, services }: { defaultOpen?: boolean; services?: LetteringServices }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="text-dock">
      <button className="dock-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        Text {open ? "▾" : "▸"}
      </button>
      {open && <TextPanel services={services} />}
    </div>
  );
}

/** Text tool: pick a font, type, set the size, and add the stitched letters to the design. */
export function TextPanel({ services = defaultServices }: { services?: LetteringServices }) {
  const { design, insert } = useTextTarget();
  const [index, setIndex] = useState<FontIndexEntry[]>([]);
  const [custom, setCustom] = useState<CustomFontInfo[]>([]);
  const [font, setFont] = useState<FontRef>({ kind: "builtin", id: "geneva_simple" });
  const [text, setText] = useState("Lilo");
  const [height, setHeight] = useState(10);
  const [spacing, setSpacing] = useState(0);
  const [lineSpacing, setLineSpacing] = useState(1);
  const [align, setAlign] = useState<TextAlign>("center");
  const [fitOnly, setFitOnly] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    void services.loadIndex().then((i) => live && setIndex(i));
    void services.listCustom().then((c) => live && setCustom(c));
    return () => {
      live = false;
    };
  }, [services]);

  const selected = useMemo(() => {
    if (font.kind === "builtin") {
      const entry = index.find((f) => f.id === font.id);
      return entry ? ({ kind: "builtin", entry } as const) : null;
    }
    const c = custom.find((f) => f.key === font.key);
    return c ? ({ kind: "custom", name: c.name } as const) : null;
  }, [font, index, custom]);

  const warning = selected ? heightWarning(selected, height) : null;
  const shown = fitOnly ? index.filter((f) => height >= f.minHeightMm && height <= f.maxHeightMm) : index;

  const upload = async (f: File | undefined) => {
    if (!f) return;
    setMessage(null);
    try {
      const bytes = await f.arrayBuffer();
      const added = await services.addCustom({ name: f.name, bytes });
      setCustom(await services.listCustom());
      setFont({ kind: "custom", key: added.key });
      if (added.faces > 1) setMessage({ kind: "info", text: `${f.name} holds ${added.faces} fonts; using the first (${added.name}).` });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };

  const add = async () => {
    if (!text.trim()) return;
    setBusy(true);
    setMessage(null);
    try {
      const thread = textThread(design);
      const group = nextTextGroup(design);
      const fontId = font.kind === "builtin" ? font.id : `custom:${font.key}`;
      const r = await services.layout({ text, font, heightMm: height, letterSpacingMm: spacing, lineSpacing, align, threadId: thread.id, idPrefix: group });
      if (r.objects.length === 0) {
        setMessage({ kind: "error", text: r.warnings[0]?.message ?? "Nothing to stitch." });
        return;
      }
      await insert(r, { id: group, text, fontId, heightMm: height, letterSpacingMm: spacing, lineSpacing, align }, thread);
      const notes = r.warnings.filter((w) => w.code === "missing-glyph" || w.code === "text-longer-than-path").map((w) => w.message);
      if (notes.length) setMessage({ kind: "info", text: notes.join(" ") });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="panel panel-text" aria-label="Text">
      <h2>Text</h2>

      <label className="field">
        <span className="field-row">Text</span>
        <textarea aria-label="Text to stitch" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </label>

      <div className="field">
        <span className="field-row">Height (mm)</span>
        <div className="segmented" role="group" aria-label="Height presets">
          {PRESETS.map((p) => (
            <button key={p} className={height === p ? "active" : ""} onClick={() => setHeight(p)} aria-pressed={height === p}>
              {p}
            </button>
          ))}
        </div>
        <input type="number" min={2} max={200} step={0.5} value={height} aria-label="Letter height in millimetres" onChange={(e) => Number(e.target.value) > 0 && setHeight(Number(e.target.value))} />
        {warning && (
          <span className="badge warn" role="status">
            {warning}
          </span>
        )}
      </div>

      <label className="field">
        <span className="field-row">
          Letter spacing <output>{fmt(spacing)} mm</output>
        </span>
        <input type="range" min={-1} max={5} step={0.1} value={spacing} aria-label="Letter spacing" onChange={(e) => setSpacing(Number(e.target.value))} />
      </label>

      <label className="field">
        <span className="field-row">
          Line spacing <output>{fmt(lineSpacing)}x</output>
        </span>
        <input type="range" min={0.6} max={2} step={0.05} value={lineSpacing} aria-label="Line spacing" onChange={(e) => setLineSpacing(Number(e.target.value))} />
      </label>

      <div className="field">
        <span className="field-row">Align</span>
        <div className="segmented" role="group" aria-label="Alignment">
          {(["left", "center", "right"] as const).map((a) => (
            <button key={a} className={align === a ? "active" : ""} onClick={() => setAlign(a)} aria-pressed={align === a}>
              {a}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <button className="primary" onClick={() => void add()} disabled={busy || !text.trim() || !selected}>
          {busy ? "Working..." : "Add text"}
        </button>
        {message && (
          <span className={message.kind === "error" ? "error small" : "muted small"} role={message.kind === "error" ? "alert" : "status"}>
            {message.text}
          </span>
        )}
      </div>

      <h2 className="spaced">Fonts</h2>
      <label className="field-row small">
        <input type="checkbox" checked={fitOnly} onChange={(e) => setFitOnly(e.target.checked)} aria-label="Only fonts that suit this height" /> Only fonts for {fmt(height)} mm
      </label>

      <ul className="font-list" aria-label="Built-in fonts">
        {shown.map((f) => {
          const url = services.previewUrl(f.id);
          const active = font.kind === "builtin" && font.id === f.id;
          return (
            <li key={f.id}>
              <button className={`font-item${active ? " active" : ""}`} aria-pressed={active} onClick={() => setFont({ kind: "builtin", id: f.id })} title={`${f.name} (${f.licenceLabel})`}>
                {url ? <img src={url} alt={f.name} loading="lazy" /> : <span>{f.name}</span>}
                <span className="small muted">
                  {f.name} · {fmt(f.minHeightMm)}-{fmt(f.maxHeightMm)} mm
                </span>
              </button>
            </li>
          );
        })}
        {index.length > 0 && shown.length === 0 && <li className="muted small">No built-in font suits {fmt(height)} mm.</li>}
      </ul>

      <h2 className="spaced">Your fonts</h2>
      <ul className="font-list" aria-label="Your fonts">
        {custom.map((c) => {
          const active = font.kind === "custom" && font.key === c.key;
          return (
            <li key={c.key}>
              <button className={`font-item${active ? " active" : ""}`} aria-pressed={active} onClick={() => setFont({ kind: "custom", key: c.key })}>
                <span>{c.name}</span>
                <span className="small muted">uploaded</span>
              </button>
              <button
                className="icon"
                aria-label={`Remove ${c.name}`}
                onClick={() => {
                  void services.removeCustom(c.key).then(async () => {
                    setCustom(await services.listCustom());
                    if (font.kind === "custom" && font.key === c.key) setFont({ kind: "builtin", id: "geneva_simple" });
                  });
                }}
              >
                x
              </button>
            </li>
          );
        })}
      </ul>
      <input ref={file} type="file" accept=".ttf,.otf,.ttc,font/ttf,font/otf,font/collection" hidden aria-label="Upload a font file" onChange={(e) => void upload(e.target.files?.[0])} />
      <button onClick={() => file.current?.click()}>Upload font (TTF, OTF, TTC)...</button>
      <span className="muted small">Custom fonts are auto-converted to satin columns and sew best above 6 mm.</span>
    </aside>
  );
}
