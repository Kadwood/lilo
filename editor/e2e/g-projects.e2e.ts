import { afterAll, describe, expect, it } from "vitest";
import { loadProject } from "@lilo/engine";
import type { Page } from "playwright-core";
import { openApp, projectFiles, stopStack } from "./harness";

afterAll(stopStack);

type P = [number, number];

async function drawRect(page: Page, c: P, x0: number, y0: number, x1: number, y1: number): Promise<void> {
  await page.keyboard.press("4"); // Rectangle: drag
  await page.mouse.move(c[0] + x0, c[1] + y0);
  await page.mouse.down();
  await page.mouse.move(c[0] + x1, c[1] + y1, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(400);
}
const objectCount = async (page: Page): Promise<number> => Number(/(\d+) objects?/.exec(await page.getByRole("complementary", { name: "Sequencer" }).innerText())?.[1] ?? 0);
const menu = async (page: Page, item: string | RegExp) => {
  await page.getByRole("button", { name: "File", exact: true }).click();
  await page.getByRole("menuitem", { name: item }).click();
};
const historyOf = async (page: Page, name: string) => {
  const files = await projectFiles(page);
  const hit = [...files.entries()].find(([p]) => p.endsWith(`${name}.lilo`));
  return hit ? loadProject(hit[1]).project : null;
};

describe("journey g: projects", () => {
  it("autosaves on blur, restores a version, and guards unsaved work on New and Open", async () => {
    const j = await openApp("g");
    const { page } = j;
    await j.run(async () => {
      await page.getByRole("button", { name: "New design" }).click();
      const name = page.getByRole("textbox", { name: "Project name" });
      await name.fill("Journey g");
      await name.blur();
      const box = (await page.getByRole("main", { name: "Canvas" }).boundingBox())!;
      const c: P = [box.x + box.width / 2, box.y + box.height / 2];

      // one shape, saved
      await drawRect(page, c, -90, -150, -20, -100);
      expect(await objectCount(page)).toBe(1);
      await page.keyboard.press("Control+s");
      await page.waitForFunction(() => [...window.__lilo!.state.files.keys()].some((p) => p.endsWith("Journey g.lilo")));
      await expect.poll(async () => (await page.getByRole("img", { name: "Unsaved changes" }).count())).toBe(0); // saved: no dot

      // two more shapes, then the window loses focus: an autosave lands in the file's history
      await drawRect(page, c, 20, -150, 90, -100);
      await drawRect(page, c, -90, -60, -20, -10);
      expect(await objectCount(page)).toBe(3);
      await page.evaluate(() => window.dispatchEvent(new Event("blur")));
      await expect.poll(async () => (await historyOf(page, "Journey g"))?.history.length ?? 0, { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
      const saved = (await historyOf(page, "Journey g"))!;
      expect(saved.doc.design.objects.length).toBe(1); // an autosave never overwrites the last explicit save
      await j.shot("1-autosaved");

      // version history: pick the autosaved version (3 shapes), restore a state, undo brings it back
      await drawRect(page, c, 20, -60, 90, -10);
      expect(await objectCount(page)).toBe(4);
      await menu(page, /Version history/);
      const dialog = page.getByRole("dialog", { name: "Version history" });
      await dialog.getByRole("listbox", { name: "Saved versions" }).getByRole("option").first().waitFor();
      await j.shot("2-history");
      await dialog.getByRole("listbox", { name: "Saved versions" }).getByRole("option").last().getByRole("button").click();
      await expect.poll(() => dialog.getByText(/^Shapes$/).locator("xpath=following-sibling::dd").innerText()).toMatch(/^[123]$/);
      await dialog.getByRole("button", { name: /Restore/ }).click();
      await dialog.waitFor({ state: "detached" });
      await expect.poll(() => objectCount(page)).toBeLessThan(4);
      await j.shot("3-restored");
      await page.keyboard.press("Control+z");
      await expect.poll(() => objectCount(page)).toBe(4);

      // unsaved guard: New asks first; Cancel keeps the work; Don't save really starts fresh
      await menu(page, /^New/);
      const ask = page.getByRole("alertdialog");
      await ask.waitFor();
      expect(await ask.innerText()).toMatch(/Save changes to “Journey g”/);
      await j.shot("4-guard-new");
      await ask.getByRole("button", { name: "Cancel" }).click();
      await ask.waitFor({ state: "detached" });
      expect(await objectCount(page)).toBe(4);

      // Open: the same question, then Save writes the file and opens the other project
      const files = await projectFiles(page);
      const other = [...files.keys()].find((p) => p.endsWith("Hat patch.lilo"))!;
      const bytes = files.get(other)!;
      await page.evaluate(([p, b]) => void (window.__lilo!.state.pickProject = { path: p as string, name: "Hat patch.lilo", bytes: new Uint8Array(b as number[]) }), [other, [...bytes]] as const);
      await menu(page, /^Open… /);
      await ask.waitFor();
      await j.shot("5-guard-open");
      await ask.getByRole("button", { name: "Save", exact: true }).click();
      await ask.waitFor({ state: "detached" });
      await expect.poll(async () => await name.inputValue()).toBe("Hat patch");
      const afterSave = (await historyOf(page, "Journey g"))!;
      expect(afterSave.doc.design.objects.length).toBe(4); // Save kept the work
      await j.shot("6-opened-other");

      // Don't save: a fresh design with nothing carried over
      await page.getByRole("button", { name: "Editor" }).click();
      await drawRect(page, c, -50, -150, 20, -100);
      await menu(page, /^New/);
      await ask.getByRole("button", { name: "Don't save" }).click();
      await expect.poll(async () => await name.inputValue()).toBe("Untitled design");
      await expect.poll(() => objectCount(page)).toBe(0);
      j.expectClean();
    });
  });
});
