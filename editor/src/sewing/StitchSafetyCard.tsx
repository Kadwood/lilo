import { useId, useMemo } from "react";
import { SAFE_RANGES } from "@lilo/engine/light";
import { SafeSlider } from "../panels/SafeSlider";
import { safetyRows, setSafeValue, type SafeRow } from "../panels/safety";
import { useEditor } from "../state/store";
import { Hint } from "../guide/Hint";

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

/** "0.38 to 0.45 mm" when the shapes differ, else "0.4 mm". */
export const rangeText = (r: Pick<SafeRow, "min" | "max">): string => (Math.abs(r.max - r.min) < 0.005 ? `${fmt(r.min)} mm` : `${fmt(r.min)} to ${fmt(r.max)} mm`);

function Row({ row }: { row: SafeRow }) {
  const { actions } = useEditor();
  const canSet = row.settableIds.length > 0;
  const what = row.ids.length === 1 ? "1 shape" : `${row.ids.length} shapes`;
  const note =
    row.param === "satinWidth" && !canSet
      ? `${what}: ${rangeText(row)}. A satin shape's width is its drawing. Reshape it, or turn it into a running stitch.`
      : `${what}${row.ids.length > 1 ? `: ${rangeText(row)}` : ""}${row.outside > 0 && row.ids.length > 1 ? `. ${row.outside} outside the green.` : ""}`;
  return (
    <li>
      <SafeSlider
        label={row.label}
        param={row.param}
        value={row.mean}
        check={row.check}
        disabled={!canSet}
        note={note}
        help={SAFE_RANGES[row.param].source === "researched" ? `Researched. ${SAFE_RANGES[row.param].sourceNote}` : `Lilo default. ${SAFE_RANGES[row.param].sourceNote}`}
        onChange={(v) => {
          const ids = new Set(row.settableIds);
          actions.updateObjects(row.settableIds, `Set ${row.label.toLowerCase()}`, (o) => ids.has(o.id) && setSafeValue(o, row.param, v), { merge: `safe:${row.param}` });
        }}
        onDone={() => actions.endGroup()}
      />
    </li>
  );
}

/**
 * "Stitch safety": one row for each setting the design uses, with the green band, a status dot and one
 * sentence of why when it is amber. A change here is applied to every shape of that kind, as one undo step.
 * Amber is a heads up, never a block: the file still exports.
 */
export function StitchSafetyCard() {
  const { state } = useEditor();
  const uid = useId();
  const rows = useMemo(() => safetyRows(state.design), [state.design]);
  const amber = rows.filter((r) => r.check.status !== "ok").length;
  return (
    <section className="stitch-safety" aria-labelledby={`${uid}-title`}>
      <div className="before-sew-head">
        <h4 id={`${uid}-title`}>Stitch safety</h4>
        <Hint id="sewing.stitch-safety" />
        <span className="spacer" />
        <span className="muted small" aria-live="polite">
          {rows.length === 0 ? "" : amber === 0 ? "All in the green" : `${amber} to look at`}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="muted small">Nothing to check yet. Add some shapes.</p>
      ) : (
        <>
          <p className="muted small">Green is the range that sews well. Amber is a heads up, and Lilo still makes the file. Moving a slider here changes every shape of that kind.</p>
          <ul className="safe-list" aria-label="Stitch safety settings">
            {rows.map((r) => (
              <Row key={r.param} row={r} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
