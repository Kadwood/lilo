import { useEffect, useMemo, useRef, useState } from "react";
import {
  addEntry,
  addFromCatalogue,
  exportShelf,
  identifySpool,
  importShelf,
  listBrands,
  mergeShelves,
  removeEntry,
  search,
  shelfKey,
  updateEntry,
  type SpoolCandidate,
  type ThreadEntry,
} from "@lilo/engine/light";
import { getPlatform } from "../platform";
import { loadShelf, updateShelf, useShelf } from "../state/shelfStore";
import { brandChartUrl } from "../threads/charts";
import { Section } from "./controls";

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "heic"];
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const label = (t: { brand: string; line?: string; code: string }) => `${t.brand}${t.line ? ` ${t.line}` : ""} ${t.code}`;

/**
 * My Threads: the spools you own. Add from the catalogue, from a photo of the label, or by hand;
 * set how many you have and notes; back the shelf up as JSON. Colour snapping in Auto digitize can
 * prefer these spools ("Use my threads").
 */
export function ShelfPanel() {
  const { shelf, error } = useShelf();
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  useEffect(() => void loadShelf(), []);

  const guard = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      setNote({ kind: "error", text: msg(e) });
    }
  };

  const exportJson = () =>
    guard(async () => {
      const saved = await getPlatform().saveFile("my-threads.json", new TextEncoder().encode(exportShelf(shelf)));
      if (saved) setNote({ kind: "ok", text: `Saved ${saved}` });
    });
  const importJson = () =>
    guard(async () => {
      const f = await getPlatform().openFile({ extensions: ["json"] });
      if (!f) return;
      const incoming = importShelf(new TextDecoder().decode(f.bytes));
      await updateShelf((s) => mergeShelves(s, incoming));
      setNote({ kind: "ok", text: `Added ${incoming.entries.length} spool${incoming.entries.length === 1 ? "" : "s"} from ${f.name}.` });
    });

  return (
    <div className="shelf" aria-label="My Threads">
      <p className="muted small">The spools you own. Auto digitize can match colours to these first.</p>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}

      <Section title="Add from the catalogue" help="Search every brand by code or name, for example “madeira 1000” or “navy”." id="shelf-catalogue">
        <CatalogueAdd onNote={setNote} />
      </Section>
      <Section title="Add a spool by photo" help="Photograph the label on the spool. Lilo reads the text and suggests which thread it is; you confirm." open={false} id="shelf-photo">
        <PhotoAdd onNote={setNote} />
      </Section>
      <Section title="Add by hand" help="For a thread that is not in the catalogue: pick its colour yourself." open={false} id="shelf-manual">
        <ManualAdd onNote={setNote} />
      </Section>

      <h2 className="spaced">
        On my shelf <span className="muted">({shelf.entries.length})</span>
      </h2>
      {shelf.entries.length === 0 && <p className="muted small">Nothing yet. Add a spool above.</p>}
      <ul className="shelf-list" aria-label="Spools on my shelf">
        {shelf.entries.map((e) => {
          const key = shelfKey(e);
          return (
            <li key={key} className="shelf-row">
              <span className="swatch" style={{ background: e.hex }} aria-hidden="true" />
              <div className="shelf-text">
                <strong>{label(e)}</strong> <span className="muted">{e.name === `${e.brand} ${e.code}` ? "" : e.name}</span>
                <input
                  className="shelf-notes"
                  aria-label={`Notes for ${label(e)}`}
                  placeholder="Notes"
                  defaultValue={e.notes ?? ""}
                  onBlur={(ev) => {
                    if (ev.target.value !== (e.notes ?? "")) void updateShelf((s) => updateEntry(s, key, { notes: ev.target.value }));
                  }}
                  onKeyDown={(ev) => ev.key === "Enter" && (ev.target as HTMLInputElement).blur()}
                />
              </div>
              <label className="shelf-qty">
                <span className="sr-only">Quantity of {label(e)}</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  aria-label={`Quantity of ${label(e)}`}
                  value={e.qty ?? 1}
                  onChange={(ev) => {
                    const q = Number(ev.target.value);
                    if (Number.isFinite(q) && q >= 0) void updateShelf((s) => updateEntry(s, key, { qty: Math.round(q) }));
                  }}
                />
              </label>
              <button className="icon" aria-label={`Remove ${label(e)}`} title="Remove from my shelf" onClick={() => void updateShelf((s) => removeEntry(s, key))}>
                ✕
              </button>
            </li>
          );
        })}
      </ul>

      <div className="button-row">
        <button onClick={() => void importJson()}>Import JSON…</button>
        <button onClick={() => void exportJson()} disabled={shelf.entries.length === 0}>
          Export JSON…
        </button>
      </div>
      {note && (
        <p className={note.kind === "error" ? "error small" : "muted small"} role={note.kind === "error" ? "alert" : "status"}>
          {note.text}
        </p>
      )}
    </div>
  );
}

type Note = { kind: "ok" | "error"; text: string } | null;

function CatalogueAdd({ onNote }: { onNote: (n: Note) => void }) {
  const { shelf } = useShelf();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ThreadEntry[] | null>(null);
  const have = useMemo(() => new Set(shelf.entries.map(shelfKey)), [shelf]);

  useEffect(() => {
    if (!query.trim()) {
      setHits(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => void search(query, { limit: 20 }).then((r) => live && setHits(r)).catch(() => live && setHits([])), 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [query]);

  return (
    <div className="shelf-add">
      <input type="search" aria-label="Search the catalogue to add a spool" placeholder="Brand, code or name" value={query} onChange={(e) => setQuery(e.target.value)} />
      {hits?.length === 0 && (
        <p className="muted small">
          Not in the catalogue.{" "}
          <button className="link-button" onClick={() => void getPlatform().openUrl(brandChartUrl(query.trim().split(/\s+/)[0], undefined, undefined))}>
            Search online
          </button>{" "}
          or add it by hand.
        </p>
      )}
      <ul className="shelf-hits" aria-label="Catalogue results">
        {(hits ?? []).map((t) => {
          const owned = have.has(shelfKey(t));
          return (
            <li key={`${t.line}|${t.code}|${t.brand}`} className="shelf-row">
              <span className="swatch" style={{ background: t.hex }} aria-hidden="true" />
              <div className="shelf-text">
                <strong>{label(t)}</strong> <span className="muted">{t.name}</span>
              </div>
              <button
                aria-label={`Add ${label(t)}`}
                onClick={() =>
                  void updateShelf((s) => addFromCatalogue(s, t, { qty: 1 })).then(() => onNote({ kind: "ok", text: `${label(t)} ${owned ? "quantity raised" : "added to My Threads"}.` }))
                }
              >
                {owned ? "+1" : "Add"}
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ManualAdd({ onNote, initial }: { onNote: (n: Note) => void; initial?: { brand?: string; code?: string; line?: string } }) {
  const brands = useMemo(() => listBrands().map((b) => b.brand), []);
  const [brand, setBrand] = useState(initial?.brand ?? "");
  const [line, setLine] = useState(initial?.line ?? "");
  const [code, setCode] = useState(initial?.code ?? "");
  const [name, setName] = useState("");
  const [hex, setHex] = useState("#2f5fd0");
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    setError(null);
    try {
      await updateShelf((s) => addEntry(s, { brand, line, code, name, hex, qty, notes, source: "manual" }));
      onNote({ kind: "ok", text: `${label({ brand, code })} added to My Threads.` });
      setCode("");
      setName("");
      setNotes("");
    } catch (e) {
      setError(msg(e));
    }
  };

  return (
    <form
      className="shelf-manual"
      onSubmit={(e) => {
        e.preventDefault();
        void add();
      }}
    >
      <label className="field-line">
        <span className="field-label">Brand</span>
        <input list="shelf-brands" aria-label="Brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
      </label>
      <datalist id="shelf-brands">
        {brands.map((b) => (
          <option key={b} value={b} />
        ))}
      </datalist>
      <label className="field-line">
        <span className="field-label">Line</span>
        <input aria-label="Line" placeholder="optional" value={line} onChange={(e) => setLine(e.target.value)} />
      </label>
      <label className="field-line">
        <span className="field-label">Code</span>
        <input aria-label="Code" value={code} onChange={(e) => setCode(e.target.value)} />
      </label>
      <label className="field-line">
        <span className="field-label">Name</span>
        <input aria-label="Name" placeholder="optional" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field-line">
        <span className="field-label">Colour</span>
        <input type="color" aria-label="Colour" value={hex} onChange={(e) => setHex(e.target.value)} />
        <code className="muted small">{hex}</code>
      </label>
      <label className="field-line">
        <span className="field-label">How many</span>
        <input type="number" min={0} step={1} aria-label="How many" value={qty} onChange={(e) => setQty(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
      </label>
      <label className="field-line">
        <span className="field-label">Notes</span>
        <input aria-label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {error && (
        <p className="error small" role="alert">
          {error}
        </p>
      )}
      <button type="submit" className="primary">
        Add to My Threads
      </button>
    </form>
  );
}

type PhotoState =
  | { kind: "idle" }
  | { kind: "reading"; name: string }
  | { kind: "error"; text: string }
  | { kind: "done"; name: string; preview: string; text: string[]; candidates: SpoolCandidate[] };

/** Photo to spool: OCR the label, rank the guesses, let the user confirm one. */
export function PhotoAdd({ onNote }: { onNote: (n: Note) => void }) {
  const [state, setState] = useState<PhotoState>({ kind: "idle" });
  const [chosen, setChosen] = useState(0);
  const [qty, setQty] = useState(1);
  const [manual, setManual] = useState<{ brand: string; code: string } | null>(null);
  const [over, setOver] = useState(false);
  const preview = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (preview.current) URL.revokeObjectURL(preview.current);
    },
    [],
  );

  const read = async (name: string, bytes: Uint8Array) => {
    setState({ kind: "reading", name });
    setManual(null);
    setChosen(0);
    try {
      const lines = await getPlatform().ocrImage(bytes);
      const candidates = await identifySpool(lines);
      if (preview.current) URL.revokeObjectURL(preview.current);
      preview.current = URL.createObjectURL(new Blob([bytes as BlobPart]));
      setState({ kind: "done", name, preview: preview.current, text: lines.map((l) => l.text), candidates });
    } catch (e) {
      const m = msg(e);
      setState({ kind: "error", text: m.startsWith("unsupported") ? "Reading a label from a photo needs the Lilo desktop app on a Mac. You can still add the spool by code or by hand." : `Could not read that photo: ${m}` });
    }
  };

  const pickFile = async () => {
    try {
      const f = await getPlatform().openFile({ extensions: IMAGE_EXTENSIONS });
      if (f) await read(f.name, f.bytes);
    } catch (e) {
      setState({ kind: "error", text: msg(e) });
    }
  };

  const confirm = async (c: SpoolCandidate) => {
    if (!c.entry) {
      setManual({ brand: c.brand, code: c.code });
      return;
    }
    const entry = c.entry;
    await updateShelf((s) => addFromCatalogue(s, entry, { qty }));
    onNote({ kind: "ok", text: `${label(entry)} added to My Threads.` });
    setState({ kind: "idle" });
  };

  return (
    <div
      className={`photo-add${over ? " over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) void f.arrayBuffer().then((b) => read(f.name, new Uint8Array(b)));
      }}
    >
      <button onClick={() => void pickFile()}>Choose a photo…</button>
      <span className="muted small"> or drop one here</span>

      {state.kind === "reading" && (
        <p className="muted small" role="status">
          Reading {state.name}…
        </p>
      )}
      {state.kind === "error" && (
        <p className="error small" role="alert">
          {state.text}
        </p>
      )}
      {state.kind === "done" && (
        <div className="photo-result">
          <img src={state.preview} alt={`Photo of ${state.name}`} className="photo-thumb" />
          {state.candidates.length === 0 ? (
            <p className="muted small" role="status">
              Nothing that looks like a thread code was found. Add it by code or by hand.
            </p>
          ) : (
            <>
              <p className="small" id="candidates-label">
                Which one is it?
              </p>
              <ul className="candidates" role="radiogroup" aria-labelledby="candidates-label">
                {state.candidates.map((c, i) => (
                  <li key={`${c.brand}|${c.line}|${c.code}`}>
                    <label className={`candidate${chosen === i ? " selected" : ""}`} title={c.reasons.join(", ")}>
                      <input type="radio" name="spool-candidate" checked={chosen === i} onChange={() => setChosen(i)} />
                      <span className="swatch" style={{ background: c.entry?.hex ?? "transparent" }} aria-hidden="true">
                        {c.entry ? "" : "?"}
                      </span>
                      <span className="shelf-text">
                        <strong>{c.brand ? label({ brand: c.brand, line: c.line, code: c.code }) : `Code ${c.code}`}</strong> <span className="muted">{c.entry?.name ?? "not in the catalogue"}</span>
                      </span>
                      <span className="muted small">{Math.round(c.confidence * 100)}%</span>
                    </label>
                  </li>
                ))}
              </ul>
              <label className="field-line">
                <span className="field-label">How many</span>
                <input type="number" min={0} step={1} aria-label="How many spools" value={qty} onChange={(e) => setQty(Math.max(0, Math.round(Number(e.target.value) || 0)))} />
              </label>
              <button className="primary" onClick={() => void confirm(state.candidates[chosen])}>
                {state.candidates[chosen]?.entry ? "Add this spool" : "Pick its colour…"}
              </button>
            </>
          )}
          <details className="small">
            <summary>Text found on the label</summary>
            <p className="muted">{state.text.join(" · ") || "(none)"}</p>
          </details>
        </div>
      )}
      {manual && <ManualAdd key={`${manual.brand}|${manual.code}`} initial={manual} onNote={(n) => (setManual(null), setState({ kind: "idle" }), onNote(n))} />}
    </div>
  );
}
