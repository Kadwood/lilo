/**
 * `pnpm dev` with `?mock` in the URL: runs the UI against an in-memory platform with a few sample
 * projects, a thread shelf and a canned OCR result, so every screen can be looked at (and
 * screenshotted) without the desktop app. Development only; nothing here ships.
 */
import {
  addEntry,
  addFromCatalogue,
  addHistorySnapshot,
  createProject,
  DEFAULT_HOOP,
  DEFAULT_RUN_PARAMS,
  ellipseNodes,
  emptyDesign,
  emptyShelf,
  exportShelf,
  getCatalogue,
  makeFill,
  makeRun,
  nodesFromPolyline,
  rectNodes,
  saveProject,
  toDesignThread,
  type Design,
  type Pt,
  type Thread,
} from "@lilo/engine/light";
import { designThumbnailPng, designToEmbroidery } from "@lilo/engine";
import { createMockPlatform, type MockState } from "../platform/mock";
import { setPlatform } from "../platform";

const pick = (name: string): Thread => toDesignThread(getCatalogue().threads.find((t) => t.name === name)!);

/** A round crest: navy disc with a red disc cut out of it, a gold ring and a satin-ish bar. */
function crest(variant = 0): Design {
  const navy = pick("Ultramarine");
  const red = pick("Red");
  const gold = pick("Deep Gold");
  const d = emptyDesign(DEFAULT_HOOP);
  d.threads = [navy, red, gold];
  const disc = makeFill("f1", "Disc", navy.id, ellipseNodes(0, 0, 28 - variant * 3, 28 - variant * 3));
  const hole = ellipseNodes(0, 0, 14, 14).map((n) => n.p);
  if (disc.kind === "fill") disc.geometry.holes = [hole as Pt[]];
  const inner = makeFill("f2", "Centre", red.id, ellipseNodes(0, 0, 14, 14));
  const ring = makeRun("r1", "Ring", gold.id, ellipseNodes(0, 0, 32 - variant * 3, 32 - variant * 3), true, { ...DEFAULT_RUN_PARAMS, repeats: 3 });
  const bar = makeFill("f3", "Bar", gold.id, rectNodes(-18, 36, 18, 41));
  d.objects = variant === 0 ? [disc, inner, ring, bar] : variant === 1 ? [disc, inner, ring] : [disc, inner];
  return d;
}

function monogram(): Design {
  const t = pick("Black");
  const d = emptyDesign(DEFAULT_HOOP);
  d.threads = [t];
  const l = (id: string, pts: Pt[]) => makeRun(id, id, t.id, nodesFromPolyline(pts), false, { ...DEFAULT_RUN_PARAMS, type: "satin", widthMm: 2.5 });
  d.objects = [
    l("K1", [[-12, -20], [-12, 20]]),
    l("K2", [[12, -20], [-12, 2]]),
    l("K3", [[-4, -6], [12, 20]]),
  ];
  return d;
}

export interface DevMock {
  state: MockState;
}

declare global {
  interface Window {
    __lilo?: DevMock;
  }
}

/** Replace the platform with the in-memory one and fill it with sample content. */
export async function installMockPlatform(): Promise<void> {
  const { platform, state } = createMockPlatform({ kind: "tauri" });
  setPlatform(platform);
  window.__lilo = { state };

  // My Threads
  let shelf = emptyShelf();
  const find = (code: string) => getCatalogue().threads.find((t) => t.code === code)!;
  for (const [code, qty, notes] of [["513", 2, "bobbin too"], ["800", 1, ""], ["010", 3, ""], ["328", 1, "half used"]] as const) {
    shelf = addFromCatalogue(shelf, find(code), { qty, ...(notes ? { notes } : {}) });
  }
  shelf = addEntry(shelf, { brand: "Local Mill", code: "A7", name: "Plum", hex: "#8a3a6a", qty: 2, source: "manual" });
  state.shelfJson = exportShelf(shelf);

  // sample projects in "Documents/Lilo", with history
  const now = Date.now();
  const make = (title: string, design: Design, ageMin: number, versions: Design[] = []) => {
    const t = new Date(now - ageMin * 60_000);
    let p = createProject({ title, design, shelf, now: t });
    p = { ...p, thumbnail: designThumbnailPng(design, { size: 256 }) };
    versions.forEach((v, i) => {
      p = addHistorySnapshot({ ...p, doc: { ...p.doc, design: v } }, new Date(now - (ageMin + (versions.length - i) * 7) * 60_000));
    });
    p = { ...p, doc: { ...p.doc, design } };
    const bytes = saveProject(p, t);
    const path = `/mock/Documents/Lilo/${title}.lilo`;
    state.files.set(path, bytes);
    state.recents.push({ path, name: title, modifiedMs: t.getTime(), sizeBytes: bytes.length });
  };
  make("Kadwood crest", crest(0), 3, [crest(2), crest(1)]);
  make("Lining monogram", monogram(), 90);
  make("Garment bag crest", crest(1), 60 * 26);
  make("Hat patch", crest(2), 60 * 24 * 6);

  // a label for "add a spool by photo", a PNG to pick, and files for the converter
  state.ocr = [
    { text: "MADEIRA", confidence: 0.99, bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.15 } },
    { text: "POLYNEON NO. 40", confidence: 0.98, bbox: { x: 0.1, y: 0.3, width: 0.5, height: 0.07 } },
    { text: "1747", confidence: 0.97, bbox: { x: 0.1, y: 0.45, width: 0.4, height: 0.22 } },
    { text: "5000 M / 5500 YDS", confidence: 0.95, bbox: { x: 0.1, y: 0.85, width: 0.4, height: 0.05 } },
  ];
  state.pickFiles = [{ name: "spool-label.png", bytes: designThumbnailPng(emptyDesign(), { size: 64 }) }];
  const dst = designToEmbroidery(crest(0), "dst", { label: "crest" }).bytes;
  const pes = designToEmbroidery(monogram(), "pes", { label: "mono" }).bytes;
  (window as unknown as { __samples: Record<string, Uint8Array> }).__samples = { dst, pes };
}
