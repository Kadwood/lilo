import { useEffect, useMemo, useState } from "react";
import {
  CATALOGUES,
  DEFAULT_CATALOGUE_ID,
  linesOfBrand,
  listBrands,
  loadLine,
  normalizeCode,
  search,
  shelfPalette,
  toDesignThread,
  type Thread,
  type ThreadEntry,
} from "@lilo/engine/light";
import { getPlatform } from "../platform";
import { registerThread } from "../state/editorStore";
import { loadShelf, useShelf } from "../state/shelfStore";
import { brandChartUrl } from "../threads/charts";

const MINE = "*mine";
const EVERYWHERE = "*all";
const ALL_LINES = "*lines";
/** Swatches drawn at once; a line can hold 900 colours and the panel is narrow. */
const SHOW_MAX = 300;

const matches = (e: ThreadEntry, words: string[]) =>
  words.every((w) => {
    const wc = normalizeCode(w);
    return e.name.toLowerCase().includes(w) || (wc !== "" && normalizeCode(e.code).startsWith(wc)) || e.code.toLowerCase().includes(w);
  });

/**
 * Pick a thread from any of the 75 bundled product lines: choose a brand, then a line, then search by
 * code or name and click a swatch. Lines load on demand (the Brother ones ship with the app); "All
 * brands" searches every line at once. My Threads, when it has spools, is the first choice.
 */
export function ThreadPicker({ current, onPick }: { current?: string; onPick: (t: Thread) => void }) {
  const { shelf } = useShelf();
  const brands = useMemo(() => listBrands(), []);
  const [brand, setBrand] = useState("Brother");
  const [lineId, setLineId] = useState(DEFAULT_CATALOGUE_ID);
  const [query, setQuery] = useState("");
  const [loaded, setLoaded] = useState<Record<string, ThreadEntry[]>>({});
  const [found, setFound] = useState<ThreadEntry[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => void loadShelf(), []);

  const lines = useMemo(() => (brand === MINE || brand === EVERYWHERE ? [] : linesOfBrand(brand)), [brand]);
  const wantIds = useMemo(() => (lineId === ALL_LINES ? lines.map((l) => l.id) : lines.some((l) => l.id === lineId) ? [lineId] : []), [lines, lineId]);
  const words = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);

  // the lines shown right now: bundled ones are there at once, the rest load in
  useEffect(() => {
    let live = true;
    const missing = wantIds.filter((id) => !CATALOGUES.some((c) => c.id === id));
    if (missing.length === 0) return;
    setBusy(true);
    void Promise.all(missing.map((id) => loadLine(id).then((c) => [id, c.threads] as const)))
      .then((done) => live && setLoaded((prev) => ({ ...prev, ...Object.fromEntries(done) })))
      .catch(() => {})
      .finally(() => live && setBusy(false));
    return () => {
      live = false;
    };
  }, [wantIds]);

  // "All brands": search every line, after a short pause in typing
  useEffect(() => {
    if (brand !== EVERYWHERE) return;
    if (words.length === 0) {
      setFound(null);
      return;
    }
    let live = true;
    setBusy(true);
    const t = setTimeout(() => {
      void search(query, { limit: SHOW_MAX })
        .then((r) => live && setFound(r))
        .catch(() => live && setFound([]))
        .finally(() => live && setBusy(false));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [brand, query, words.length]);

  const entries: ThreadEntry[] = useMemo(() => {
    if (brand === MINE) return shelfPalette(shelf).filter((e) => matches(e, words));
    if (brand === EVERYWHERE) return found ?? [];
    const all = wantIds.flatMap((id) => CATALOGUES.find((c) => c.id === id)?.threads ?? loaded[id] ?? []);
    return words.length ? all.filter((e) => matches(e, words)) : all;
  }, [brand, shelf, words, found, wantIds, loaded]);

  const shown = entries.slice(0, SHOW_MAX);
  const pick = (e: ThreadEntry) => {
    const t = toDesignThread(e);
    registerThread(t);
    onPick(t);
  };
  const chartBrand = brand === MINE || brand === EVERYWHERE ? "" : brand;

  return (
    <div className="thread-picker" role="group" aria-label="Thread colour">
      <div className="thread-picker-bar">
        <select
          aria-label="Thread brand"
          value={brand}
          onChange={(e) => {
            const b = e.target.value;
            setBrand(b);
            setFound(null);
            setLineId(b === "Brother" ? DEFAULT_CATALOGUE_ID : ALL_LINES);
          }}
        >
          {shelf.entries.length > 0 && <option value={MINE}>My Threads ({shelf.entries.length})</option>}
          <option value={EVERYWHERE}>All brands (search)</option>
          {brands.map((b) => (
            <option key={b.brand} value={b.brand}>
              {b.brand} ({b.count})
            </option>
          ))}
        </select>
        {lines.length > 1 && (
          <select aria-label="Thread line" value={lineId} onChange={(e) => setLineId(e.target.value)}>
            <option value={ALL_LINES}>All lines</option>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.line} ({l.count})
              </option>
            ))}
          </select>
        )}
      </div>
      <input type="search" placeholder="Search code or name" aria-label="Search threads" value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="thread-grid">
        {shown.map((e) => {
          const id = toDesignThread(e).id;
          return (
            <button
              key={`${e.line}|${e.code}|${e.hex}`}
              className={`thread-swatch${current === id ? " active" : ""}`}
              style={{ background: e.hex }}
              title={`${e.brand} ${e.line} ${e.code} ${e.name}`}
              aria-label={`${e.brand} ${e.code} ${e.name}`}
              onClick={() => pick(e)}
            />
          );
        })}
      </div>
      <div className="thread-status muted small" role="status">
        {busy && "Loading…"}
        {!busy && brand === EVERYWHERE && words.length === 0 && "Type a code or colour name to search every brand."}
        {!busy && entries.length > SHOW_MAX && `Showing the first ${SHOW_MAX} of ${entries.length}. Type to narrow it down.`}
        {!busy && entries.length === 0 && (brand !== EVERYWHERE || words.length > 0) && (
          <>
            No match.{" "}
            {query.trim() && (
              <button className="link-button" onClick={() => void getPlatform().openUrl(brandChartUrl(chartBrand || query.trim().split(/\s+/)[0], undefined, undefined))}>
                Search online
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
