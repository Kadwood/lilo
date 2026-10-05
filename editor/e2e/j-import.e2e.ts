import { afterAll, describe, expect, it } from "vitest";
import { designToEmbroidery, loadProject, readEmbroidery } from "@lilo/engine";
import { sampleDesign } from "../../engine/src/stitch/sample-design";
import { openApp, projectFiles, stopStack } from "./harness";

afterAll(stopStack);

const pes = () => designToEmbroidery(sampleDesign(), "pes", { label: "rooster" }).bytes;
const needles = (b: Uint8Array) => readEmbroidery(b, "pes").plan.stitches.filter((s) => s.type === "stitch");

describe("journey j: open a stitch file", () => {
  it("opens a PES from Home as a new project, saves it as a .lilo without touching the PES, and takes a second PES as a layer", async () => {
    const j = await openApp("import");
    const { page } = j;
    await j.run(async () => {
      const bytes = pes();
      await page.evaluate((b) => void (window.__lilo!.state.pickProject = { path: "", name: "rooster.pes", bytes: new Uint8Array(b) }), [...bytes]);
      await page.getByRole("button", { name: "Open…" }).click();
      await page.getByRole("main", { name: "Canvas" }).waitFor();
      await page.getByRole("textbox", { name: "Project name" }).waitFor();
      expect(await page.getByRole("textbox", { name: "Project name" }).inputValue()).toBe("rooster");
      await page.waitForTimeout(1500);
      await j.shot("1-opened-pes");
      expect(await page.getByRole("complementary", { name: "Sew order" }).innerText()).toMatch(/rooster/);

      // the first Save is a Save As: a new .lilo, and nothing else written
      await page.keyboard.press("Control+s");
      await page.waitForFunction(() => [...window.__lilo!.state.files.keys()].some((p) => p.endsWith("rooster.lilo")));
      const files = await projectFiles(page);
      expect([...files.keys()].some((p) => p.endsWith(".pes"))).toBe(false);
      const saved = [...files.entries()].find(([p]) => p.endsWith("/rooster.lilo"))!;
      const design = loadProject(saved[1]).project.doc.design;
      expect(design.layers?.map((l) => l.name)).toEqual(["rooster"]);
      expect(design.hoop.name).toBeTruthy();

      // a second stitch file dropped on the open design is a new layer on top
      await page.evaluate((b) => {
        const dt = new DataTransfer();
        dt.items.add(new File([new Uint8Array(b)], "crest.pes"));
        document.querySelector(".canvas-stage")!.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      }, [...bytes]);
      await expect.poll(async () => (await page.getByRole("complementary", { name: "Sew order" }).innerText()).includes("crest")).toBe(true);
      expect(await page.getByRole("textbox", { name: "Project name" }).inputValue()).toBe("rooster");
      await page.waitForTimeout(800);
      await j.shot("2-dropped-as-layer");
      await page.keyboard.press("Control+z");
      await expect.poll(async () => (await page.getByRole("complementary", { name: "Sew order" }).innerText()).includes("crest")).toBe(false);
      expect(needles(bytes).length).toBeGreaterThan(100); // the file used here is a real design, not a stub
    });
    j.expectClean();
  });
});
