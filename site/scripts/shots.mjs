// Full-page screenshots of the built site (served by `pnpm --dir site dev` on :4321).
// Usage: node scripts/shots.mjs <outdir> [paths, e.g. / /ar/ /zh/]   (CHROME=<path> to pick a browser)
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const out = process.argv[2];
const paths = process.argv.slice(3).length ? process.argv.slice(3) : ["/", "/fr/", "/es/", "/zh/", "/ar/"];
mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
for (const scheme of ["light", "dark"]) {
  for (const [vw, vh, tag] of [[1440, 900, "desktop"], [390, 844, "mobile"]]) {
    const ctx = await b.newContext({ viewport: { width: vw, height: vh }, colorScheme: scheme, deviceScaleFactor: tag === "mobile" ? 2 : 1, locale: "en-US" });
    const p = await ctx.newPage();
    p.on("console", (m) => m.type() === "error" && console.log("console error:", m.text()));
    p.on("pageerror", (e) => console.log("pageerror:", e.message));
    for (const path of paths) {
      await p.goto(`http://localhost:4321${path}`, { waitUntil: "networkidle" });
      await p.waitForTimeout(1200);
      // the page lazy-loads card images: scroll through so they are all in the shot
      await p.evaluate(async () => {
        for (let y = 0; y < document.body.scrollHeight; y += 700) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 120));
        }
        window.scrollTo(0, 0);
      });
      await p.waitForTimeout(600);
      const name = `${path.replace(/\//g, "") || "en"}-${scheme}-${tag}.png`;
      await p.screenshot({ path: `${out}/${name}`, fullPage: true });
      console.log("shot", name);
    }
    await ctx.close();
  }
}
await b.close();
