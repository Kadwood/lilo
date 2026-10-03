import { createStore } from "zustand/vanilla";

/**
 * What the canvas shows about the hoop, app-wide and remembered in localStorage (except guides, which
 * belong to the session): the realistic frame, the safe margin, rulers, the placement guide, and the
 * screen calibration for Actual size.
 */
export interface Guide {
  id: number;
  axis: "x" | "y";
  /** Position in design mm (the hoop centre is 0). */
  mm: number;
}

export interface HoopViewState {
  showFrame: boolean;
  showSafeArea: boolean;
  showRulers: boolean;
  /** A `PlacementGuide.id`, or null for none. */
  placementId: string | null;
  guides: Guide[];
  /** CSS pixels per mm the user measured with a card or ruler; beats what the OS reports. */
  calibratedPxPerMm: number | null;
  /** The user closed the first-run calibration prompt: do not ask again. */
  calibrationAsked: boolean;
  /** The suggested-hoop banner was dismissed for this design result (animation key). */
  suggestionDismissedKey: number;
  /** Dialogs (not remembered): the hoop picker, the screen calibration, the custom-hoop form (`id` = editing that hoop). */
  pickerOpen: boolean;
  calibrationOpen: boolean;
  customEditor: { id: string | null } | null;
}

const KEY = "lilo.hoop-view";

const DEFAULTS: HoopViewState = {
  showFrame: true,
  showSafeArea: true,
  showRulers: true,
  placementId: null,
  guides: [],
  calibratedPxPerMm: null,
  calibrationAsked: false,
  suggestionDismissedKey: -1,
  pickerOpen: false,
  calibrationOpen: false,
  customEditor: null,
};

function load(): HoopViewState {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;
    const bool = (k: keyof HoopViewState, d: boolean) => (typeof raw[k] === "boolean" ? (raw[k] as boolean) : d);
    const cal = typeof raw.calibratedPxPerMm === "number" && raw.calibratedPxPerMm >= 1 && raw.calibratedPxPerMm <= 40 ? raw.calibratedPxPerMm : null;
    return {
      ...DEFAULTS,
      showFrame: bool("showFrame", true),
      showSafeArea: bool("showSafeArea", true),
      showRulers: bool("showRulers", true),
      placementId: typeof raw.placementId === "string" ? raw.placementId : null,
      calibratedPxPerMm: cal,
      calibrationAsked: bool("calibrationAsked", false),
    };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(s: HoopViewState): void {
  try {
    const { showFrame, showSafeArea, showRulers, placementId, calibratedPxPerMm, calibrationAsked } = s;
    window.localStorage.setItem(KEY, JSON.stringify({ showFrame, showSafeArea, showRulers, placementId, calibratedPxPerMm, calibrationAsked }));
  } catch {
    // private mode: the choice still holds for this session
  }
}

export const hoopViewStore = createStore<HoopViewState>(() => load());

export function setHoopView(patch: Partial<HoopViewState>): void {
  hoopViewStore.setState(patch);
  save(hoopViewStore.getState());
}

let nextGuide = 1;
export function addGuide(axis: Guide["axis"], mm: number): number {
  const id = nextGuide++;
  hoopViewStore.setState({ guides: [...hoopViewStore.getState().guides, { id, axis, mm }] });
  return id;
}
export function moveGuide(id: number, mm: number): void {
  hoopViewStore.setState({ guides: hoopViewStore.getState().guides.map((g) => (g.id === id ? { ...g, mm } : g)) });
}
export function removeGuide(id: number): void {
  hoopViewStore.setState({ guides: hoopViewStore.getState().guides.filter((g) => g.id !== id) });
}
export function clearGuides(): void {
  hoopViewStore.setState({ guides: [] });
}

/** Test hook. */
export function resetHoopView(): void {
  nextGuide = 1;
  hoopViewStore.setState({ ...DEFAULTS });
}
