import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import {
  CATALOGUES,
  DEFAULT_CATALOGUE_ID,
  DEFAULT_HOOP,
  MAX_GRID_SIZE,
  linesOfBrand,
  listBrands,
  loadLine,
  pixelArtFromImage,
  shelfPalette,
  snapPalette,
  toDesignThread,
  usedPixelThreads,
  type PixelStyle,
  type Thread,
  type ThreadEntry,
} from "@lilo/engine/light";
import { PlayerController } from "../state/player";
import { useEngine } from "../engine/context";
import type { PlanResult } from "../engine/client";
import { decodeFile } from "../io/decode";
import { Segmented, Toggle } from "../panels/controls";
import { StitchPlayerBar } from "../panels/StitchPlayer";
import { ThreadPicker } from "../panels/ThreadPicker";
import { getPlatform } from "../platform";
import { ExportPanel, type Prepare } from "../shell/ExportDialog";
import { PIXEL_TOOLS, pixel, usePixel } from "../state/pixelStore";
import { lineCells, rectCells, type Cell } from "../state/pixelShapes";
import { loadShelf, useShelf } from "../state/shelfStore";
import { useEditor } from "../state/store";
import { useApp } from "./AppContext";
import { sendPixelToEditor } from "./pixelSend";
import { PixelCanvas } from "./PixelCanvas";
import { PlanPreview } from "./PlanPreview";

const STYLES: { id: PixelStyle; label: string; help: string }[] = [
  { id: "tatami", label: "Tatami", help: "Each cell a block of fill rows." },
  { id: "cross", label: "Cross", help: "An X in each cell." },
  { id: "satin", label: "Satin", help: "A satin bar across each cell." },
];

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
const PALETTE_MAX = 160;
const MAX_CELL_PX = 28;

/** Pixel art (spec 4.7): paint a grid with threads, see the stitches live, send it to the editor or export it. */
export function PixelView() {
  const engine = useEngine();
  const app = useApp();
  const { state: editor, actions: editorActions } = useEditor();
  const { shelf } = useShelf();
  const px = usePixel();
  const { art } = px;
  const hoop = editor.design?.hoop ?? DEFAULT_HOOP;

  useEffect(() => void loadShelf(), []);

  // ---- canvas size and gesture ----------------------------------------------------------------
  const stage = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 640, h: 560 });
  useEffect(() => {
    const el = stage.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth || 640, h: el.clientHeight || 560 });
    return () => ro.disconnect();
  }, []);
  const cellPx = Math.max(4, Math.min(MAX_CELL_PX, Math.floor(Math.min((box.w - 24) / art.width, (box.h - 24) / art.height))));

  const [cursor, setCursor] = useState<Cell>([0, 0]);
  const anchor = useRef<Cell | null>(null);
  const last = useRef<Cell | null>(null);
  const [preview, setPreview] = useState<Cell[]>([]);
  const erasing = px.tool === "erase";
  const colour = px.threadId ? (art.threads.find((t) => t.id === px.threadId)?.hex ?? null) : null;

  const shapeCells = (a: Cell, b: Cell): Cell[] => (px.tool === "line" ? lineCells(a[0], a[1], b[0], b[1]) : rectCells(a[0], a[1], b[0], b[1], px.rectFilled));

  const needsColour = px.tool !== "erase" && px.tool !== "eyedropper" && !px.threadId;
  const [hint, setHint] = useState<string | null>(null);
  const noColour = () => {
    setHint("Pick a colour first: a thread in the palette on the left.");
    return true;
  };

  const down = (cell: Cell, e: PointerEvent) => {
    setCursor(cell);
    setHint(null);
    if (e.button !== 0) return;
    if (needsColour && noColour()) return;
    switch (px.tool) {
      case "pencil":
      case "erase":
        pixel.actions.beginStroke(px.tool === "erase" ? "Erase" : "Draw");
        pixel.actions.paintCells([cell], erasing);
        last.current = cell;
        break;
      case "fill":
        pixel.actions.fill(cell[0], cell[1]);
        break;
      case "eyedropper":
        if (pixel.actions.eyedrop(cell[0], cell[1])) pixel.actions.setTool("pencil");
        break;
      case "line":
      case "rect":
        anchor.current = cell;
        setPreview(shapeCells(cell, cell));
        break;
    }
  };
  const move = (cell: Cell) => {
    if (cell[0] !== cursor[0] || cell[1] !== cursor[1]) setCursor(cell);
    if ((px.tool === "pencil" || px.tool === "erase") && last.current) {
      const from = last.current;
      if (from[0] === cell[0] && from[1] === cell[1]) return;
      pixel.actions.paintCells(lineCells(from[0], from[1], cell[0], cell[1]), erasing);
      last.current = cell;
    } else if (anchor.current) setPreview(shapeCells(anchor.current, cell));
  };
  const up = (cell: Cell) => {
    if (last.current) {
      last.current = null;
      pixel.actions.endStroke();
    }
    if (anchor.current) {
      const from = anchor.current;
      anchor.current = null;
      setPreview([]);
      if (px.tool === "line") pixel.actions.line(from, cell);
      else if (px.tool === "rect") pixel.actions.rect(from, cell);
    }
  };
  const activate = (cell: Cell) => {
    if (needsColour && noColour()) return;
    switch (px.tool) {
      case "pencil":
      case "erase":
        pixel.actions.beginStroke(px.tool === "erase" ? "Erase" : "Draw");
        pixel.actions.paintCells([cell], erasing);
        pixel.actions.endStroke();
        break;
      case "fill":
        pixel.actions.fill(cell[0], cell[1]);
        break;
      case "eyedropper":
        if (pixel.actions.eyedrop(cell[0], cell[1])) pixel.actions.setTool("pencil");
        break;
      case "line":
      case "rect":
        // first press anchors, second finishes
        if (!anchor.current) {
          anchor.current = cell;
          setPreview(shapeCells(cell, cell));
        } else {
          up(cell);
        }
        break;
    }
  };

  // ---- keyboard -------------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "z") {
        e.preventDefault();
        if (e.shiftKey) pixel.actions.redo();
        else pixel.actions.undo();
        return;
      }
      if (mod || e.altKey) return;
      if (k === "escape" && anchor.current) {
        anchor.current = null;
        setPreview([]);
        e.preventDefault();
        return;
      }
      const t = PIXEL_TOOLS.find((x) => x.key === k);
      if (t) pixel.actions.setTool(t.id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // ---- the stitches, live ---------------------------------------------------------------------
  const player = useMemo(() => new PlayerController(), []);
  const [result, setResult] = useState<PlanResult | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      engine
        .call("pixelPlan", art, hoop, {})
        .then((r) => {
          if (!alive) return;
          setResult(r);
          setPlanError(null);
          player.setPlan(r.plan);
        })
        .catch((e) => alive && setPlanError(e instanceof Error ? e.message : String(e)));
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [engine, art, hoop, player]);

  // ---- palette --------------------------------------------------------------------------------
  const [source, setSource] = useState<"mine" | "brand">("brand");
  const brands = useMemo(() => listBrands(), []);
  const [brand, setBrand] = useState("Brother");
  const [lineId, setLineId] = useState(DEFAULT_CATALOGUE_ID);
  const [loaded, setLoaded] = useState<Record<string, ThreadEntry[]>>({});
  const [pickAny, setPickAny] = useState(false);
  const lines = useMemo(() => linesOfBrand(brand), [brand]);
  useEffect(() => {
    if (CATALOGUES.some((c) => c.id === lineId) || loaded[lineId]) return;
    let live = true;
    void loadLine(lineId).then((c) => live && setLoaded((p) => ({ ...p, [lineId]: c.threads })));
    return () => {
      live = false;
    };
  }, [lineId, loaded]);
  const brandThreads: ThreadEntry[] = CATALOGUES.find((c) => c.id === lineId)?.threads ?? loaded[lineId] ?? [];
  const palette: ThreadEntry[] = source === "mine" ? shelfPalette(shelf) : brandThreads;
  const used = useMemo(() => usedPixelThreads(art), [art]);
  const pickEntry = (e: ThreadEntry) => pixel.actions.setThread(toDesignThread(e));

  // ---- picture, size, actions -----------------------------------------------------------------
  const message = px.message;
  const setMessage = pixel.actions.setMessage;
  const [maxColours, setMaxColours] = useState(8);
  const [keepBackground, setKeepBackground] = useState(false);
  const [w, setW] = useState(String(art.width));
  const [h, setH] = useState(String(art.height));
  useEffect(() => {
    setW(String(art.width));
    setH(String(art.height));
  }, [art.width, art.height]);

  const importPicture = async () => {
    try {
      const f = await getPlatform().openFile({ extensions: ["png", "jpg", "jpeg", "webp"] });
      if (!f) return;
      const d = await decodeFile({ name: f.name, bytes: f.bytes });
      if (d.kind !== "raster") throw new Error("Pick a PNG, JPG or WEBP picture.");
      const threads = source === "mine" && shelf.entries.length > 0 ? snapPalette(shelf, brandThreads) : brandThreads;
      if (threads.length === 0) throw new Error("The palette is still loading. Try again in a moment.");
      const next = pixelArtFromImage(d.image, { palette: threads, maxCells: Math.max(art.width, art.height), maxColors: maxColours, removeBackground: !keepBackground, cellMm: art.cellMm, style: art.style });
      pixel.actions.replace(next, "Import picture");
      setMessage({ kind: "ok", text: `Made a ${next.width} × ${next.height} grid in ${next.threads.length} colour${next.threads.length === 1 ? "" : "s"} from ${f.name}.` });
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };

  const resize = () => {
    const nw = Math.round(Number(w));
    const nh = Math.round(Number(h));
    if (!(nw >= 1 && nh >= 1 && nw <= MAX_GRID_SIZE && nh <= MAX_GRID_SIZE)) {
      setMessage({ kind: "error", text: `The grid is 1 to ${MAX_GRID_SIZE} cells on each side.` });
      return;
    }
    setMessage(null);
    pixel.actions.resize(nw, nh);
  };

  const sendToEditor = async () => {
    if (await sendPixelToEditor(engine, editorActions, hoop)) app.go("editor");
  };

  const prepare: Prepare = async (format, origin, label) => {
    if (format === "png") {
      const r = await engine.call("pixelImage", art, hoop, {}, 1600);
      return { bytes: r.bytes, pes: r.bytes, stats: r.stats, warnings: r.warnings };
    }
    const r = await engine.call("pixelExport", art, format, hoop, { origin, label });
    return { bytes: r.bytes, pes: r.bytes, stats: r.stats, warnings: r.warnings };
  };

  const empty = used.length === 0;
  const widthMm = art.width * art.cellMm;
  const heightMm = art.height * art.cellMm;

  return (
    <div className="pixel-view" aria-label="Pixel art">
      <aside className="panel panel-left" aria-label="Pixel art tools">
        <h2>Pixel art</h2>
        <div className="pixel-tools" role="toolbar" aria-label="Pixel tools">
          {PIXEL_TOOLS.map((t) => (
            <button key={t.id} className={px.tool === t.id ? "active" : ""} aria-pressed={px.tool === t.id} title={`${t.label} (${t.key.toUpperCase()}): ${t.help}`} onClick={() => pixel.actions.setTool(t.id)}>
              {t.label}
              <kbd>{t.key.toUpperCase()}</kbd>
            </button>
          ))}
        </div>
        {px.tool === "rect" && <Toggle label="Filled rectangles" checked={px.rectFilled} onChange={pixel.actions.setRectFilled} />}
        <div className="button-row">
          <button onClick={pixel.actions.undo} disabled={px.undoDepth === 0} title={px.undoLabel ? `Undo ${px.undoLabel} (⌘Z)` : "Undo (⌘Z)"}>
            Undo
          </button>
          <button onClick={pixel.actions.redo} disabled={px.redoDepth === 0} title="Redo (⇧⌘Z)">
            Redo
          </button>
          <button onClick={pixel.actions.clear} disabled={empty}>
            Clear
          </button>
        </div>

        <h2 className="spaced">Colour</h2>
        <div className="colour-current static">
          <span className="swatch" style={{ background: colour ?? "transparent" }} aria-hidden="true" />
          <span>{px.threadId ? (art.threads.find((t) => t.id === px.threadId)?.name ?? "") : "No colour chosen"}</span>
        </div>
        <Segmented
          label="Palette"
          value={source}
          options={[
            { id: "brand", label: "Brand" },
            { id: "mine", label: `My Threads (${shelf.entries.length})` },
          ]}
          onChange={setSource}
        />
        {source === "brand" && (
          <div className="thread-picker-bar">
            <select
              aria-label="Palette brand"
              value={brand}
              onChange={(e) => {
                setBrand(e.target.value);
                const first = linesOfBrand(e.target.value)[0];
                if (first) setLineId(first.id);
              }}
            >
              {brands.map((b) => (
                <option key={b.brand} value={b.brand}>
                  {b.brand}
                </option>
              ))}
            </select>
            {lines.length > 1 && (
              <select aria-label="Palette line" value={lineId} onChange={(e) => setLineId(e.target.value)}>
                {lines.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.line}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}
        {source === "mine" && shelf.entries.length === 0 && <p className="muted small">Your shelf is empty. Add spools in the editor (Sequencer, Threads tab), or use a brand palette.</p>}
        <div className="thread-grid pixel-palette" role="group" aria-label="Palette colours">
          {palette.slice(0, PALETTE_MAX).map((e) => {
            const id = toDesignThread(e).id;
            return <button key={`${e.line}|${e.code}`} className={`thread-swatch${px.threadId === id ? " active" : ""}`} style={{ background: e.hex }} title={`${e.brand} ${e.code} ${e.name}`} aria-label={`${e.brand} ${e.code} ${e.name}`} onClick={() => pickEntry(e)} />;
          })}
        </div>
        <button className="link-button" onClick={() => setPickAny((v) => !v)} aria-expanded={pickAny}>
          {pickAny ? "Hide the full thread list" : "Any thread, any brand…"}
        </button>
        {pickAny && <ThreadPicker current={px.threadId ?? undefined} onPick={(t: Thread) => pixel.actions.setThread(t)} />}
        {used.length > 0 && (
          <>
            <p className="muted small">In this picture</p>
            <ul className="pixel-used" aria-label="Colours in the picture">
              {used.map(({ thread, cells }) => (
                <li key={thread.id}>
                  <button className={px.threadId === thread.id ? "active" : ""} onClick={() => pixel.actions.selectThread(thread.id)} title={`${thread.brand} ${thread.code} ${thread.name}`}>
                    <span className="swatch small" style={{ background: thread.hex }} aria-hidden="true" />
                    <span>
                      {thread.code} {thread.name}
                    </span>
                    <span className="muted small">{cells}</span>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <h2 className="spaced">Grid</h2>
        <div className="size-row">
          <input type="number" min={1} max={MAX_GRID_SIZE} aria-label="Grid width in cells" value={w} onChange={(e) => setW(e.target.value)} onKeyDown={(e) => e.key === "Enter" && resize()} />
          <span aria-hidden="true">×</span>
          <input type="number" min={1} max={MAX_GRID_SIZE} aria-label="Grid height in cells" value={h} onChange={(e) => setH(e.target.value)} onKeyDown={(e) => e.key === "Enter" && resize()} />
          <button onClick={resize}>Resize</button>
        </div>
        <label className="inline-field">
          <span className="field-label">Cell size</span>
          <input
            type="number"
            min={0.6}
            max={10}
            step={0.1}
            aria-label="Cell size in millimetres"
            value={art.cellMm}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v > 0.5 && v <= 10) pixel.actions.setCellMm(v);
            }}
          />
          <span className="muted small">mm</span>
        </label>
        <p className="muted small">
          Stitched size {widthMm.toFixed(1)} × {heightMm.toFixed(1)} mm
          {widthMm > hoop.widthMm || heightMm > hoop.heightMm ? " (bigger than the hoop)" : ""}
        </p>
        <Segmented label="Stitch style" value={art.style} options={STYLES} onChange={pixel.actions.setStyle} />

        <h2 className="spaced">From a picture</h2>
        <label className="inline-field">
          <span className="field-label">Colours</span>
          <input type="number" min={1} max={16} aria-label="Most colours" value={maxColours} onChange={(e) => setMaxColours(Math.max(1, Math.min(16, Math.round(Number(e.target.value) || 1))))} />
        </label>
        <Toggle label="Keep the background" checked={keepBackground} onChange={setKeepBackground} />
        <button onClick={() => void importPicture()}>Import a picture…</button>
        <p className="muted small">The picture is shrunk to the grid and its colours snapped to the palette above.</p>
        {message && (
          <p className={message.kind === "error" ? "error small" : "muted small"} role={message.kind === "error" ? "alert" : "status"}>
            {message.text}
          </p>
        )}
      </aside>

      <main className="pixel-stage" ref={stage}>
        {hint && (
          <p className="canvas-hint" role="alert">
            {hint}
          </p>
        )}
        <PixelCanvas art={art} preview={preview} previewHex={erasing ? null : colour} cursor={cursor} cellPx={cellPx} onDown={down} onMove={move} onUp={up} onCursor={setCursor} onActivate={activate} />
      </main>

      <aside className="panel panel-right pixel-preview" aria-label="Stitch preview">
        <h2>Stitch preview</h2>
        <PlanPreview plan={result?.plan ?? null} player={player} label="Stitch preview of the pixel art" />
        {planError && (
          <p className="error small" role="alert">
            {planError}
          </p>
        )}
        <StitchPlayerBar player={player} planResult={result && result.stats.stitchCount > 0 ? result : null} emptyText="Paint some cells to see the stitches." />
        {result && result.warnings.filter((x) => x.code !== "empty").length > 0 && (
          <ul className="warnings" aria-label="Warnings">
            {result.warnings
              .filter((x) => x.code !== "empty")
              .map((x, i) => (
                <li key={i}>{x.message}</li>
              ))}
          </ul>
        )}
        <div className="button-row">
          <button className="primary" disabled={empty} onClick={() => void sendToEditor()} title="Add the stitches to the design in the editor">
            Send to editor
          </button>
          <button disabled={empty} onClick={() => pixel.actions.setExportOpen(true)}>
            Export…
          </button>
        </div>
      </aside>

      {px.exportOpen && (
        <ExportPanel
          defaultName={`${editor.projectName === "Untitled design" ? "pixel-art" : editor.projectName}`}
          objects={used.length}
          prepare={prepare}
          deps={[engine, art, hoop]}
          onClose={() => pixel.actions.setExportOpen(false)}
          onSaved={(m) => setMessage({ kind: "ok", text: m })}
        />
      )}
    </div>
  );
}
