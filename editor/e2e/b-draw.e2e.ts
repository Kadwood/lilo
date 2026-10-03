import { afterAll, describe, expect, it } from "vitest";
import { loadProject } from "@lilo/engine";
import type { Page } from "playwright-core";
import { openApp, projectFiles, stopStack } from "./harness";

afterAll(stopStack);

type P = [number, number];

/** Where the hoop centre is on screen. The tool dock floats over the bottom of the canvas, so stay above it (offsets up to about +200). */
async function centre(page: Page): Promise<P> {
  const box = (await page.getByRole("main", { name: "Canvas" }).boundingBox())!;
  return [box.x + box.width / 2, box.y + box.height / 2];
}

/** Draw a closed shape with the Closed shape tool: click the corners, press Enter. */
async function drawClosed(page: Page, c: P, pts: P[]): Promise<void> {
  await page.keyboard.press("2");
  for (const [dx, dy] of pts) await page.mouse.click(c[0] + dx, c[1] + dy);
  await page.keyboard.press("Enter");
  await page.getByRole("complementary", { name: "Settings" }).getByRole("heading", { name: /Shape \d+/ }).waitFor();
}

const stitches = async (page: Page): Promise<number> => {
  const t = await page.getByLabel("Design totals").innerText();
  return Number(/([\d,]+) \/ ([\d,]+) stitches/.exec(t)?.[2].replace(/,/g, "") ?? NaN);
};
/** Wait until the stitch total has settled (re-stitching is debounced and runs in a worker). */
async function settled(page: Page): Promise<number> {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const n = await stitches(page);
    if (n === last && n > 0) return n;
    last = n;
  }
  return last;
}

/** The design inside the one `.lilo` the app saved last (path, parsed design as JSON text). */
async function savedDesign(page: Page, name: string): Promise<string> {
  const files = await projectFiles(page);
  const hit = [...files.entries()].find(([p]) => p.endsWith(`${name}.lilo`));
  if (!hit) throw new Error(`no ${name}.lilo saved; have ${[...files.keys()].join(", ")}`);
  const { design } = loadProject(hit[1]).project.doc;
  return JSON.stringify(design);
}

describe("journey b: draw -> edit -> save -> reopen", () => {
  it("draws, restyles, undoes and redoes 10 steps, maps, knifes, cuts a hole, saves and reopens identically", async () => {
    const j = await openApp("b");
    const { page } = j;
    await j.run(async () => {
      await page.getByRole("button", { name: "New design" }).click();
      await page.getByRole("textbox", { name: "Project name" }).waitFor();
      await page.getByRole("textbox", { name: "Project name" }).fill("Journey b");
      await page.getByRole("textbox", { name: "Project name" }).blur(); // so the tool keys reach the canvas
      const c = await centre(page);
      const settings = page.getByRole("complementary", { name: "Settings" });

      // 1. a closed shape, outlined, sewn as satin
      await drawClosed(page, c, [[-110, -160], [-30, -160], [-30, -100], [-110, -100]]);
      await j.shot("1-shape");
      await settings.getByRole("button", { name: "Outlined" }).click();
      await settings.getByRole("listbox", { name: "Run type" }).getByRole("option", { name: "Satin" }).click();
      const satin = await settled(page);
      expect(satin).toBeGreaterThan(100);
      await j.shot("2-satin");

      // 2. a second shape, filled; change its fill pattern twice
      await drawClosed(page, c, [[30, -160], [110, -160], [110, -100], [30, -100]]);
      const tatami = await settled(page);
      await settings.getByRole("listbox", { name: "Fill pattern" }).getByRole("option", { name: "Hearts M" }).click();
      const hearts = await settled(page);
      expect(hearts).not.toBe(tatami);
      await settings.getByRole("listbox", { name: "Fill pattern" }).getByRole("option", { name: "Waves" }).click();
      await settled(page);
      await j.shot("3-pattern");

      // 3. a few more steps so there are more than 10 to undo
      await page.getByRole("button", { name: "Duplicate" }).click();
      await page.getByRole("button", { name: "Flip H" }).click();
      await page.getByRole("button", { name: "Flip V" }).click();
      await page.getByRole("button", { name: "Rotate 90°" }).click();
      await page.getByRole("button", { name: "Duplicate" }).click();
      await page.getByRole("button", { name: "Flip H" }).click();
      await page.getByRole("button", { name: "Rotate 90°" }).click();
      const beforeUndo = await settled(page);
      await page.keyboard.press("Control+s"); // Save (first time: names the file after the project)
      await page.waitForFunction(() => [...window.__lilo!.state.files.keys()].some((p) => p.endsWith("Journey b.lilo")));
      const designBefore = await savedDesign(page, "Journey b");

      // 4. undo x10, redo x10: everything comes back exactly
      for (let i = 0; i < 10; i++) await page.keyboard.press("Control+z");
      await page.waitForTimeout(500);
      expect(await settled(page)).not.toBe(beforeUndo);
      await j.shot("4-after-10-undos");
      for (let i = 0; i < 10; i++) await page.keyboard.press("Control+Shift+z");
      expect(await settled(page)).toBe(beforeUndo);
      await page.keyboard.press("Control+s");
      await page.waitForTimeout(600);
      expect(await savedDesign(page, "Journey b")).toBe(designBefore);

      // 5. map the second shape to a path (3 points, Enter, Apply)
      await page.mouse.click(c[0] + 70, c[1] - 130); // select the filled shape
      await page.getByRole("button", { name: "Map…" }).click();
      const map = page.getByRole("dialog", { name: "Map to path" });
      await map.getByRole("button", { name: "Draw path" }).click();
      for (const [dx, dy] of [[-120, 40], [0, 120], [120, 40]] as P[]) await page.mouse.click(c[0] + dx, c[1] + dy);
      await page.keyboard.press("Enter");
      await map.getByRole("button", { name: "Apply" }).click();
      await settled(page);
      await j.shot("5-mapped");

      // 6. knife across a filled shape, 7. cut a hole in another
      await page.keyboard.press("Escape");
      await drawClosed(page, c, [[-110, 140], [-10, 140], [-10, 190], [-110, 190]]);
      await page.getByRole("button", { name: "Knife" }).click();
      await page.mouse.move(c[0] - 60, c[1] + 125);
      await page.mouse.down();
      await page.mouse.move(c[0] - 60, c[1] + 165, { steps: 4 });
      await page.mouse.move(c[0] - 60, c[1] + 205, { steps: 4 });
      await page.mouse.up();
      await settled(page);
      await j.shot("6-knife");
      await page.keyboard.press("Escape");
      await drawClosed(page, c, [[20, 140], [120, 140], [120, 190], [20, 190]]);
      await page.getByRole("button", { name: "Cut hole" }).click();
      for (const [dx, dy] of [[50, 150], [90, 150], [90, 180], [50, 180]] as P[]) await page.mouse.click(c[0] + dx, c[1] + dy);
      await page.keyboard.press("Enter");
      const final = await settled(page);
      await j.shot("7-hole");

      // 8. save, go home, reopen from the recent list: the design is identical
      await page.keyboard.press("Control+s");
      await page.waitForTimeout(800);
      const saved = await savedDesign(page, "Journey b");
      expect(saved).not.toBe(designBefore);
      await page.getByRole("button", { name: "Home", exact: true }).click();
      await page.getByRole("button", { name: "Open Journey b" }).click();
      await page.getByRole("textbox", { name: "Project name" }).waitFor();
      expect(await settled(page)).toBe(final);
      await j.shot("8-reopened");
      await page.keyboard.press("Control+s");
      await page.waitForTimeout(500);
      expect(await savedDesign(page, "Journey b")).toBe(saved);

      j.expectClean();
    });
  });
});
