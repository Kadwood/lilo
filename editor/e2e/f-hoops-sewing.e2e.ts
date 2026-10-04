import { afterAll, describe, expect, it } from "vitest";
import type { Page } from "playwright-core";
import { fixture, openApp, pickFile, stopStack } from "./harness";

afterAll(stopStack);

const hoopButton = (page: Page) => page.getByRole("button", { name: /^Hoop: .*Change$/ }).first();

describe("journey f: hoops and the Sewing setup", () => {
  it("picks, adds and fits hoops, shows actual size and rulers; a Sewing setup change keeps hand edits", async () => {
    const j = await openApp("f");
    const { page } = j;
    await j.run(async () => {
      await pickFile(page, "k-logo.png", fixture("k-logo.png"));
      await page.getByRole("button", { name: "Digitize a picture…" }).click();
      await page.getByText(/\d[\d,]* \/ [\d,]+ stitches/).waitFor({ timeout: 60_000 });
      await page.waitForTimeout(1500);

      // ---- hoop picker: search, pick -------------------------------------------------------
      await hoopButton(page).click();
      const picker = page.getByRole("dialog", { name: "Choose a hoop" });
      await j.shot("1-picker");
      await picker.getByLabel("Search hoops").fill("130x180");
      const results = picker.getByRole("list", { name: "Search results" });
      await results.getByRole("button").first().waitFor();
      await results.getByRole("button").first().click();
      await picker.waitFor({ state: "detached" }).catch(() => picker.getByRole("button", { name: "Close" }).click());
      await expect.poll(async () => (await hoopButton(page).getAttribute("aria-label")) ?? "").toMatch(/130 × 180|130x180/i);
      await j.shot("2-picked-130x180");

      // ---- smallest hoop that fits ---------------------------------------------------------
      await page.getByRole("button", { name: "Smallest hoop that fits" }).first().click();
      await page.waitForTimeout(500);
      await j.shot("3-smallest");
      const smallest = await hoopButton(page).getAttribute("aria-label");
      expect(smallest).toMatch(/Hoop: /);

      // ---- a custom hoop ---------------------------------------------------------------------
      await page.getByRole("button", { name: "Add my own…" }).click();
      const custom = page.getByRole("dialog", { name: "Add a hoop" });
      await custom.getByLabel("Name").fill("Jacket back hoop");
      await custom.getByLabel("Width (mm)").fill("200");
      await custom.getByLabel("Height (mm)").fill("300");
      await j.shot("4-custom-hoop");
      await custom.getByRole("button", { name: "Add hoop" }).click();
      await custom.waitFor({ state: "detached" });
      await expect.poll(async () => (await hoopButton(page).getAttribute("aria-label")) ?? "").toMatch(/Jacket back hoop/);
      // a bad size is refused with a message instead of being saved
      await page.getByRole("button", { name: "Add my own…" }).click();
      await custom.getByLabel("Name").fill("Too small");
      await custom.getByLabel("Width (mm)").fill("3");
      await custom.getByRole("button", { name: "Add hoop" }).click();
      await page.waitForTimeout(300);
      expect(await custom.isVisible()).toBe(true); // the field's own validation (10 mm minimum) kept the dialog open
      expect(await hoopButton(page).getAttribute("aria-label")).toMatch(/Jacket back hoop/);
      await custom.getByRole("button", { name: "Cancel" }).click();
      await custom.waitFor({ state: "detached" });

      // turn it a quarter
      const before = await hoopButton(page).getAttribute("aria-label");
      await page.getByRole("button", { name: "Turn 90°" }).first().click();
      await expect.poll(async () => await hoopButton(page).getAttribute("aria-label")).not.toBe(before);
      await j.shot("5-turned");

      // ---- rulers and actual size ----------------------------------------------------------------
      expect(await page.getByRole("img", { name: /^Top ruler/ }).count()).toBe(1);
      await page.getByRole("checkbox", { name: "Show rulers" }).uncheck();
      expect(await page.getByRole("img", { name: /^Top ruler/ }).count()).toBe(0);
      await page.getByRole("checkbox", { name: "Show rulers" }).check();
      expect(await page.getByRole("img", { name: /^Top ruler/ }).count()).toBe(1);
      const zoom = () => page.getByRole("group", { name: "Zoom" }).innerText();
      const fit = await zoom();
      await page.getByRole("button", { name: "Actual size ⌘0" }).click();
      // the browser cannot tell how big the screen is, so the first Actual size asks to calibrate it
      const calibrate = page.getByRole("dialog", { name: "Calibrate the screen" });
      await calibrate.waitFor();
      await j.shot("5b-calibrate");
      await calibrate.getByRole("button", { name: "Save" }).click();
      await calibrate.waitFor({ state: "detached" });
      await expect.poll(zoom).not.toBe(fit);
      await j.shot("6-actual-size");
      await page.getByRole("button", { name: "Fit", exact: true }).click();

      // ---- Sewing setup: a change updates auto shapes but keeps what the user set by hand ----------
      const rows = page.getByRole("complementary", { name: "Sequencer" }).locator("li.seq-row");
      await rows.first().click(); // select the first shape
      const pull = page.getByRole("spinbutton", { name: "Pull compensation value" });
      await pull.waitFor();
      const autoPull = await pull.inputValue();
      await pull.fill("0.33"); // a hand edit
      await pull.press("Tab");
      await page.waitForTimeout(500);
      await rows.nth(1).click();
      const otherBefore = await page.getByRole("spinbutton", { name: "Pull compensation value" }).inputValue();
      await j.shot("7-before-setup-change");

      await page.getByRole("button", { name: /· 40 wt ·/ }).click(); // the Sewing setup chip
      const card = page.getByRole("region", { name: "Sewing setup" });
      await card.getByLabel("Quality", { exact: true }).selectOption("premium");
      await card.getByLabel("Fabric", { exact: true }).selectOption({ label: "Denim" });
      const note = page.getByRole("status").filter({ hasText: /shape.* updated|Nothing in this design/ });
      await note.waitFor({ timeout: 30_000 });
      await j.shot("8-setup-changed");

      await rows.first().click();
      expect(await page.getByRole("spinbutton", { name: "Pull compensation value" }).inputValue()).toBe("0.33"); // the hand edit survived
      expect(autoPull).not.toBe("0.33");
      await rows.nth(1).click();
      expect(await page.getByRole("spinbutton", { name: "Pull compensation value" }).inputValue()).not.toBe(otherBefore); // the auto value followed the setup

      // undo brings the old setup back in one step
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // shortcuts are off while a select has focus
      await page.keyboard.press("Control+z"); // fabric
      await page.keyboard.press("Control+z"); // quality
      await page.waitForTimeout(500);
      await page.keyboard.press("Escape");
      await rows.nth(1).click();
      expect(await page.getByRole("spinbutton", { name: "Pull compensation value" }).inputValue()).toBe(otherBefore);
      j.expectClean();
    });
  });
});
