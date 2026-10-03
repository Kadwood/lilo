import { useEffect, useMemo, useState } from "react";
import { useStore } from "zustand";
import {
  HOOP_BRANDS,
  HOOP_LIBRARY,
  HOOP_LIBRARY_COMPILED,
  HOOP_LIBRARY_NOTE,
  HOOP_SOURCES,
  findHoopSpec,
  hoopFromSpec,
  hoopsForBrand,
  hoopsForMachine,
  machinesForBrand,
  rotateHoop,
  searchHoops,
  type Hoop,
  type HoopSpec,
} from "@lilo/engine/light";
import { useModalFocus } from "../shell/useModalFocus";
import { useEditor } from "../state/store";
import { deleteCustomHoop, hoopStore, loadHoops, rememberHoop, restoreHoopsBackup } from "../state/hoopStore";
import { setHoopView } from "../state/hoopViewStore";
import { pickFor, useCustomHoops, useHoop } from "./autoPick";
import { fmtSize } from "./format";

const RECENT = "Recent";
const MINE = "My custom hoops";
const ALL = "All hoops";

/** One hoop in a list: what it is, how big, and whether the size is confirmed. */
function HoopRow({ hoop, spec, current, onPick, children }: { hoop: Hoop; spec?: HoopSpec; current: boolean; onPick: () => void; children?: React.ReactNode }) {
  const unverified = spec ? !spec.verified : false;
  const title = spec ? spec.sources.map((k) => HOOP_SOURCES[k]?.title ?? k).join("\n") + (spec.note ? `\n${spec.note}` : "") : undefined;
  return (
    <li className={`hoop-row${current ? " current" : ""}`}>
      <button className="hoop-row-main" onClick={onPick} title={title} aria-current={current ? "true" : undefined}>
        <span className="hoop-row-icon" aria-hidden="true" data-shape={hoop.shape ?? "rect"} />
        <span className="hoop-row-text">
          <span className="hoop-row-name">{hoop.name}</span>
          <span className="muted small">
            {fmtSize(hoop)} · {hoop.shape === "cap" ? "cap frame" : (hoop.shape ?? "rect") === "rect" ? "rectangle" : hoop.shape}
            {spec && spec.machines.length > 0 ? ` · ${spec.machines.slice(0, 3).join(", ")}${spec.machines.length > 3 ? "…" : ""}` : ""}
          </span>
        </span>
        {unverified && <span className="badge warn">UNVERIFIED</span>}
      </button>
      {children}
    </li>
  );
}

/**
 * Pick a hoop: brand, then machine, then hoop; or search; or one used recently; or one of your own. The
 * choice is stored in the design (id and sizes) so the file doesn't depend on the library.
 */
export function HoopPicker({ onClose }: { onClose: () => void }) {
  const { state, actions } = useEditor();
  const current = useHoop();
  const custom = useCustomHoops();
  const recents = useStore(hoopStore, (s) => s.recents);
  const status = useStore(hoopStore, (s) => s.status);
  const error = useStore(hoopStore, (s) => s.error);
  const recovery = useStore(hoopStore, (s) => s.recovery);
  const ref = useModalFocus<HTMLDivElement>();
  const [query, setQuery] = useState("");
  const startBrand = findHoopSpec(current.id)?.brand ?? (current.id?.startsWith("custom-") ? MINE : HOOP_BRANDS[0]);
  const [brand, setBrand] = useState<string>(startBrand);
  const [machine, setMachine] = useState<string>(ALL);
  const [turn, setTurn] = useState(false);
  useEffect(() => void loadHoops(), []);

  const choose = (h: Hoop) => {
    const out = turn ? rotateHoop(h) : h;
    actions.setHoop(out);
    rememberHoop(h);
    onClose();
  };

  const machines = useMemo(() => (brand === RECENT || brand === MINE ? [] : machinesForBrand(brand)), [brand]);
  const specs: HoopSpec[] = useMemo(() => {
    if (brand === RECENT || brand === MINE) return [];
    return machine === ALL ? hoopsForBrand(brand) : hoopsForMachine(brand, machine);
  }, [brand, machine]);

  const q = query.trim();
  const found = useMemo(() => (q ? searchHoops(q) : []), [q]);
  const foundCustom = useMemo(() => (q ? custom.filter((h) => `${h.name} ${h.widthMm}x${h.heightMm}`.toLowerCase().includes(q.toLowerCase())) : []), [q, custom]);
  const smallest = useMemo(() => pickFor(state.design, current, custom), [state.design, current, custom]);

  const customRows = (list: Hoop[], editable: boolean) =>
    list.map((h) => (
      <HoopRow key={h.id ?? h.name} hoop={h} current={current.id === h.id} onPick={() => choose(h)}>
        {editable && (
          <span className="hoop-row-actions">
            <button className="icon" aria-label={`Edit ${h.name}`} onClick={() => setHoopView({ customEditor: { id: h.id ?? null } })}>
              Edit
            </button>
            <button className="icon" aria-label={`Delete ${h.name}`} onClick={() => void deleteCustomHoop(h.id as string)}>
              Delete
            </button>
          </span>
        )}
      </HoopRow>
    ));

  const specRows = (list: readonly HoopSpec[]) => list.map((s) => <HoopRow key={s.id} hoop={hoopFromSpec(s)} spec={s} current={current.id === s.id} onPick={() => choose(hoopFromSpec(s))} />);

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="dialog hoop-picker"
        role="dialog"
        aria-modal="true"
        aria-label="Choose a hoop"
        tabIndex={-1}
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="hoop-picker-head">
          <h2>Choose a hoop</h2>
          <span className="muted small">
            Now: {current.name} ({fmtSize(current)})
          </span>
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
        </div>

        <input className="hoop-search" type="search" placeholder="Search brand, machine or size, e.g. PE800 or 130x180" aria-label="Search hoops" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />

        <div className="hoop-picker-tools">
          <label className="check">
            <input type="checkbox" checked={turn} onChange={(e) => setTurn(e.target.checked)} /> Turn the hoop a quarter (swap width and height)
          </label>
          <button
            disabled={!smallest}
            title={smallest ? undefined : "Draw or digitize something first"}
            onClick={() => smallest?.kind === "fit" && choose(smallest.hoop)}
          >
            {smallest?.kind === "fit" ? `Smallest that fits: ${smallest.hoop.name}${smallest.rotated ? " (turned)" : ""}` : smallest?.kind === "none" ? "Nothing fits: needs re-hooping" : "Smallest hoop that fits"}
          </button>
        </div>

        {(error || recovery) && (
          <p className="warnings-inline" role="alert">
            {error}{" "}
            {recovery && (
              <button className="link-button" onClick={() => void restoreHoopsBackup()}>
                Restore the previous copy
              </button>
            )}
          </p>
        )}

        {q ? (
          <ul className="hoop-list hoop-results" aria-label="Search results">
            {customRows(foundCustom, false)}
            {specRows(found)}
            {found.length + foundCustom.length === 0 && <li className="muted hoop-empty">No hoop matches “{q}”. Add it under My custom hoops.</li>}
          </ul>
        ) : (
          <div className="hoop-columns">
            <ul className="hoop-brands" aria-label="Brands">
              {recents.length > 0 && (
                <li>
                  <button className={brand === RECENT ? "active" : ""} onClick={() => setBrand(RECENT)}>
                    {RECENT}
                  </button>
                </li>
              )}
              {HOOP_BRANDS.map((b) => (
                <li key={b}>
                  <button
                    className={brand === b ? "active" : ""}
                    onClick={() => {
                      setBrand(b);
                      setMachine(ALL);
                    }}
                  >
                    {b}
                  </button>
                </li>
              ))}
              <li>
                <button className={brand === MINE ? "active" : ""} onClick={() => setBrand(MINE)}>
                  {MINE} {custom.length > 0 && <span className="muted">({custom.length})</span>}
                </button>
              </li>
            </ul>

            {machines.length > 0 && (
              <ul className="hoop-machines" aria-label="Machines">
                {[ALL, ...machines].map((m) => (
                  <li key={m}>
                    <button className={machine === m ? "active" : ""} onClick={() => setMachine(m)}>
                      {m}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="hoop-list-col">
              {brand === MINE && (
                <div className="hoop-mine-head">
                  <button className="primary" onClick={() => setHoopView({ customEditor: { id: null } })}>
                    Add a hoop…
                  </button>
                  <span className="muted small">Saved on this computer ({status === "ready" ? "hoops.json" : status}).</span>
                </div>
              )}
              <ul className="hoop-list" aria-label="Hoops">
                {brand === RECENT && customRows(recents, false)}
                {brand === MINE && (custom.length ? customRows(custom, true) : <li className="muted hoop-empty">No custom hoops yet. Add the size printed on your hoop.</li>)}
                {brand !== RECENT && brand !== MINE && specRows(specs)}
              </ul>
            </div>
          </div>
        )}

        <details className="hoop-sources">
          <summary>Where these sizes come from</summary>
          <p className="muted small">
            {HOOP_LIBRARY.length} hoops, compiled {HOOP_LIBRARY_COMPILED}. {HOOP_LIBRARY_NOTE}
          </p>
          <ul className="muted small">
            {Object.entries(HOOP_SOURCES).map(([k, s]) => (
              <li key={k}>
                {s.title}
                {s.url ? ` (${s.url})` : ""}
              </li>
            ))}
          </ul>
        </details>
      </div>
    </div>
  );
}
