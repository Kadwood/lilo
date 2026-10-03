import { afterAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { fontFixture, openApp, stopStack } from "./harness";

afterAll(stopStack);

const stitchTotal = async (page: Page): Promise<number> => Number(/([\d,]+) \/ ([\d,]+) stitches/.exec(await page.getByLabel("Design totals").innerText())?.[2].replace(/,/g, "") ?? NaN);
/** The selection's width and height in mm, from the Dimensions fields. */
const size = async (page: Page): Promise<{ w: number; h: number }> => ({
  w: Number(await page.getByRole("spinbutton", { name: "Width (mm)" }).inputValue()),
  h: Number(await page.getByRole("spinbutton", { name: "Height (mm)" }).inputValue()),
});
async function settled(page: Page): Promise<number> {
  let last = -1;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const n = await stitchTotal(page);
    if (n === last && n > 0) return n;
    last = n;
  }
  return last;
}

describe("journey c: monogram lettering", () => {
  it("types a monogram, uploads a custom font, edits in place, rotates, re-lays out and warns when small", async () => {
    const j = await openApp("c");
    const { page } = j;
    await j.run(async () => {
      await page.getByRole("button", { name: "Type a monogram" }).click();
      const panel = page.getByRole("complementary", { name: "Text" });
      await panel.waitFor();
      await j.shot("1-text-panel");

      // built-in font at 10 mm
      await panel.getByLabel("Text to stitch").fill("JK");
      await panel.getByRole("button", { name: "10", exact: true }).click();
      await panel.getByRole("button", { name: "Add text" }).click();
      await panel.getByRole("heading", { name: "Edit text" }).waitFor();
      const builtin = await settled(page);
      expect(builtin).toBeGreaterThan(150);
      const s1 = await size(page);
      expect(s1.h).toBeGreaterThan(8);
      expect(s1.h).toBeLessThan(14);
      await j.shot("2-builtin-10mm");

      // a custom TTF (uploaded through the file input, like a pick from the dialog)
      await panel.getByRole("button", { name: "New text" }).click();
      await panel.getByLabel("Upload a font file").setInputFiles({ name: "Lato-Regular.ttf", mimeType: "font/ttf", buffer: fontFixture("Lato-Regular.ttf") });
      await panel.getByRole("list", { name: "Your fonts" }).getByRole("button", { name: "Lato uploaded" }).waitFor({ timeout: 30_000 });
      await panel.getByLabel("Text to stitch").fill("AB");
      await panel.getByRole("button", { name: "10", exact: true }).click();
      await panel.getByRole("button", { name: "Add text" }).click();
      await panel.getByRole("heading", { name: "Edit text" }).waitFor({ timeout: 60_000 });
      const custom = await settled(page);
      expect(custom).toBeGreaterThan(builtin);
      await j.shot("3-custom-font");

      // edit the text in place: same word, longer
      const before = await size(page);
      await panel.getByLabel("Text to stitch").fill("ABC");
      await panel.getByRole("button", { name: "Update text" }).click();
      await settled(page);
      const longer = await size(page);
      expect(longer.w).toBeGreaterThan(before.w);
      await j.shot("4-edited-in-place");

      // rotate a quarter turn, then re-lay out: the turn stays
      await page.getByRole("button", { name: "Rotate 90°" }).click();
      await settled(page);
      const turned = await size(page);
      expect(turned.h).toBeGreaterThan(turned.w);
      await panel.getByLabel("Text to stitch").fill("ABCD");
      await panel.getByRole("button", { name: "Update text" }).click();
      await settled(page);
      const relaid = await size(page);
      expect(relaid.h).toBeGreaterThan(relaid.w); // still standing up
      expect(relaid.h).toBeGreaterThan(turned.h); // and longer
      await j.shot("5-rotated-relayout");

      // the small-letters warning follows the thread weight in the Sewing setup
      const small = panel.getByTestId("small-letters-warning");
      await panel.getByLabel("Letter height in millimetres").fill("5");
      await panel.getByText(/Custom fonts sew best above 6 mm/).waitFor();
      await j.shot("6-below-6mm");
      await page.getByRole("button", { name: /Suiting · 40 wt/ }).click();
      await page.getByLabel("Thread weight").selectOption("60");
      await expect.poll(() => panel.getByText(/Custom fonts sew best above/).count()).toBe(0); // 5 mm is fine at 60 wt
      await panel.getByLabel("Letter height in millimetres").fill("3.5");
      await panel.getByText(/Custom fonts sew best above 4 mm/).waitFor();
      await j.shot("7-below-4mm-60wt");
      expect(await small.count()).toBe(0); // a custom font carries its own warning, no second one

      // a built-in font at 5 mm on 40 wt: the generic warning
      await page.getByLabel("Thread weight").selectOption("40");
      await panel.getByRole("button", { name: "New text" }).click();
      await panel.getByLabel("Letter height in millimetres").fill("5");
      await panel.getByRole("list", { name: "Built-in fonts" }).getByRole("button").first().click();
      await small.waitFor();
      expect(await small.innerText()).toMatch(/under 6 mm/);

      j.expectClean();
    });
  });
});
