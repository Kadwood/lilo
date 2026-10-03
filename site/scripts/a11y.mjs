// axe-core over every built page, light and dark, desktop and mobile. Needs the dev server on :4321.
// Usage: node scripts/a11y.mjs   (CHROME=<path> to pick a browser). Exit 1 on any violation.
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const axeSrc = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const paths = ["/", "/fr/", "/es/", "/zh/", "/ar/", "/compatibility/", "/ar/compatibility/"];
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
let bad = 0;
for (const scheme of ["light", "dark"]) {
  for (const [w, h] of [[1440, 900], [390, 844]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, reducedMotion: "reduce" });
    const p = await ctx.newPage();
    for (const path of paths) {
      await p.goto(`http://localhost:4321${path}`, { waitUntil: "networkidle" });
      await p.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 800) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 60));
        }
        window.scrollTo(0, 0);
      });
      await p.addScriptTag({ content: axeSrc });
      const r = await p.evaluate(() => window.axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"] }));
      for (const v of r.violations) {
        bad++;
        console.log(`[${scheme} ${w}] ${path} ${v.id} (${v.impact}): ${v.help}\n    ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
      }
    }
    await ctx.close();
  }
}
await b.close();
console.log(bad ? `${bad} violation(s)` : "axe: 0 violations on all pages (light/dark, desktop/mobile)");
process.exit(bad ? 1 : 0);
