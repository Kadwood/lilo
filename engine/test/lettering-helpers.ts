import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { init as initStitch } from "@stitchables/stitchjs";
import { getCatalogue, toDesignThread } from "../src/threads";
import { DEFAULT_HOOP, emptyDesign, type Design, type DesignObject, type Thread } from "../src/model";
import { applyOrigin, CENTER_ORIGIN, writePes } from "../src/pes";
import { designToStitchPlan, planStats, validatePlan } from "../src/stitch";
import { parseFont } from "../src/lettering/font";
import type { LiloFont } from "../src/lettering/types";
import { renderPlanPng } from "./render";

const here = dirname(fileURLToPath(import.meta.url));
export const FONTS_DIR = join(here, "..", "..", "data", "fonts");
export const FIXTURE_FONTS_DIR = join(here, "fixtures", "fonts");

const cache = new Map<string, LiloFont>();
export function loadBuiltin(id: string): LiloFont {
  let f = cache.get(id);
  if (!f) {
    f = parseFont(JSON.parse(readFileSync(join(FONTS_DIR, id, "font.json"), "utf8")));
    cache.set(id, f);
  }
  return f;
}

export function thread(name = "Black"): Thread {
  const t = getCatalogue().threads.find((x) => x.name === name) ?? getCatalogue().threads[0];
  return toDesignThread(t);
}

export async function ready(): Promise<void> {
  await initStitch();
}

export function designOf(objects: DesignObject[], threads: Thread[]): Design {
  const d = emptyDesign(DEFAULT_HOOP);
  d.threads = threads;
  d.objects = objects;
  return d;
}

/** Design -> validated plan -> PES bytes + stats (+ optional preview PNG). */
export function sew(design: Design, label = "lettering") {
  const plan0 = designToStitchPlan(design);
  const { plan, warnings } = validatePlan(plan0, design.hoop);
  const pes = writePes(applyOrigin(plan, CENTER_ORIGIN), { label });
  return { plan, warnings, pes, stats: planStats(plan) };
}

export function savePng(dir: string, name: string, plan: ReturnType<typeof sew>["plan"], pxPerMm = 24): string {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${name}.png`);
  writeFileSync(file, renderPlanPng(plan, pxPerMm, 3));
  return file;
}
