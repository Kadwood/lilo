// Captures real Lilo editor screenshots (mock mode) for the website.
// Needs `pnpm --filter editor dev` running on :5173 and `pnpm fonts` done. Output: site/raw-shots/ (git-ignored).
import { chromium } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "../raw-shots");
const ICON = join(here, "../../app/src-tauri/icons/icon.png");
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
const p = await ctx.newPage();
p.on("pageerror", (e) => console.log("pageerror", e.message));
const wait = (ms) => p.waitForTimeout(ms);
const shot = async (n, opts = {}) => {
  await wait(1200);
  await p.screenshot({ path: `${OUT}/${n}.png`, ...opts });
  console.log("shot", n);
};
const step = async (n, fn) => {
  try {
    await fn();
  } catch (e) {
    console.log("FAILED", n, String(e).split("\n")[0]);
  }
};
const fresh = async () => {
  await p.goto("http://localhost:5173/?mock");
  await wait(2000);
};

await fresh();
await step("home", () => shot("home"));

await step("crest", async () => {
  await p.getByRole("button", { name: "Open Kadwood crest" }).click();
  await wait(1500);
  await shot("crest");
  // stitch player part-way
  const slider = p.locator('input[type="range"]').first();
  const box = await p.locator(".sewing-bar, [class*=player]").first().boundingBox().catch(() => null);
  void box;
});

await step("send", async () => {
  await p.getByRole("button", { name: "Send", exact: true }).click();
  await shot("send");
  await p.getByRole("button", { name: "Close", exact: true }).click();
});

await step("hoop", async () => {
  await p.locator("button.hoop-button").first().click();
  await shot("hoop");
  await p.keyboard.press("Escape");
});

await step("digitize", async () => {
  await fresh();
  await p.getByRole("button", { name: "New design" }).click();
  await wait(800);
  const b64 = readFileSync(ICON).toString("base64");
  await p.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const dt = new DataTransfer();
    dt.items.add(new File([bin], "hibiscus.png", { type: "image/png" }));
    const target = document.querySelector(".canvas-empty-title")?.closest("[class*=canvas]") ?? document.querySelector("canvas");
    target.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, b64);
  await wait(400);
  await p.getByRole("button", { name: "Digitize", exact: true }).click().catch(() => {});
  await wait(350);
  await shot("trace-mid");
  await wait(6000);
  await shot("digitized");
});

await step("monogram", async () => {
  await fresh();
  await p.getByRole("button", { name: "Type a monogram" }).click();
  await wait(800);
  await p.getByRole("button", { name: "25", exact: true }).click();
  await p.locator("textarea").first().fill("Lilo");
  await p.locator("canvas").first().click({ position: { x: 420, y: 340 } });
  await wait(1000);
  await p.getByRole("button", { name: "Add text" }).click().catch(() => {});
  await wait(500);
  for (let i = 0; i < 4; i++) await p.getByRole("button", { name: "+", exact: true }).click().catch(() => {});
  await shot("monogram");
});

await step("pixel", async () => {
  await fresh();
  await p.getByRole("button", { name: "Pixel art", exact: true }).first().click();
  await wait(800);
  const grid = p.locator("canvas").first();
  const bb = await grid.boundingBox();
  const cell = bb.width / 32;
  const pal = p.locator('button[aria-label*="Brother"]');
  console.log("palette buttons", await pal.count());
  await p.locator('button[aria-label*="Brother"]').nth(2).click();
  const heart = [
    "..XX..XX..", ".XXXXXXXX.", "XXXXXXXXXX", "XXXXXXXXXX", ".XXXXXXXX.", "..XXXXXX..", "...XXXX...", "....XX....",
  ];
  const swatches = p.locator(".swatch, [class*=swatch] button, button[class*=swatch]");
  console.log("swatches", await swatches.count());
  for (let r = 0; r < heart.length; r++)
    for (let c = 0; c < heart[r].length; c++)
      if (heart[r][c] === "X") await p.mouse.click(bb.x + (c + 11) * cell + cell / 2, bb.y + (r + 11) * cell + cell / 2);
  await shot("pixel");
});

await b.close();
