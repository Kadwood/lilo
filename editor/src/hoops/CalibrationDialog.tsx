import { useEffect, useState } from "react";
import { useStore } from "zustand";
import { getPlatform } from "../platform";
import type { ScreenInfo } from "../platform/types";
import { ASSUMED_PX_PER_MM, CARD_HEIGHT_MM, CARD_WIDTH_MM, cardWidthPx, pxPerInch, resolveScale, scaleFromCardWidth, type ScreenScale } from "../canvas/actualSize";
import { useModalFocus } from "../shell/useModalFocus";
import { hoopViewStore, setHoopView } from "../state/hoopViewStore";

let screenPromise: Promise<ScreenInfo | null> | null = null;
/** What the OS says about the screen (asked once; null if the question fails). */
export function loadScreen(): Promise<ScreenInfo | null> {
  screenPromise ??= getPlatform()
    .screenInfo()
    .catch(() => null);
  return screenPromise;
}

/** Test hook. */
export function resetScreenCache(): void {
  screenPromise = null;
}

/** The scale to use for Actual size right now: calibrated, else the display, else 96 dpi. */
export async function currentScale(): Promise<ScreenScale> {
  return resolveScale(hoopViewStore.getState().calibratedPxPerMm, await loadScreen());
}

/** Match a card-sized box to a real card (or a ruler) held against the screen; that fixes the scale for Actual size. */
export function CalibrationDialog({ onClose }: { onClose: () => void }) {
  const ref = useModalFocus<HTMLDivElement>();
  const calibrated = useStore(hoopViewStore, (s) => s.calibratedPxPerMm);
  const [screen, setScreen] = useState<ScreenInfo | null>(null);
  const [pxPerMm, setPxPerMm] = useState<number>(calibrated ?? ASSUMED_PX_PER_MM);
  useEffect(() => {
    let alive = true;
    void loadScreen().then((s) => {
      if (!alive) return;
      setScreen(s);
      // start from what the display reports, unless the user has measured before
      if (calibrated === null && s?.pxPerMm) setPxPerMm(s.pxPerMm);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = () => {
    setHoopView({ calibrationAsked: true });
    onClose();
  };
  const save = () => {
    setHoopView({ calibratedPxPerMm: scaleFromCardWidth(cardWidthPx(pxPerMm)), calibrationAsked: true });
    onClose();
  };
  const widthPx = cardWidthPx(pxPerMm);
  const fromOs = screen?.pxPerMm ?? null;

  return (
    <div className="dialog-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div
        className="dialog calibration"
        role="dialog"
        aria-modal="true"
        aria-label="Calibrate the screen"
        tabIndex={-1}
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            close();
          }
        }}
      >
        <h2>Calibrate the screen</h2>
        <p className="muted small">
          {fromOs
            ? `Your computer says this screen is about ${pxPerInch(fromOs)} pixels per inch. Check it: hold a credit card flat against the screen and stretch the grey card until it is the same size.`
            : "Lilo can't tell how big this screen is. Hold a credit card (or any ID card) flat against the screen and stretch the grey card until it is the same size."}
        </p>
        <div className="calibration-stage">
          <div className="calibration-card" style={{ width: widthPx, height: CARD_HEIGHT_MM * pxPerMm }} aria-label={`Card, ${CARD_WIDTH_MM} by ${CARD_HEIGHT_MM} millimetres`}>
            <span>
              {CARD_WIDTH_MM} × {CARD_HEIGHT_MM} mm
            </span>
          </div>
        </div>
        <label className="field">
          Size on screen
          <input type="range" min={2.5} max={9} step={0.01} value={pxPerMm} onChange={(e) => setPxPerMm(Number(e.target.value))} aria-label="Card size" />
        </label>
        <div className="button-row">
          <button onClick={() => setPxPerMm((v) => Math.max(2.5, v - 0.02))} aria-label="Smaller">
            −
          </button>
          <button onClick={() => setPxPerMm((v) => Math.min(9, v + 0.02))} aria-label="Bigger">
            +
          </button>
          {fromOs && <button onClick={() => setPxPerMm(fromOs)}>Use what the computer says</button>}
          <button onClick={() => setPxPerMm(ASSUMED_PX_PER_MM)}>Assume 96 dpi</button>
        </div>
        <div className="dialog-actions">
          {calibrated !== null && (
            <button
              onClick={() => {
                setHoopView({ calibratedPxPerMm: null });
                onClose();
              }}
            >
              Forget my calibration
            </button>
          )}
          <span className="spacer" />
          <button onClick={close}>Cancel</button>
          <button className="primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
