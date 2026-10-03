import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { collectCustomFonts, defaultServices, restoreCustomFonts } from "./fonts";

const ttf = readFileSync(join(import.meta.dirname, "../../../engine/test/fixtures/fonts/PlayfairDisplay-VF.ttf"));
const bytes = ttf.buffer.slice(ttf.byteOffset, ttf.byteOffset + ttf.byteLength) as ArrayBuffer;

describe("uploaded fonts inside a project", () => {
  it("an uploaded font can be collected for the file, and restored on a machine that never had it, then used", async () => {
    const added = await defaultServices.addCustom({ name: "Brand.ttf", bytes });
    const [out] = await collectCustomFonts([added.key, "missing#0"]);
    expect(out).toMatchObject({ id: added.key, name: added.name, ext: "ttf" });
    expect(out.bytes.length).toBe(ttf.length);
    expect(await collectCustomFonts(["missing#0"])).toEqual([]);

    await defaultServices.removeCustom(added.key);
    expect((await defaultServices.listCustom()).some((f) => f.key === added.key)).toBe(false);
    await restoreCustomFonts([{ id: added.key, name: added.name, bytes: out.bytes }]);
    const back = (await defaultServices.listCustom()).find((f) => f.key === added.key);
    expect(back).toMatchObject({ key: added.key, name: added.name });

    // and it lays text out
    const r = await defaultServices.layout({ font: { kind: "custom", key: added.key }, text: "Hi", heightMm: 12, letterSpacingMm: 0, lineSpacing: 1, align: "center", threadId: "t", idPrefix: "text-1" });
    expect(r.objects.length).toBeGreaterThan(0);
    await defaultServices.removeCustom(added.key);
  }, 60_000);

  it("a font the user already has under that key is kept, not replaced", async () => {
    const added = await defaultServices.addCustom({ name: "Mine.ttf", bytes });
    await restoreCustomFonts([{ id: added.key, name: "Other name", bytes: new Uint8Array([1, 2, 3]) }]);
    expect((await collectCustomFonts([added.key]))[0].bytes.length).toBe(ttf.length);
    await defaultServices.removeCustom(added.key);
  }, 60_000);
});
