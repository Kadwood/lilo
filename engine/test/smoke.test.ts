import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { it } from "vitest";
import { FIXTURES } from "./fixtures/fixtures";
import { imageToPes, objectCounts } from "./pipeline";
import { renderPlanPng } from "./render";

const out = process.env.SMOKE_OUT;

it.runIf(out)("smoke", async () => {
  mkdirSync(out!, { recursive: true });
  const lines: string[] = [];
  for (const f of FIXTURES) {
    const t0 = Date.now();
    const r = await imageToPes(f.make(), {}, f.name);
    lines.push(
      `${f.name}: objects=${r.design.objects.length} ${JSON.stringify(objectCounts(r.design))} threads=${r.design.threads.map((t) => t.code + " " + t.name).join(", ")} stitches=${r.stats.stitchCount} colourChanges=${r.stats.colorChanges} trims=${r.stats.trimCount} jumps=${r.stats.jumpCount} size=${r.stats.widthMm.toFixed(1)}x${r.stats.heightMm.toFixed(1)}mm warnings=${JSON.stringify(r.warnings.map((w) => w.message))} ms=${Date.now() - t0}`,
    );
    writeFileSync(join(out!, `${f.name}.pes`), r.pes);
    writeFileSync(join(out!, `${f.name}.svg`), r.svg);
    writeFileSync(join(out!, `${f.name}.stitches.png`), renderPlanPng(r.plan));
    writeFileSync(join(out!, `${f.name}.design.json`), JSON.stringify(r.design));
  }
  writeFileSync(join(out!, "smoke.txt"), lines.join("\n") + "\n");
}, 120_000);
