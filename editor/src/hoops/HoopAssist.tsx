import { useEffect, useMemo } from "react";
import { useStore } from "zustand";
import { hoopOverflow, type Hoop } from "@lilo/engine/light";
import { useEditor } from "../state/store";
import { hoopViewStore, setHoopView } from "../state/hoopViewStore";
import { loadHoops, rememberHoop } from "../state/hoopStore";
import { designSize, pickFor, useCustomHoops, useHoop } from "./autoPick";
import { fmtMm, fmtSize } from "./format";

/**
 * Tells the user when the design and the hoop don't agree. On a fresh result (an import, a digitize) it
 * offers the smallest hoop that fits; when nothing fits it says the design needs re-hooping, and by how
 * many millimetres it overshoots the biggest hoop that came closest. Sizes assume the design is centred
 * in the hoop, which is where export puts it.
 */
export function HoopAssist() {
  const { state, actions } = useEditor();
  const hoop = useHoop();
  const custom = useCustomHoops();
  const dismissed = useStore(hoopViewStore, (s) => s.suggestionDismissedKey);
  useEffect(() => void loadHoops(), []);

  const size = designSize(state.design);
  const fits = useMemo(() => (size ? hoopOverflow(size, hoop, 0) : { x: 0, y: 0 }), [size, hoop]);
  const over = fits.x > 1e-6 || fits.y > 1e-6;
  const pick = useMemo(() => (over ? pickFor(state.design, hoop, custom) : null), [over, state.design, hoop, custom]);

  if (!size || !over || !pick) return null;
  const key = state.animationKey;
  const use = (h: Hoop) => {
    actions.setHoop(h);
    rememberHoop(h);
  };

  if (pick.kind === "fit") {
    if (dismissed === key) return null;
    return (
      <div className="hoop-assist" role="status" data-testid="hoop-suggestion">
        <span>
          This design is {fmtSize({ widthMm: size.w, heightMm: size.h })}: it doesn&apos;t fit {hoop.name}. Smallest hoop that holds it: <strong>{pick.hoop.name}</strong>
          {pick.rotated ? " (turned a quarter)" : ""}.
        </span>
        <button className="primary" onClick={() => use(pick.hoop)}>
          Use it
        </button>
        <button onClick={() => setHoopView({ suggestionDismissedKey: key })}>Not now</button>
      </div>
    );
  }
  const x = pick.overflowMm.x;
  const y = pick.overflowMm.y;
  const parts = [x > 0.05 ? `${fmtMm(x)} too wide` : null, y > 0.05 ? `${fmtMm(y)} too tall` : null].filter(Boolean).join(" and ");
  return (
    <div className="hoop-assist warn" role="alert" data-testid="hoop-rehoop">
      <span>
        Needs re-hooping: no hoop for this machine holds {fmtSize({ widthMm: size.w, heightMm: size.h })}. {pick.closest ? `The biggest, ${pick.closest.name}, is ${parts || "just too small"}.` : ""} Split the design, shrink it, or use a bigger hoop.
      </span>
      <button onClick={() => setHoopView({ pickerOpen: true })}>Browse hoops</button>
    </div>
  );
}
