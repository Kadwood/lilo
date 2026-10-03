import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import { loadGuideIndex, pageForContext, TOUR } from "./data";

/**
 * App-wide state for the guide: the Help panel, the tour, the milestones the workflow strip needs and the
 * warnings the user dismissed. Module-level like `hoopViewStore`: one per window, plain functions to drive it.
 */

export interface TourState {
  phase: "off" | "welcome" | "running" | "done";
  path: string | null;
  step: number;
}

export interface GuideState {
  helpOpen: boolean;
  /** Page id with an optional `#heading`. */
  helpPage: string | null;
  helpQuery: string;
  tour: TourState;
  /** The user finished or skipped the tour once: do not start it again on launch. */
  tourSeen: boolean;
  /** Things the strip cannot read from the design: did the user preview, and did they export or send. */
  previewed: boolean;
  /** The stitch player was actually played (tour step), as opposed to just looking at the realistic view. */
  played: boolean;
  exported: boolean;
  /** The Sewing setup card is open (the workflow strip and the tour open it for you). */
  sewingOpen: boolean;
  /** Dismissed live warnings, keyed by hint id (plus the object count so a changed design re-warns). */
  dismissed: string[];
  /** The workflow step whose tip card is open. */
  stepperTip: string | null;
}

const KEY = "lilo.tour";

function loadSeen(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "done";
  } catch {
    return false;
  }
}

const initial = (): GuideState => ({
  helpOpen: false,
  helpPage: null,
  helpQuery: "",
  tour: { phase: "off", path: null, step: 0 },
  tourSeen: loadSeen(),
  previewed: false,
  played: false,
  exported: false,
  sewingOpen: false,
  dismissed: [],
  stepperTip: null,
});

export const guideStore = createStore<GuideState>(initial);
export const useGuide = <T,>(select: (s: GuideState) => T): T => useStore(guideStore, select);
const set = (patch: Partial<GuideState>) => guideStore.setState(patch);

/** Back to a fresh state (tests; `tourSeen` is re-read from storage). */
export function resetGuideStore(): void {
  guideStore.setState(initial(), true);
}

// ---- Help panel ---------------------------------------------------------------------------------------

export function openHelp(page?: string): void {
  set({ helpOpen: true, helpPage: page ?? guideStore.getState().helpPage, helpQuery: page ? "" : guideStore.getState().helpQuery });
}
export function closeHelp(): void {
  set({ helpOpen: false });
}
export function toggleHelp(): void {
  guideStore.getState().helpOpen ? closeHelp() : openHelp();
}
export function setHelpPage(page: string | null): void {
  set({ helpPage: page });
}
export function setHelpQuery(q: string): void {
  set({ helpQuery: q, helpPage: q ? null : guideStore.getState().helpPage });
}
/** Open the page that documents a UI area (`appContext`), falling back to the welcome page. */
export async function openHelpFor(context: string): Promise<void> {
  const index = await loadGuideIndex();
  openHelp(pageForContext(index, context)?.id ?? "welcome");
}

// ---- Tour ---------------------------------------------------------------------------------------------

function remember(): void {
  set({ tourSeen: true });
  try {
    window.localStorage.setItem(KEY, "done");
  } catch {
    /* private mode: the tour just shows again next launch */
  }
}
export function startTour(): void {
  set({ tour: { phase: "welcome", path: null, step: 0 }, helpOpen: false });
}
export function chooseTourPath(path: string): void {
  set({ tour: { phase: "running", path, step: 0 } });
}
export function tourNext(): void {
  const { tour } = guideStore.getState();
  const steps = TOUR.paths.find((p) => p.id === tour.path)?.steps ?? [];
  if (tour.step + 1 >= steps.length) return finishTour();
  set({ tour: { ...tour, step: tour.step + 1 } });
}
export function tourBack(): void {
  const { tour } = guideStore.getState();
  if (tour.step > 0) set({ tour: { ...tour, step: tour.step - 1 } });
}
export function finishTour(): void {
  set({ tour: { phase: "done", path: null, step: 0 } });
  remember();
}
export function skipTour(): void {
  set({ tour: { phase: "off", path: null, step: 0 } });
  remember();
}
export function closeTourDone(): void {
  set({ tour: { phase: "off", path: null, step: 0 } });
}

// ---- milestones and warnings --------------------------------------------------------------------------

export function markPreviewed(): void {
  if (!guideStore.getState().previewed) set({ previewed: true });
}
export function markPlayed(): void {
  if (!guideStore.getState().played) set({ played: true, previewed: true });
}
export function setSewingOpen(open: boolean): void {
  set({ sewingOpen: open });
}
export function markExported(): void {
  if (!guideStore.getState().exported) set({ exported: true });
}
export function resetMilestones(): void {
  set({ previewed: false, played: false, exported: false });
}
export function dismissLive(key: string): void {
  const { dismissed } = guideStore.getState();
  if (!dismissed.includes(key)) set({ dismissed: [...dismissed, key] });
}
export function restoreLive(): void {
  set({ dismissed: [] });
}
export function setStepperTip(id: string | null): void {
  set({ stepperTip: id });
}
