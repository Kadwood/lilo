import { useState } from "react";
import { FORMATS, READABLE_EXTENSIONS } from "@lilo/engine/light";
import { useEngine } from "../engine/context";
import { getPlatform } from "../platform";
import { CONVERTER_EXTENSIONS, targetsFor, type ConvTarget } from "../state/converter";
import { converter, useConverter, type ConvItem } from "../state/converterStore";
import { toEngineOptions } from "../state/editorStore";
import { useEditor } from "../state/store";
import { useApp } from "./AppContext";

const TARGET_ORDER: ConvTarget[] = ["pes", "dst", "jef", "vp3", "exp", "xxx", "u01", "pec", "hus", "vip", "tbf", "gcode", "svg"];
const targetLabel = (t: ConvTarget) => (t === "svg" ? "SVG (traced)" : (FORMATS.find((f) => f.ext === t)?.label ?? t.toUpperCase()));
const sizeLabel = (n: number) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

/**
 * Converter: drop embroidery files or pictures, choose the formats you want, convert, save. Pictures
 * are digitized with the editor's current Auto digitize settings; "PNG to SVG" saves the trace.
 */
export function ConverterView() {
  const engine = useEngine();
  const { state, actions } = useEditor();
  const app = useApp();
  const { items, targets, running } = useConverter();
  const [over, setOver] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const offered = new Set(items.flatMap((i) => targetsFor(i.kind, i.name)));
  const shown = TARGET_ORDER.filter((t) => items.length === 0 || offered.has(t));
  const outputs = items.flatMap((i) => i.outputs.map((o) => ({ ...o, from: i.name })));
  const ready = items.some((i) => i.kind !== "unknown") && targets.some((t) => offered.has(t)) && !running;

  const read = async (files: File[]) => converter.add(await Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) }))));
  const pick = async () => {
    try {
      converter.add(await getPlatform().openFiles({ extensions: CONVERTER_EXTENSIONS }));
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };
  const saveAll = async () => {
    try {
      const where = await getPlatform().saveFilesToFolder(outputs.map((o) => ({ name: o.name, bytes: o.bytes })));
      if (where) setMessage({ kind: "ok", text: `Saved ${outputs.length} file${outputs.length === 1 ? "" : "s"} to ${where}.` });
    } catch (e) {
      setMessage({ kind: "error", text: `Could not save: ${e instanceof Error ? e.message : String(e)}` });
    }
  };
  const saveOne = async (name: string, bytes: Uint8Array) => {
    try {
      const where = await getPlatform().saveFile(name, bytes);
      if (where) setMessage({ kind: "ok", text: `Saved ${where}` });
    } catch (e) {
      setMessage({ kind: "error", text: `Could not save: ${e instanceof Error ? e.message : String(e)}` });
    }
  };
  const openInEditor = async (item: ConvItem) => {
    try {
      const ext = item.name.slice(item.name.lastIndexOf(".") + 1);
      const r = await engine.call("readEmbroidery", item.bytes, ext);
      actions.placeObjects(r.design.objects, r.design.threads, `Import ${item.name}`);
      if (!state.design?.objects.length && (state.projectName === "Untitled design" || state.projectName === "")) actions.setName(item.name.replace(/\.[^.]+$/, ""));
      app.go("editor");
    } catch (e) {
      setMessage({ kind: "error", text: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <div className="screen converter" aria-label="Converter">
      <header className="screen-head">
        <h1>Converter</h1>
        <p className="muted">Change an embroidery file to another format, or turn a picture into stitches or a traced SVG.</p>
      </header>

      <div
        className={`dropzone${over ? " over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void read([...e.dataTransfer.files]);
        }}
      >
        <p className="dropzone-title">Drop files here</p>
        <p className="muted small">{READABLE_EXTENSIONS.map((e) => e.toUpperCase()).join(", ")}, or PNG, JPG, WEBP, SVG</p>
        <button className="primary" onClick={() => void pick()}>
          Choose files…
        </button>
      </div>

      {items.length > 0 && (
        <>
          <ul className="conv-list" aria-label="Files to convert">
            {items.map((i) => (
              <li key={i.id} className={`conv-row ${i.status}`}>
                <div className="conv-main">
                  <strong title={i.name}>{i.name}</strong>
                  <span className="muted small">
                    {i.kind === "embroidery" ? "embroidery file" : i.kind === "image" ? "picture (will be digitized)" : "not supported"} · {sizeLabel(i.bytes.length)}
                  </span>
                  {i.status === "working" && (
                    <span className="small" role="status">
                      Converting…
                    </span>
                  )}
                  {i.status === "error" && (
                    <span className="error small" role="alert">
                      {i.error}
                    </span>
                  )}
                  {i.status === "done" && <span className="small ok">Converted: {i.outputs.map((o) => o.name).join(", ") || "nothing to make for those formats"}</span>}
                </div>
                {i.kind === "embroidery" && (
                  <button onClick={() => void openInEditor(i)} title="Add the stitches to the editor as manual-stitch objects">
                    Open in editor
                  </button>
                )}
                <button className="icon" aria-label={`Remove ${i.name}`} onClick={() => converter.remove(i.id)}>
                  ✕
                </button>
              </li>
            ))}
          </ul>

          <fieldset className="conv-targets">
            <legend>Convert to</legend>
            {shown.map((t) => (
              <label key={t} className="check">
                <input type="checkbox" checked={targets.includes(t)} onChange={() => converter.toggleTarget(t)} /> {t === "svg" ? "SVG (traced picture)" : `${t.toUpperCase()} · ${targetLabel(t)}`}
              </label>
            ))}
          </fieldset>
          {items.some((i) => i.kind === "image") && (
            <p className="muted small">Pictures are digitized with the Auto digitize settings in the editor ({state.options.colors} colours, {state.options.catalogueId.replace(/-/g, " ")}).</p>
          )}

          <div className="button-row">
            <button className="primary" disabled={!ready} onClick={() => void converter.run(engine, toEngineOptions(state.options))}>
              {running ? "Converting…" : "Convert"}
            </button>
            <button onClick={converter.clear} disabled={running}>
              Clear list
            </button>
          </div>
        </>
      )}

      {message && (
        <p className={message.kind === "error" ? "error" : "muted"} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      )}

      {outputs.length > 0 && (
        <section aria-label="Results">
          <h2>Results</h2>
          <ul className="conv-list">
            {outputs.map((o) => (
              <li key={`${o.from}|${o.name}`} className="conv-row done">
                <div className="conv-main">
                  <strong>{o.name}</strong>
                  <span className="muted small">
                    from {o.from} · {sizeLabel(o.bytes.length)}
                  </span>
                  {o.warnings.length > 0 && (
                    <ul className="warnings" aria-label={`Warnings for ${o.name}`}>
                      {o.warnings.map((w, k) => (
                        <li key={k}>{w}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <button onClick={() => void saveOne(o.name, o.bytes)}>Save…</button>
              </li>
            ))}
          </ul>
          <button className="primary" onClick={() => void saveAll()}>
            Save all to a folder…
          </button>
        </section>
      )}
    </div>
  );
}
