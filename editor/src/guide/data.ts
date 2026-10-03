import hintsJson from "../../../docs/guide/hints.json";
import liveJson from "../../../docs/guide/live-hints.json";
import tourJson from "../../../docs/guide/tour.json";
import workflowJson from "../../../docs/guide/workflow.json";

/**
 * The guide's single copy source. Every user-facing string of the Help panel, the hints, the tour, the
 * workflow strip and the live warnings lives in `docs/guide/*.md` and `docs/guide/*.json`; the editor only
 * imports them. `scripts/build-guide-index.mjs` validates all of it in CI (`pnpm guide:check`).
 */

export interface HintEntry {
  id: string;
  label: string;
  what: string;
  when: string;
  typical: string;
  effects?: string;
  /** A page id, optionally with `#heading-slug`. */
  guideId: string;
  level: "basic" | "advanced";
}

export const HINTS = hintsJson as unknown as HintEntry[];
const byId = new Map(HINTS.map((h) => [h.id, h]));
export const hintById = (id: string): HintEntry | undefined => byId.get(id);

export interface TourStep {
  id: string;
  /** The `data-tour` value of the element to point at, or null for a centred card. */
  target: string | null;
  title: string;
  body: string;
  advanceOn: { type: "next" } | { type: "state"; cond: string };
  guideId?: string;
}
export interface TourPath {
  id: string;
  title: string;
  steps: TourStep[];
}
export interface TourData {
  welcome: { title: string; body: string; choices: { path: string; label: string; hint: string }[]; skip: string };
  paths: TourPath[];
  done: { title: string; body: string };
}
export const TOUR = tourJson as unknown as TourData;

export type WorkflowStepId = "design" | "size" | "stitches" | "preview" | "send";
export interface WorkflowStep {
  id: WorkflowStepId;
  label: string;
  tip: { title: string; body: string; action: { kind: string; label: string }; guideId: string };
}
export const WORKFLOW = (workflowJson as unknown as { steps: WorkflowStep[] }).steps;

export interface LiveHint {
  id: string;
  signal: string;
  severity: "info" | "care";
  threshold?: number;
  message: string;
  fix?: { label: string; action: string };
  guideId?: string;
}
export const LIVE_HINTS = liveJson as unknown as LiveHint[];

// ---- the manual (loaded when Help first opens, as its own chunk) -----------------------------------

export interface GuideHeading {
  level: number;
  text: string;
  slug: string;
}
export interface GuidePage {
  id: string;
  title: string;
  summary: string;
  section: string;
  order: number;
  keywords: string[];
  appContext: string[];
  status: string;
  words: number;
  headings: GuideHeading[];
  body: string;
}
export interface GuideIndex {
  sections: { id: string; title: string; order: number; blurb: string }[];
  pages: GuidePage[];
}

/** `page#heading` into its parts. */
export function splitRef(ref: string): { id: string; anchor?: string } {
  const [id, anchor] = ref.split("#");
  return anchor ? { id, anchor } : { id };
}

let indexPromise: Promise<GuideIndex> | null = null;
export function loadGuideIndex(): Promise<GuideIndex> {
  indexPromise ??= import("../../../docs/guide/index.json").then((m) => (m.default ?? m) as unknown as GuideIndex);
  return indexPromise;
}

/** Diagram files by their path inside docs/guide (for `![alt](diagrams/x.svg)`). */
const diagramModules = import.meta.glob("../../../docs/guide/diagrams/*.svg", { query: "?url", import: "default", eager: true }) as Record<string, string>;
const DIAGRAMS = new Map(Object.entries(diagramModules).map(([k, v]) => [k.replace("../../../docs/guide/", ""), v]));
export const diagramUrl = (path: string): string | undefined => DIAGRAMS.get(path);

/** The page to open for a UI area (an `appContext` id), lowest order first. */
export function pageForContext(index: GuideIndex, context: string): GuidePage | undefined {
  return index.pages.filter((p) => p.appContext.includes(context)).sort((a, b) => a.order - b.order)[0];
}

/** Rank pages for a search box: title, keywords, summary and headings, best first. Empty query keeps the order. */
export function searchPages(pages: readonly GuidePage[], query: string): GuidePage[] {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return [...pages];
  const scored: { page: GuidePage; score: number }[] = [];
  for (const page of pages) {
    const title = page.title.toLowerCase();
    const keywords = page.keywords.join(" ").toLowerCase();
    const summary = page.summary.toLowerCase();
    const heads = page.headings.map((h) => h.text.toLowerCase()).join(" ");
    let score = 0;
    let all = true;
    for (const w of words) {
      let s = 0;
      if (title.includes(w)) s += 10;
      if (keywords.includes(w)) s += 6;
      if (heads.includes(w)) s += 4;
      if (summary.includes(w)) s += 3;
      if (s === 0) all = false;
      score += s;
    }
    if (all) scored.push({ page, score });
  }
  return scored.sort((a, b) => b.score - a.score || a.page.order - b.page.order).map((s) => s.page);
}
