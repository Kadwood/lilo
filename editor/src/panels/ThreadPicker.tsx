import { useMemo, useState } from "react";
import { CATALOGUES, DEFAULT_CATALOGUE_ID, toDesignThread, type Thread } from "@lilo/engine/light";

/** Pick a thread from the bundled catalogues: choose a brand range, search by name or code, click a swatch. */
export function ThreadPicker({ current, onPick }: { current?: string; onPick: (t: Thread) => void }) {
  const [catalogueId, setCatalogueId] = useState(DEFAULT_CATALOGUE_ID);
  const [query, setQuery] = useState("");
  const cat = CATALOGUES.find((c) => c.id === catalogueId) ?? CATALOGUES[0];
  const threads = useMemo(() => {
    const q = query.trim().toLowerCase();
    const all = cat.threads.map(toDesignThread);
    return q ? all.filter((t) => t.name.toLowerCase().includes(q) || t.code.toLowerCase().includes(q)) : all;
  }, [cat, query]);

  return (
    <div className="thread-picker" role="group" aria-label="Thread colour">
      <div className="thread-picker-bar">
        <select aria-label="Thread range" value={catalogueId} onChange={(e) => setCatalogueId(e.target.value)}>
          {CATALOGUES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
        <input type="search" placeholder="Search name or code" aria-label="Search threads" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="thread-grid">
        {threads.map((t) => (
          <button
            key={t.id}
            className={`thread-swatch${current === t.id ? " active" : ""}`}
            style={{ background: t.hex }}
            title={`${t.brand} ${t.code} ${t.name}`}
            aria-label={`${t.brand} ${t.code} ${t.name}`}
            onClick={() => onPick(t)}
          />
        ))}
        {threads.length === 0 && <span className="muted small">No match.</span>}
      </div>
    </div>
  );
}
