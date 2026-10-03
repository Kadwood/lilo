import { afterAll, describe, expect, it } from "vitest";
import { fixture, openApp, pickFile, savedFiles, stopStack } from "./harness";

afterAll(stopStack);

describe("journey i: tour, hints, help and the workflow strip", () => {
  it("runs the 'picture' tour end to end, opens the right guide page from a ?, and ticks the strip", async () => {
    // `&tour` asks for the first-launch tour even in the ?mock pages (it is skipped there otherwise)
    const j = await openApp("i", { query: "&tour" });
    const { page } = j;
    await j.run(async () => {
      // the welcome: four ways to start
      const welcome = page.getByRole("dialog", { name: /Hi, I am your Lilo guide/ });
      await welcome.waitFor();
      expect(await welcome.locator("[data-path]").evaluateAll((els) => els.map((e) => e.getAttribute("data-path")))).toEqual(["picture", "draw", "monogram", "open"]);
      await j.shot("1-tour-welcome");
      await welcome.getByRole("button", { name: /Stitch a picture/ }).click();

      const card = (title: string) => page.getByRole("dialog", { name: `Tour: ${title}` });

      // 1. choose a picture: the card waits for the real thing
      await card("Choose your picture").waitFor();
      await j.shot("2-tour-coach-mark");
      await pickFile(page, "k-logo.png", fixture("k-logo.png"));
      await page.getByRole("button", { name: "Digitize a picture…" }).click();
      // ...and moves on by itself once there are stitches
      await card("How many colours?").waitFor({ timeout: 60_000 });
      await page.getByText(/\d[\d,]* \/ [\d,]+ stitches/).waitFor({ timeout: 60_000 });

      // the strip: a design now exists
      const step = (id: string) => page.locator(`.stepper [data-step="${id}"]`);
      await expect(step("design").getAttribute("data-done")).resolves.toBe("true");
      await page.waitForFunction(() => document.querySelector('.stepper [data-step="size"]')?.getAttribute("data-done") === "true", null, { timeout: 30_000 });
      expect(await step("preview").getAttribute("data-done")).toBe("false");
      expect(await step("send").getAttribute("data-done")).toBe("false");

      await card("How many colours?").getByRole("button", { name: "Next" }).click();
      await card("Set the size").getByRole("button", { name: "Next" }).click();
      // 4. the sewing card: open it, as the card asks
      await card("What are you sewing on?").waitFor();
      await page.getByRole("button", { name: /Suiting|Shirting|Twill|Knit|Denim|Towel|Leather/ }).first().click();
      await card("Check the hoop").waitFor();
      await card("Check the hoop").getByRole("button", { name: "Next" }).click();

      // 6. play: the strip ticks Preview
      await card("Watch it sew").waitFor();
      await page.getByRole("group", { name: "Stitch player" }).getByRole("button", { name: "Play", exact: true }).click();
      await card("Your progress").waitFor();
      await page.waitForFunction(() => document.querySelector('.stepper [data-step="preview"]')?.getAttribute("data-done") === "true");
      await j.shot("3-strip-ticked");
      await card("Your progress").getByRole("button", { name: "Next" }).click();

      // 8. send: opening Send or Export is what the card waits for
      await card("Send or export").waitFor();
      await page.getByRole("button", { name: "Export" }).first().click();
      await page.getByRole("status").filter({ hasText: "You are all set" }).waitFor();
      await page.getByRole("dialog", { name: "Export" }).waitFor();
      // saving the file ticks the last step
      await page.getByRole("dialog", { name: "Export" }).getByRole("button", { name: /^Save/ }).click();
      await page.getByRole("dialog", { name: "Export" }).waitFor({ state: "detached" });
      expect((await savedFiles(page)).length).toBe(1);
      await page.waitForFunction(() => document.querySelector('.stepper [data-step="send"]')?.getAttribute("data-done") === "true");
      await page.getByRole("button", { name: "Close", exact: true }).click(); // the thank-you card

      // the tour is remembered
      expect(await page.evaluate(() => window.localStorage.getItem("lilo.tour"))).toBe("done");

      // a "?" opens the right page: Quality -> "Standard or Premium quality"
      await page.locator('[data-hint="digitize.quality"]').click();
      const hint = page.getByRole("dialog", { name: /Quality: help/ });
      await hint.waitFor();
      await j.shot("4-hint-card");
      await hint.getByRole("button", { name: "Read more in the guide" }).click();
      const help = page.getByRole("dialog", { name: "Help" });
      await help.getByRole("heading", { name: "Standard or Premium quality" }).waitFor();
      await page.waitForTimeout(400); // the panel slides in
      await j.shot("5-help-panel");

      // the guide is searchable
      await help.getByRole("button", { name: /All topics/ }).click();
      await help.getByLabel("Search the guide").fill("pucker");
      await help.getByRole("button", { name: /Fixing sew-out problems/ }).click();
      await help.getByRole("heading", { name: "Puckering" }).waitFor();
      await page.keyboard.press("Escape");
      await help.waitFor({ state: "detached" });

      // the keyboard shortcut opens the page for the screen you are on
      await page.keyboard.press("Control+?");
      await help.getByRole("heading", { name: "The screen at a glance" }).waitFor();
      await page.keyboard.press("Control+?");
      await help.waitFor({ state: "detached" });

      // a live warning: a 220 mm square is bigger than any NV2700 hoop. The fix button looks for a hoop; none of this machine fits, so it opens the hoop list
      await page.getByLabel("Width in millimetres").fill("220");
      await page.getByRole("button", { name: "Digitize", exact: true }).click();
      const tray = page.getByRole("region", { name: "Design warnings" });
      await tray.getByText(/bigger than the hoop/).waitFor({ timeout: 60_000 });
      await j.shot("6-live-warning");
      await tray.getByRole("button", { name: "Pick the smallest hoop that fits" }).click();
      await page.getByRole("dialog", { name: "Choose a hoop" }).waitFor();

      j.expectClean();
    });
  });
});
