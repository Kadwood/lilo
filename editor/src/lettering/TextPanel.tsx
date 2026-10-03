import { useEffect, useMemo, useRef, useState } from "react";
import type { FontIndexEntry, TextAlign } from "@lilo/engine/lettering";
import { letterHeightWarning, minLetterHeightFor } from "@lilo/engine/light";
import { useSewing } from "../sewing/useSewing";
import { DimensionsSection } from "../panels/DimensionsSection";
import { Hint } from "../guide/Hint";
import { ThreadPicker } from "../panels/ThreadPicker";
import { nextTextGroup, textThread, useTextTarget } from "./adapter";
import { defaultServices, type CustomFontInfo, type FontRef, type LetteringServices } from "./fonts";
import "./lettering.css";

const PRESETS = [6, 10, 15, 25];
const fmt = (n: number) => String(Math.round(n * 10) / 10);

/** Warning text for a font at a height, or null. Mirrors the engine's own guard. */
export function heightWarning(font: { kind: "builtin"; entry: FontIndexEntry } | { kind: "custom"; name: string }, heightMm: number, threadWeight: 40 | 60 = 40): string | null {
  if (font.kind === "custom") {
    const min = minLetterHeightFor(threadWeight);
    return heightMm < min ? `Custom fonts sew best above ${min} mm. Try a built-in font.` : null;
  }
  const { minHeightMm, maxHeightMm, name } = font.entry;
  if (heightMm < minHeightMm) return `${name} is designed for ${fmt(minHeightMm)}-${fmt(maxHeightMm)} mm letters. At ${fmt(heightMm)} mm it will sew poorly. Try a smaller font.`;
  if (heightMm > maxHeightMm) return `${name} is designed for ${fmt(minHeightMm)}-${fmt(maxHeightMm)} mm letters. At ${fmt(heightMm)} mm it will look sparse.`;
  return null;
}

/**
 * The Text tool's panel (left, in place of the settings panel). With nothing text selected it adds a
 * new word, centred where you clicked; with a word selected it edits that word and re-lays it out
 * in place. Either way the change is one undo step.
 */
export function TextPanel({ services = defaultServices }: { services?: LetteringServices }) {
  const { design, insert, replace, editing, anchor, threadId, startNew, actions } = useTextTarget();
  const sewing = useSewing();
  const [pickColour, setPickColour] = useState(false);
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
    void services
      .loadIndex()
      .then((i) => live && setIndex(i))
      .catch((e) => live && setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) }));
    void services
      .listCustom()
      .then((c) => live && setCustom(c))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [services]);

  // Opening a word (or switching to another) loads its settings into the form.
  const editKey = editing?.id ?? null;
  useEffect(() => {
    if (!editing) return;
    setText(editing.text);
    setHeight(editing.heightMm);
    setSpacing(editing.letterSpacingMm);
    setLineSpacing(editing.lineSpacing);
    setAlign(editing.align);
    setFont(editing.fontId.startsWith("custom:") ? { kind: "custom", key: editing.fontId.slice(7) } : { kind: "builtin", id: editing.fontId });
    setMessage(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editKey]);

  const selected = useMemo(() => {
    if (font.kind === "builtin") {
      const entry = index.find((f) => f.id === font.id);
      return entry ? ({ kind: "builtin", entry } as const) : null;
    }
    const c = custom.find((f) => f.key === font.key);
    return c ? ({ kind: "custom", name: c.name } as const) : null;
  }, [font, index, custom]);

  const warning = selected ? heightWarning(selected, height, sewing.threadWeight) : null;
  // too small for the thread in the Sewing setup (any font); a custom font's own warning already says so
  const smallWarning = selected?.kind === "custom" ? null : letterHeightWarning(height, sewing.threadWeight);
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
      const thread = textThread(design, threadId);
      const group = editing ? editing.id : nextTextGroup(design);
      const fontId = font.kind === "builtin" ? font.id : `custom:${font.key}`;
      const r = await services.layout({ text, font, heightMm: height, letterSpacingMm: spacing, lineSpacing, align, threadId: thread.id, idPrefix: group, sewing: { quality: sewing.quality, threadWeight: sewing.threadWeight } });
      if (r.objects.length === 0) {
        setMessage({ kind: "error", text: r.warnings[0]?.message ?? "Nothing to stitch." });
        return;
      }
      const block = { id: group, text, fontId, heightMm: height, letterSpacingMm: spacing, lineSpacing, align };
      if (editing) replace(group, r, block);
      else insert(r, block, thread);
      const notes = r.warnings.filter((w) => w.code === "missing-glyph" || w.code === "text-longer-than-path").map((w) => w.message);
      if (notes.length) setMessage({ kind: "info", text: notes.join(" ") });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="panel panel-left panel-text" aria-label="Text" data-tour="settings-panel">
      <h2>{editing ? "Edit text" : "Text"}</h2>
      {!editing && <p className="muted small">{anchor ? "New text goes where you clicked." : "Click the canvas to place text, or just add it."}</p>}
      {editing && (
        <>
          <DimensionsSection />
          <div className="field">
            <button className="colour-current" onClick={() => setPickColour((v) => !v)} aria-expanded={pickColour}>
              <span className="swatch" style={{ background: design?.threads.find((t) => t.id === design.objects.find((o) => o.sourceText?.group === editing.id)?.threadId)?.hex }} aria-hidden="true" />
              <span>Text colour</span>
            </button>
            {pickColour && (
              <ThreadPicker
                onPick={(t) => {
                  actions.setObjectThread(design!.objects.filter((o) => o.sourceText?.group === editing.id).map((o) => o.id), t);
                  setPickColour(false);
                }}
              />
            )}
          </div>
        </>
      )}

      <label className="field" data-tour="text-input">
        <span className="field-row">
          Text <Hint id="text.text" />
        </span>
        <textarea aria-label="Text to stitch" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
      </label>

      <div className="field" data-tour="text-height">
        <span className="field-row">
          Height (mm) <Hint id="text.height" /> <Hint id="text.height-presets" />
        </span>
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
        {smallWarning && (
          <span className="badge warn" role="status" data-testid="small-letters-warning">
            {smallWarning}
          </span>
        )}
      </div>

      <label className="field">
        <span className="field-row">
          Letter spacing <output>{fmt(spacing)} mm</output> <Hint id="text.letter-spacing" />
        </span>
        <input type="range" min={-1} max={5} step={0.1} value={spacing} aria-label="Letter spacing" onChange={(e) => setSpacing(Number(e.target.value))} />
      </label>

      <label className="field">
        <span className="field-row">
          Line spacing <output>{fmt(lineSpacing)}x</output> <Hint id="text.line-spacing" />
        </span>
        <input type="range" min={0.6} max={2} step={0.05} value={lineSpacing} aria-label="Line spacing" onChange={(e) => setLineSpacing(Number(e.target.value))} />
      </label>

      <div className="field">
        <span className="field-row">
          Align <Hint id="text.align" />
        </span>
        <div className="segmented" role="group" aria-label="Alignment">
          {(["left", "center", "right"] as const).map((a) => (
            <button key={a} className={align === a ? "active" : ""} onClick={() => setAlign(a)} aria-pressed={align === a}>
              {a}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <button className="primary" onClick={() => void add()} disabled={busy || !text.trim() || !selected} data-tour="text-add">
          {busy ? "Working..." : editing ? "Update text" : "Add text"}
        </button>
        <Hint id="text.add" />
        {editing && <button onClick={startNew}>New text</button>}
        {message && (
          <span className={message.kind === "error" ? "error small" : "muted small"} role={message.kind === "error" ? "alert" : "status"}>
            {message.text}
          </span>
        )}
      </div>

      <div className="with-hint">
        <h2 className="spaced">Fonts</h2>
        <Hint id="text.fonts" />
      </div>
      <label className="field-row small">
        <input type="checkbox" checked={fitOnly} onChange={(e) => setFitOnly(e.target.checked)} aria-label="Only fonts that suit this height" /> Only fonts for {fmt(height)} mm <Hint id="text.fit-only" />
      </label>

      <ul className="font-list" aria-label="Built-in fonts" data-tour="text-fonts">
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

      <div className="with-hint">
        <h2 className="spaced">Your fonts</h2>
        <Hint id="text.your-fonts" />
      </div>
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
      <div className="with-hint">
        <button onClick={() => file.current?.click()}>Upload font (TTF, OTF, TTC)...</button>
        <Hint id="text.upload-font" />
      </div>
      <span className="muted small">Custom fonts are auto-converted to satin columns and sew best above {minLetterHeightFor(sewing.threadWeight)} mm.</span>
    </aside>
  );
}
