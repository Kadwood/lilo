// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { readEmbroidery, designToEmbroidery } from "@lilo/engine";
import { initVtracerNode } from "@lilo/engine/node";
import { sampleDesign } from "../../../engine/src/stitch/sample-design";
import { createInlineEngine } from "../engine/client";
import { createMockPlatform, type MockState } from "../platform/mock";
import { setPlatform } from "../platform";
import { classifyInput, convertInput, targetsFor, uniqueNames } from "../state/converter";
import { converter, converterStore } from "../state/converterStore";
import { DEFAULT_UI_OPTIONS, toEngineOptions } from "../state/editorStore";
import { lastEditor, renderEditor } from "../test/helpers";
import { AppContext, type AppApi } from "./AppContext";
import { ConverterView } from "./ConverterView";

// the badge fixture stands in for a decoded PNG
vi.mock("../io/decode", async (orig) => {
  const real = await orig<typeof import("../io/decode")>();
  const { badge } = await import("../../../engine/test/fixtures/fixtures");
  return { ...real, decodeFile: vi.fn(async () => ({ kind: "raster", image: badge(), reference: null })) };
});

const T = { timeout: 30_000 };
const engine = createInlineEngine(() => initVtracerNode());
const design = sampleDesign();
const file = (ext: "pes" | "dst" | "jef" | "exp") => ({ name: `crest.${ext}`, bytes: designToEmbroidery(design, ext, { label: "crest" }).bytes });
const stitches = (bytes: Uint8Array, ext: string) => readEmbroidery(bytes, ext).plan.stitches.filter((s) => s.type === "stitch").length;
const opts = toEngineOptions(DEFAULT_UI_OPTIONS);

describe("convert: what a file is", () => {
  it("knows embroidery files, pictures and everything else", () => {
    for (const n of ["a.pes", "a.DST", "a.jef", "a.vp3", "a.exp", "a.xxx", "a.u01", "a.pec", "a.hus", "a.VIP", "a.tbf"]) expect(classifyInput(n)).toBe("embroidery");
    // G-code is write-only, so a dropped .gcode is not something the Converter can read
    expect(classifyInput("a.gcode")).toBe("unknown");
    for (const n of ["a.png", "a.JPG", "a.jpeg", "a.webp", "a.svg"]) expect(classifyInput(n)).toBe("image");
    for (const n of ["a.txt", "a.lilo", "noextension", "a."]) expect(classifyInput(n)).toBe("unknown");
  });
  it("offers the formats an input can become, and the traced SVG for pictures only", () => {
    expect(targetsFor("embroidery")).toHaveLength(12);
    expect(targetsFor("embroidery")).toContain("gcode");
    expect(targetsFor("embroidery")).not.toContain("svg");
    expect(targetsFor("image", "a.png")).toContain("svg");
    expect(targetsFor("image", "a.svg")).not.toContain("svg");
    expect(targetsFor("unknown")).toEqual([]);
  });
  it("keeps two outputs with the same name apart", () => {
    expect(uniqueNames([{ name: "a.pes" }, { name: "a.pes" }, { name: "b.pes" }, { name: "a.pes" }]).map((f) => f.name)).toEqual(["a.pes", "a (2).pes", "b.pes", "a (3).pes"]);
  });
});

describe("convert: embroidery to embroidery", () => {
  it("DST to PES keeps the stitches and says colours were made up", async () => {
    const src = file("dst");
    const [out] = await convertInput(engine, src, ["pes"], opts);
    expect(out.name).toBe("crest.pes");
    expect(stitches(out.bytes, "pes")).toBeGreaterThan(100);
    expect(out.warnings.join(" ")).toMatch(/DST files don't store thread colours, so placeholder colours were assigned/);
  });

  it("PES to HUS, VIP, TBF and G-code: the first three read back, G-code is a stitch path", async () => {
    const src = file("pes");
    const outs = await convertInput(engine, src, ["hus", "vip", "tbf", "gcode"], opts);
    expect(outs.map((o) => o.name)).toEqual(["crest.hus", "crest.vip", "crest.tbf", "crest.gcode"]);
    const want = stitches(src.bytes, "pes");
    for (const o of outs.slice(0, 3)) expect(stitches(o.bytes, o.target), o.name).toBe(want);
    expect(new TextDecoder().decode(outs[3].bytes)).toMatch(/^\(STITCH_COUNT: \d+\)[\s\S]*M30\n$/);
    // and a HUS file can be dropped back in
    const [back] = await convertInput(engine, { name: "crest.hus", bytes: outs[0].bytes }, ["pes"], opts);
    expect(stitches(back.bytes, "pes")).toBe(want);
  });

  it("PES to DST warns that colours are not kept; PES to JEF and VP3 do not", async () => {
    const src = file("pes");
    const outs = await convertInput(engine, src, ["dst", "jef", "vp3"], opts);
    expect(outs.map((o) => o.name)).toEqual(["crest.dst", "crest.jef", "crest.vp3"]);
    expect(outs[0].warnings.join(" ")).toMatch(/DST files don't store thread colours; only the colour changes are kept/);
    expect(outs[1].warnings).toEqual([]);
    expect(outs[2].warnings).toEqual([]);
    for (const [o, ext] of [[outs[0], "dst"], [outs[1], "jef"], [outs[2], "vp3"]] as const) expect(stitches(o.bytes, ext)).toBeGreaterThan(100);
  });

  it("a corrupt file is a readable error, and the SVG target is skipped for it", async () => {
    await expect(convertInput(engine, { name: "bad.pes", bytes: new Uint8Array([1, 2, 3, 4]) }, ["dst"], opts)).rejects.toThrow(/PES file could not be read|not a|corrupt|invalid/i);
    const [only] = await convertInput(engine, file("pes"), ["svg", "dst"], opts);
    expect(only.target).toBe("dst");
  });

  it("an unknown kind of file is refused with what Lilo does read", async () => {
    await expect(convertInput(engine, { name: "notes.txt", bytes: new Uint8Array([1]) }, ["pes"], opts)).rejects.toThrow(/can't convert "notes\.txt".*PES.*SVG/);
  });
});

describe("convert: pictures", () => {
  it("a picture is digitized with the editor's settings, then written in each format, or saved as the traced SVG", async () => {
    const outs = await convertInput(engine, { name: "badge.png", bytes: new Uint8Array(4) }, ["pes", "dst", "svg"], { ...opts, widthMm: 40 });
    expect(outs.map((o) => o.name)).toEqual(["badge.pes", "badge.dst", "badge.svg"]);
    expect(stitches(outs[0].bytes, "pes")).toBeGreaterThan(300);
    expect(outs[0].warnings[0]).toMatch(/Auto digitize settings in the editor \(6 colours\)/);
    expect(outs[1].warnings.join(" ")).toMatch(/DST files don't store thread colours/);
    const svg = new TextDecoder().decode(outs[2].bytes);
    expect(svg).toMatch(/<svg/);
    expect(svg).toMatch(/<path/);
    expect(outs[2].warnings[0]).toMatch(/not a stitch file/);
  }, 60_000);
});

describe("Converter screen", () => {
  let mock: MockState;
  let go: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    converter.reset();
    const m = createMockPlatform({ kind: "tauri" });
    mock = m.state;
    setPlatform(m.platform);
  });
  afterEach(() => {
    cleanup();
    setPlatform(null);
    converter.reset();
  });

  const mount = () => {
    go = vi.fn();
    return renderEditor(
      <AppContext.Provider value={{ view: "converter", go: go as unknown as AppApi["go"] }}>
        <ConverterView />
      </AppContext.Provider>,
      { engine },
    );
  };
  const choose = async (files: { name: string; bytes: Uint8Array }[]) => {
    mock.pickFiles = files;
    fireEvent.click(screen.getByRole("button", { name: "Choose files…" }));
    await waitFor(() => expect(converterStore.getState().items).toHaveLength(files.length));
  };

  it("lists the files, converts them to the ticked formats and shows each result with its warnings", async () => {
    mount();
    await choose([file("dst"), file("pes")]);
    const list = screen.getByRole("list", { name: "Files to convert" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByLabelText(/^PES/)).toHaveProperty("checked", true);
    fireEvent.click(screen.getByLabelText(/^JEF/));
    fireEvent.click(screen.getByRole("button", { name: "Convert" }));
    const results = await screen.findByRole("region", { name: "Results" }, T);
    await waitFor(() => expect(within(results).getAllByRole("listitem").filter((l) => l.classList.contains("conv-row"))).toHaveLength(4), T);
    expect(within(results).getByText("crest.pes")).toBeTruthy();
    // the DST input lost its colours once: both its outputs carry the warning
    expect(within(results).getAllByText(/DST files don't store thread colours, so placeholder colours were assigned/)).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Convert" })).toBeTruthy();
  });

  it("Save all writes every output into one chosen folder; Save… writes one file", async () => {
    mount();
    await choose([file("pes")]);
    fireEvent.click(screen.getByLabelText(/^DST/));
    fireEvent.click(screen.getByRole("button", { name: "Convert" }));
    await screen.findByRole("region", { name: "Results" }, T);
    fireEvent.click(screen.getByRole("button", { name: "Save all to a folder…" }));
    await waitFor(() => expect(mock.saved.map((s) => s.name)).toEqual(["crest.pes", "crest.dst"]), T);
    expect(screen.getByText(/Saved 2 files to \/mock/)).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Save…" })[1]);
    await waitFor(() => expect(mock.saved).toHaveLength(3));
    expect(mock.saved[2].name).toBe("crest.dst");
  });

  it("a file Lilo cannot read is listed with a reason; a corrupt one fails alone", async () => {
    mount();
    await choose([{ name: "notes.txt", bytes: new Uint8Array([1]) }, { name: "bad.pes", bytes: new Uint8Array([1, 2, 3]) }, file("pes")]);
    expect(screen.getByText("Lilo can't read this kind of file.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Convert" }));
    await waitFor(() => expect(converterStore.getState().running).toBe(false), T);
    await waitFor(() => expect(converterStore.getState().items.map((i) => i.status)).toEqual(["error", "error", "done"]), T);
    expect(screen.getAllByRole("alert").length).toBeGreaterThanOrEqual(2);
    expect(await screen.findByRole("region", { name: "Results" })).toBeTruthy();
  });

  it("pictures offer the traced SVG and say which settings they use", async () => {
    mount();
    await choose([{ name: "logo.png", bytes: new Uint8Array(4) }]);
    expect(screen.getByLabelText(/^SVG \(traced picture\)/)).toBeTruthy();
    expect(screen.getByText(/digitized with the Auto digitize settings in the editor/)).toBeTruthy();
  });

  it("Open in editor adds the file's stitches to the design as manual-stitch objects, undoably, and goes to the editor", async () => {
    mount();
    await choose([file("pes")]);
    fireEvent.click(screen.getByRole("button", { name: "Open in editor" }));
    await waitFor(() => expect(go).toHaveBeenCalledWith("editor"), T);
    const d = lastEditor!.state.design!;
    expect(d.objects.length).toBeGreaterThan(0);
    expect(d.objects.every((o) => o.kind === "run")).toBe(true); // an existing file opens as manual stitches, every needle drop kept
    expect(lastEditor!.state.undoLabel).toBe("Import crest.pes");
    act(() => lastEditor!.actions.undo());
    expect(lastEditor!.state.design!.objects).toHaveLength(0);
  });

  it("accepts dropped files and can remove one", async () => {
    mount();
    const zone = document.querySelector(".dropzone")!;
    const f = new File([file("pes").bytes as BlobPart], "dropped.pes");
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { files: [f] } });
    });
    await waitFor(() => expect(converterStore.getState().items.map((i) => i.name)).toEqual(["dropped.pes"]));
    fireEvent.click(screen.getByRole("button", { name: "Remove dropped.pes" }));
    expect(converterStore.getState().items).toHaveLength(0);
  });
});
