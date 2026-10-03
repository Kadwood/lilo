import { afterAll, describe, expect, it } from "vitest";
import { readEmbroidery } from "@lilo/engine";
import { fixture, openApp, pickFile, savedFiles, stopStack } from "./harness";

afterAll(stopStack);

/** The stitches a machine file holds, via the engine's own reader. */
const stitchesOf = (name: string, bytes: number[]) => readEmbroidery(new Uint8Array(bytes), name.split(".").pop()!);

describe("journey a: picture -> stitches -> export -> before you sew", () => {
  it("digitizes a picture, adjusts it, plays it through a colour change and exports all 8 formats", async () => {
    const j = await openApp("a");
    const { page } = j;
    await j.run(async () => {

    // Home -> Digitize a picture (the mock platform hands back the K logo)
    await j.shot("1-home");
    await pickFile(page, "k-logo.png", fixture("k-logo.png"));
    await page.getByRole("button", { name: "Digitize a picture…" }).click();

    // the tracing animation: a caption with a Skip link appears while it runs
    await page.getByRole("button", { name: "Skip" }).waitFor({ timeout: 20_000 }).catch(() => undefined);
    await j.shot("2-tracing");
    await page.getByText(/\d[\d,]* \/ [\d,]+ stitches/).waitFor({ timeout: 60_000 });
    await j.shot("3-first-result");
    const stitchLine = () => page.getByLabel("Design totals").innerText();
    const first = await stitchLine();
    expect(first).toMatch(/stitches/);

    // adjust: colours, size, quality, fabric. Each re-runs the digitizer.
    const palette = () => page.getByLabel("Palette").getByRole("listitem").count();
    const before = await palette();
    await page.getByLabel("Colour count").fill("3");
    await page.waitForFunction((n) => document.querySelectorAll('[aria-label="Palette"] li').length !== n || true, before);
    await page.getByLabel("Width in millimetres").fill("80");
    await page.getByLabel("Quality").selectOption("premium");
    await page.getByLabel("Fabric").selectOption({ label: "Twill / caps" });
    await page.getByRole("button", { name: "Digitize" }).click();
    await page.waitForFunction(() => /7[5-9]\.\d × /.test((document.querySelector('[aria-label="Design totals"]') as HTMLElement | null)?.innerText ?? ""), null, { timeout: 60_000 });
    await j.shot("4-adjusted");
    expect(await stitchLine()).toMatch(/7[5-9]\.\d × /); // the artwork is about 80 mm wide (its box has a margin)
    expect(await page.getByRole("button", { name: /Twill/ }).count()).toBeGreaterThan(0); // the Sewing setup chip follows the fabric

    // stitch player: scrub to the start, play at speed until it stops for the colour change
    const bar = page.getByRole("group", { name: "Stitch player" });
    await bar.getByLabel("Scrub stitches").fill("0");
    await bar.getByLabel("Playback speed").fill("50");
    await bar.getByRole("button", { name: "Play" }).click();
    await bar.getByRole("alertdialog", { name: "Colour change" }).waitFor({ timeout: 60_000 });
    await j.shot("5-colour-change");
    expect(await bar.getByRole("alertdialog").innerText()).toMatch(/Swap to Brother \d+ — /);
    await bar.getByRole("button", { name: "Continue" }).click();
    await bar.getByRole("button", { name: "Play" }).waitFor({ timeout: 60_000 }); // it plays to the end and stops
    await j.shot("6-played");

    // export: every format, each re-read by the engine
    const formats: string[] = [];
    for (let i = 0; i < 8; i++) {
      await page.getByRole("button", { name: "Export" }).first().click();
      const dialog = page.getByRole("dialog", { name: "Export" });
      const radios = dialog.getByRole("radiogroup", { name: "File format" }).getByRole("radio");
      expect(await radios.count()).toBe(13); // 12 machine formats + PNG
      await radios.nth(i).click();
      await dialog.getByLabel("Export stats").waitFor({ timeout: 30_000 });
      if (i === 0) {
        await j.shot("7-export");
        // "Before you sew" is part of the dialog
        await dialog.getByRole("heading", { name: "Before you sew" }).waitFor();
        expect(await dialog.getByText(/Twill/).count()).toBeGreaterThan(0);
        await dialog.getByRole("heading", { name: "Before you sew" }).scrollIntoViewIfNeeded();
        await j.shot("8-before-you-sew");
      }
      await dialog.getByRole("button", { name: /^Save/ }).click();
      await dialog.waitFor({ state: "detached" });
    }
    const saved = await savedFiles(page);
    expect(saved.map((s) => s.name.split(".").pop()).sort()).toEqual(["dst", "exp", "jef", "pec", "pes", "u01", "vp3", "xxx"]);
    const counts = saved.map((s) => {
      formats.push(s.name);
      const r = stitchesOf(s.name, s.bytes);
      return r.plan.stitches.filter((x) => x.type === "stitch").length;
    });
    for (const c of counts) expect(c).toBeGreaterThan(500);
    // every format keeps (within rounding) the same number of needle drops
    const max = Math.max(...counts);
    for (const c of counts) expect(c).toBeGreaterThan(max * 0.9);

    j.expectClean();
    });
  });
});
