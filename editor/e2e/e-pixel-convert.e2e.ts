import { afterAll, describe, expect, it } from "vitest";
import { readEmbroidery } from "@lilo/engine";
import { fixture, openApp, savedFiles, stopStack } from "./harness";

afterAll(stopStack);

const stitchCount = (name: string, bytes: number[]) => readEmbroidery(new Uint8Array(bytes), name.split(".").pop()!).plan.stitches.filter((s) => s.type === "stitch").length;

describe("journey e: pixel art and the converter", () => {
  it("paints pixel art, sends it to the editor and exports it", async () => {
    const j = await openApp("e-pixel");
    const { page } = j;
    await j.run(async () => {
      await page.getByRole("button", { name: "Pixel art", exact: true }).first().click();
      const canvas = page.getByTestId("pixel-canvas");
      await canvas.waitFor();
      await j.shot("1-empty-grid");
      const box = (await canvas.boundingBox())!;
      const at = (fx: number, fy: number): [number, number] => [box.x + box.width * fx, box.y + box.height * fy];

      // pencil: drag a stroke; pick another colour; draw a rectangle; fill
      const swatches = page.getByRole("group", { name: "Palette colours" }).getByRole("button");
      await swatches.nth(1).click();
      let [x, y] = at(0.2, 0.2);
      await page.mouse.move(x, y);
      await page.mouse.down();
      [x, y] = at(0.8, 0.2);
      await page.mouse.move(x, y, { steps: 12 });
      await page.mouse.up();
      await swatches.nth(5).click();
      await page.getByRole("button", { name: /^Rectangle/ }).click();
      [x, y] = at(0.2, 0.4);
      await page.mouse.move(x, y);
      await page.mouse.down();
      [x, y] = at(0.8, 0.8);
      await page.mouse.move(x, y, { steps: 8 });
      await page.mouse.up();
      await swatches.nth(9).click();
      await page.getByRole("button", { name: /^Fill/ }).click();
      [x, y] = at(0.5, 0.6);
      await page.mouse.click(x, y);
      await j.shot("2-painted");
      await page.getByLabel("Stitch preview", { exact: false }).getByText(/stitches/).first().waitFor({ timeout: 30_000 });
      await j.shot("3-preview");
      const used = await page.getByRole("list", { name: "Colours in the picture" }).getByRole("listitem").count();
      expect(used).toBeGreaterThanOrEqual(3);

      // undo and redo work on the grid
      await page.keyboard.press("Control+z");
      await page.keyboard.press("Control+Shift+z");

      // export from the pixel screen
      await page.getByRole("button", { name: "Export…" }).click();
      const dialog = page.getByRole("dialog", { name: "Export" });
      await dialog.getByLabel("Export stats").waitFor({ timeout: 30_000 });
      await j.shot("4-pixel-export");
      await dialog.getByRole("button", { name: /^Save/ }).click();
      await dialog.waitFor({ state: "detached" });
      const first = (await savedFiles(page)).at(-1)!;
      expect(first.name).toMatch(/\.pes$/);
      expect(stitchCount(first.name, first.bytes)).toBeGreaterThan(200);

      // send to the editor: the cells become objects, then export from the editor
      await page.getByRole("button", { name: "Send to editor" }).click();
      await page.getByRole("button", { name: "Export" }).first().waitFor();
      await page.getByText(/\d[\d,]* \/ [\d,]+ stitches/).waitFor({ timeout: 60_000 });
      await j.shot("5-in-editor");
      await page.getByRole("button", { name: "Export" }).first().click();
      const ed = page.getByRole("dialog", { name: "Export" });
      await ed.getByLabel("Export stats").waitFor({ timeout: 30_000 });
      await ed.getByRole("button", { name: /^Save/ }).click();
      await ed.waitFor({ state: "detached" });
      const second = (await savedFiles(page)).at(-1)!;
      expect(stitchCount(second.name, second.bytes)).toBeGreaterThan(200);
      j.expectClean();
    });
  });

  it("converts several files at once, with warnings, and saves them", async () => {
    const j = await openApp("e-convert");
    const { page } = j;
    await j.run(async () => {
      const files = await page.evaluate(() => {
        const s = (window as unknown as { __samples: Record<string, Uint8Array> }).__samples;
        return { pes: [...s.pes], dst: [...s.dst] };
      });
      const logo = [...fixture("k-logo.png")];
      const text = [...new TextEncoder().encode("not an embroidery file")];
      await page.evaluate(
        ([pes, dst, png, txt]) => {
          window.__lilo!.state.pickFiles = [
            { name: "monogram.pes", bytes: new Uint8Array(pes) },
            { name: "crest.dst", bytes: new Uint8Array(dst) },
            { name: "k-logo.png", bytes: new Uint8Array(png) },
            { name: "notes.txt", bytes: new Uint8Array(txt) },
          ];
        },
        [files.pes, files.dst, logo, text] as const,
      );
      await page.getByRole("button", { name: "Converter", exact: true }).first().click();
      await page.getByRole("button", { name: "Choose files…" }).click();
      const list = page.getByRole("list", { name: "Files to convert" });
      await expect.poll(() => list.getByRole("listitem").count()).toBe(4);
      await j.shot("1-files");
      expect(await list.innerText()).toMatch(/not supported/);
      // tick formats: the colourless ones warn that thread colours are lost
      for (const t of [/DST ·/, /JEF ·/, /PES ·/]) {
        const box = page.getByRole("group", { name: "Convert to" }).getByRole("checkbox", { name: t });
        if (!(await box.isChecked())) await box.check();
      }
      await page.getByRole("button", { name: "Convert", exact: true }).click();
      await page.getByRole("region", { name: "Results" }).waitFor({ timeout: 90_000 });
      await j.shot("2-results");
      const results = await page.getByRole("region", { name: "Results" }).innerText();
      expect(results).toMatch(/monogram\.dst/);
      expect(results).toMatch(/crest\.pes/);
      // a DST has no thread colours: converting it says so (warnings are listed with the result)
      await expect.poll(() => page.getByRole("list", { name: /^Warnings for/ }).count()).toBeGreaterThan(0);
      // the unsupported file reports an error instead of crashing the batch
      expect(await list.innerText()).toMatch(/notes\.txt/);
      expect(await page.getByRole("alert").count()).toBeGreaterThan(0);
      await page.getByRole("button", { name: "Save all to a folder…" }).click();
      await expect.poll(async () => (await savedFiles(page)).length).toBeGreaterThanOrEqual(4);
      const saved = await savedFiles(page);
      for (const s of saved.filter((f) => /\.(dst|pes|jef)$/.test(f.name))) expect(stitchCount(s.name, s.bytes)).toBeGreaterThan(100);
      await j.shot("3-saved");
      j.expectClean();
    });
  });
});
