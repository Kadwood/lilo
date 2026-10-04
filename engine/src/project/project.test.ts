import { inflateSync } from "node:zlib";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { createPixelArt, addPixelThread, setPixel } from "../pixelart";
import { sampleDesign } from "../stitch/sample-design";
import { getCatalogue } from "../threads";
import { addFromCatalogue, emptyShelf } from "../threads/shelf";
import { emptyDesign } from "../model";
import {
  HISTORY_LIMIT,
  PROJECT_VERSION,
  ProjectError,
  addHistorySnapshot,
  addFont,
  addImage,
  MAX_FONT_BYTES,
  createProject,
  designThumbnailPng,
  historyDoc,
  loadProject,
  migrateProjectDoc,
  readProjectInfo,
  recoverHistory,
  removeImage,
  restoreHistory,
  saveProject,
  type LiloProject,
} from "./index";

const T = (n: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, n));
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 250, 251, 252, 253, 254, 255, 0]);

function fullProject(): LiloProject {
  let p = createProject({ title: "Crest", design: sampleDesign(), now: T(0) });
  p = addImage(p, { id: "ref1", name: "Photo.PNG", mime: "image/png", bytes: png, placement: { x: 10, y: -4, scale: 0.5, opacity: 0.4 } });
  p = addImage(p, { id: "ref2", name: "logo.svg", mime: "image/svg+xml", bytes: strToU8("<svg xmlns='http://www.w3.org/2000/svg'/>") });
  p = {
    ...p,
    doc: {
      ...p.doc,
      view: { zoom: 2.5, panX: 12, panY: -7, selectedIds: ["f1"] },
      shelf: addFromCatalogue(emptyShelf(), getCatalogue().threads[2], { qty: 2 }, T(0)),
      fonts: [
        { id: "mono", name: "Monogram", source: "builtin", licence: "OFL" },
        { id: "mine", name: "My Font", source: "custom", file: "fonts/mine.ttf" },
      ],
      pixelArt: addPixelThread(createPixelArt(4, 4), p.doc.design.threads[0]),
    },
    fonts: { mine: new Uint8Array([0, 1, 0, 0, 9, 9, 9]) },
    thumbnail: designThumbnailPng(sampleDesign(), { size: 64 }),
  };
  p.doc.pixelArt = setPixel(p.doc.pixelArt!, 1, 1, p.doc.design.threads[0].id);
  return p;
}

const zipOf = (files: Record<string, Uint8Array | string>) =>
  zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v])));

describe(".lilo project files", () => {
  it("round-trips design, view, images, fonts, shelf, pixel art, thumbnail", () => {
    const p = fullProject();
    const bytes = saveProject(p, T(5));
    const { project: back, warnings, migrated } = loadProject(bytes);
    expect(warnings).toEqual([]);
    expect(migrated).toBe(false);
    expect(back.doc.title).toBe("Crest");
    expect(back.doc.version).toBe(PROJECT_VERSION);
    expect(back.doc.savedAt).toBe(T(5).toISOString());
    expect(back.doc.design).toEqual(p.doc.design);
    expect(back.doc.view).toEqual(p.doc.view);
    expect(back.doc.shelf).toEqual(p.doc.shelf);
    expect(back.doc.pixelArt).toEqual(p.doc.pixelArt);
    expect(back.doc.fonts).toEqual(p.doc.fonts);
    expect(back.doc.images).toEqual(p.doc.images);
    expect(back.doc.images[0].file).toBe("images/ref1.png");
    expect(back.doc.images[1].file).toBe("images/ref2.svg");
    expect([...back.images.ref1]).toEqual([...png]);
    expect(strFromU8(back.images.ref2)).toContain("<svg");
    expect([...back.fonts.mine]).toEqual([0, 1, 0, 0, 9, 9, 9]);
    expect([...back.thumbnail!]).toEqual([...p.thumbnail!]);
  });

  it("is a plain zip with the documented layout", () => {
    const files = unzipSync(saveProject(fullProject(), T(1)));
    expect(Object.keys(files).sort()).toEqual(["fonts/mine.ttf", "images/ref1.png", "images/ref2.svg", "project.json", "thumbnail.png"]);
    const doc = JSON.parse(strFromU8(files["project.json"]));
    expect(doc).toMatchObject({ format: "lilo-project", version: PROJECT_VERSION, title: "Crest" });
  });

  it("saves deterministically for the same state and time", () => {
    const p = fullProject();
    expect([...saveProject(p, T(9))]).toEqual([...saveProject(p, T(9))]);
  });

  it("removes images cleanly", () => {
    const p = removeImage(fullProject(), "ref1");
    const back = loadProject(saveProject(p)).project;
    expect(back.doc.images.map((i) => i.id)).toEqual(["ref2"]);
    expect(back.images.ref1).toBeUndefined();
    expect(() => addImage(p, { id: "../evil", name: "x", mime: "image/png", bytes: png })).toThrow(ProjectError);
  });

  it("makes a real thumbnail: valid PNG, drawn pixels, blank for an empty design", () => {
    const decode = (b: Uint8Array) => {
      expect([...b.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
      const dv = new DataView(b.buffer, b.byteOffset);
      const w = dv.getUint32(16);
      const h = dv.getUint32(20);
      const idat: Uint8Array[] = [];
      for (let at = 8; at < b.length; ) {
        const len = dv.getUint32(at);
        const type = String.fromCharCode(...b.subarray(at + 4, at + 8));
        if (type === "IDAT") idat.push(b.subarray(at + 8, at + 8 + len));
        at += 12 + len;
      }
      return { w, h, raw: inflateSync(Buffer.concat(idat)) };
    };
    const t = decode(designThumbnailPng(sampleDesign(), { size: 96 }));
    expect([t.w, t.h]).toEqual([96, 96]);
    const colours = new Set<string>();
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) colours.add([...t.raw.subarray(y * 385 + 1 + x * 4, y * 385 + 1 + x * 4 + 3)].join(","));
    expect(colours.size).toBeGreaterThan(2); // background + at least two thread colours
    const blank = decode(designThumbnailPng(emptyDesign(), { size: 32 }));
    const bc = new Set<string>();
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) bc.add([...blank.raw.subarray(y * 129 + 1 + x * 4, y * 129 + 1 + x * 4 + 3)].join(","));
    expect(bc.size).toBe(1);
  });

  it("reads the gallery info without unpacking images", () => {
    const info = readProjectInfo(saveProject(fullProject(), T(3)));
    expect(info).toMatchObject({ title: "Crest", savedAt: T(3).toISOString(), version: PROJECT_VERSION });
    expect(info.thumbnail!.length).toBeGreaterThan(50);
  });
});

describe("embedded custom fonts", () => {
  it("addFont puts the bytes in fonts/ and they come back through save and load", () => {
    const bytes = new Uint8Array([0, 1, 0, 0, 9, 8, 7]);
    let p = createProject({ design: sampleDesign() });
    p = addFont(p, { id: "Brand.ttf#0", name: "Brand Sans", bytes, ext: "TTF" });
    p = addFont(p, { id: "Other.otf#0", name: "Other", bytes: new Uint8Array([1, 2]), ext: "otf" });
    expect(new Set(p.doc.fonts.map((f) => f.file)).size).toBe(2);
    const zip = unzipSync(saveProject(p, T(1)));
    expect(Object.keys(zip).filter((k) => k.startsWith("fonts/")).length).toBe(2);
    const back = loadProject(saveProject(p, T(1))).project;
    expect(back.doc.fonts.map((f) => [f.id, f.name, f.source])).toEqual([["Brand.ttf#0", "Brand Sans", "custom"], ["Other.otf#0", "Other", "custom"]]);
    expect(Array.from(back.fonts["Brand.ttf#0"])).toEqual(Array.from(bytes));
  });

  it("re-adding an id replaces it instead of duplicating", () => {
    let p = createProject({});
    p = addFont(p, { id: "a#0", name: "A", bytes: new Uint8Array([1]) });
    p = addFont(p, { id: "a#0", name: "A", bytes: new Uint8Array([2]) });
    expect(p.doc.fonts).toHaveLength(1);
    expect(Array.from(p.fonts["a#0"])).toEqual([2]);
  });

  it("refuses a font over 20 MB and an odd extension becomes ttf", () => {
    const p = createProject({});
    expect(() => addFont(p, { id: "big#0", name: "Big", bytes: new Uint8Array(MAX_FONT_BYTES + 1) })).toThrow(/over 20 MB/);
    expect(addFont(p, { id: "x#0", name: "X", bytes: new Uint8Array([1]), ext: "../../etc" }).doc.fonts[0].file).toMatch(/^fonts\/font-\d+\.ttf$/);
    expect(addFont(p, { id: "y#0", name: "Y", bytes: new Uint8Array(MAX_FONT_BYTES) }).doc.fonts).toHaveLength(1); // exactly 20 MB is fine
  });
});

describe("version history", () => {
  it("snapshots only when content changes (not for pan/zoom or re-saves)", () => {
    let p = createProject({ design: sampleDesign(), now: T(0) });
    p = addHistorySnapshot(p, T(1));
    expect(p.history).toHaveLength(1);
    expect(addHistorySnapshot(p, T(2))).toBe(p); // identical
    const panned = { ...p, doc: { ...p.doc, view: { ...p.doc.view, zoom: 9 } } };
    expect(addHistorySnapshot(panned, T(3))).toBe(panned);
    const renamed = { ...p, doc: { ...p.doc, title: "New name" } };
    expect(addHistorySnapshot(renamed, T(4)).history).toHaveLength(2);
  });

  it("keeps the latest 50 as a ring buffer and survives save/load", () => {
    let p = createProject({ now: T(0) });
    for (let i = 1; i <= 60; i++) {
      p = { ...p, doc: { ...p.doc, title: `v${i}` } };
      p = addHistorySnapshot(p, T(i));
    }
    expect(p.history).toHaveLength(HISTORY_LIMIT);
    expect(historyDoc(p.history[0]).title).toBe("v11");
    expect(historyDoc(p.history[HISTORY_LIMIT - 1]).title).toBe("v60");
    const back = loadProject(saveProject(p, T(100))).project;
    expect(back.history.map((h) => h.id)).toEqual(p.history.map((h) => h.id));
    expect(historyDoc(back.history[10]).title).toBe("v21");
    // numbering continues after a reload
    const more = addHistorySnapshot({ ...back, doc: { ...back.doc, title: "v61" } }, T(101));
    expect(more.history).toHaveLength(HISTORY_LIMIT);
    expect(more.history[HISTORY_LIMIT - 1].id.startsWith("000061-")).toBe(true);
  });

  it("restores an old state, snapshotting the current one first", () => {
    let p = createProject({ title: "one", now: T(0) });
    p = addHistorySnapshot(p, T(1));
    p = { ...p, doc: { ...p.doc, title: "two", view: { zoom: 3, panX: 1, panY: 1 } } };
    const restored = restoreHistory(p, p.history[0].id, T(2));
    expect(restored.doc.title).toBe("one");
    expect(restored.doc.view.zoom).toBe(3); // the view is not rewound
    expect(restored.history.map((h) => historyDoc(h).title)).toEqual(["one", "two"]);
    expect(() => restoreHistory(p, "nope")).toThrow(ProjectError);
  });
});

describe("migrations", () => {
  const raw = (over: Record<string, unknown> = {}) => ({ ...createProject({ now: T(0) }).doc, ...over });

  it("runs the chain from the file's version to the current one", () => {
    const migrations = {
      1: (d: Record<string, unknown>) => ({ ...d, title: `${String(d.title)}+v2` }),
      2: (d: Record<string, unknown>) => ({ ...d, title: `${String(d.title)}+v3` }),
    };
    const r = migrateProjectDoc(raw({ title: "T", version: 1 }), migrations, 3);
    expect(r.migrated).toBe(true);
    expect(r.doc.title).toBe("T+v2+v3");
    expect(r.doc.version).toBe(3);
  });

  it("refuses files from the future and gaps in the chain", () => {
    expect(() => migrateProjectDoc(raw({ version: 9 }))).toThrow(/newer version of Lilo/);
    expect(() => migrateProjectDoc(raw(), {}, PROJECT_VERSION + 1)).toThrow(/too old/);
    try {
      migrateProjectDoc(raw({ version: 9 }));
    } catch (e) {
      expect((e as ProjectError).code).toBe("unsupported-version");
    }
  });

  it("fills in harmless missing fields but rejects a broken design", () => {
    const { doc } = migrateProjectDoc({ format: "lilo-project", version: 1, design: emptyDesign() });
    expect(doc.title).toBe("Untitled");
    expect(doc.view).toEqual({ zoom: 1, panX: 0, panY: 0 });
    expect(doc.images).toEqual([]);
    expect(doc.shelf.entries).toEqual([]);
    const d = sampleDesign();
    d.objects[0].threadId = "ghost";
    expect(() => migrateProjectDoc(raw({ design: d }))).toThrow(/unknown thread/);
  });
});

describe("corrupt and hostile files", () => {
  const good = () => saveProject(fullProject(), T(1));
  const code = (f: () => unknown): string => {
    try {
      f();
    } catch (e) {
      expect(e).toBeInstanceOf(ProjectError);
      return (e as ProjectError).code;
    }
    return "no error";
  };

  it("not a zip at all", () => {
    expect(code(() => loadProject(new Uint8Array(0)))).toBe("not-a-project");
    expect(code(() => loadProject(strToU8("this is just text, not a zip file at all")))).toBe("not-a-project");
    expect(code(() => loadProject(new Uint8Array(500).fill(7)))).toBe("not-a-project");
  });

  it("truncated zip", () => {
    const b = good();
    expect(code(() => loadProject(b.subarray(0, b.length >> 1)))).toBe("not-a-project");
    expect(code(() => loadProject(b.subarray(0, 100)))).toBe("not-a-project");
  });

  it("a zip that is not a project", () => {
    expect(code(() => loadProject(zipOf({ "readme.txt": "hello" })))).toBe("missing-project-json");
    expect(code(() => loadProject(zipOf({ "project.json": "{ nope" })))).toBe("invalid-json");
    expect(code(() => loadProject(zipOf({ "project.json": JSON.stringify({ hello: 1 }) })))).toBe("not-a-project");
    expect(code(() => loadProject(zipOf({ "project.json": "[1,2]" })))).toBe("invalid-project");
  });

  it("a project whose document is damaged", () => {
    const doc = JSON.parse(strFromU8(unzipSync(good())["project.json"]));
    const variants: Record<string, (d: Record<string, unknown>) => void> = {
      "no design": (d) => delete d.design,
      "bad version": (d) => (d.version = "one"),
      "bad shelf": (d) => (d.shelf = { entries: [{ brand: 1 }] }),
      "bad image entry": (d) => (d.images = [{ id: 1 }]),
      "duplicate image": (d) => (d.images = [...(d.images as unknown[]), (d.images as unknown[])[0]]),
      "bad pixel art": (d) => (d.pixelArt = { width: 2, height: 2, cells: [], threads: [] }),
    };
    for (const [name, mutate] of Object.entries(variants)) {
      const d = structuredClone(doc);
      mutate(d);
      const c = code(() => loadProject(zipOf({ "project.json": JSON.stringify(d) })));
      expect(["invalid-project", "unsupported-version"], name).toContain(c);
    }
  });

  it("path traversal in image or font references is rejected", () => {
    const doc = JSON.parse(strFromU8(unzipSync(good())["project.json"]));
    for (const evil of ["../../etc/passwd", "/abs/path.png", "images/../../x", "images/a/b.png", "other/x.png", "images/.hidden"]) {
      const d = structuredClone(doc);
      d.images[0].file = evil;
      expect(code(() => loadProject(zipOf({ "project.json": JSON.stringify(d), [evil]: "x" }))), evil).toBe("invalid-project");
    }
    const d = structuredClone(doc);
    d.fonts[1].file = "../font.ttf";
    expect(code(() => loadProject(zipOf({ "project.json": JSON.stringify(d) })))).toBe("invalid-project");
  });

  it("a missing image or font is a warning, not a failure", () => {
    const files = unzipSync(good());
    delete files["images/ref1.png"];
    delete files["fonts/mine.ttf"];
    const { project, warnings } = loadProject(zipSync(files));
    expect(warnings).toHaveLength(2);
    expect(project.images.ref1).toBeUndefined();
    expect(project.doc.images).toHaveLength(2); // the reference is kept so the UI can show "missing"
  });

  it("an unreadable history entry is skipped with a warning", () => {
    let p = fullProject();
    p = addHistorySnapshot(p, T(1));
    p = addHistorySnapshot({ ...p, doc: { ...p.doc, title: "later" } }, T(2));
    const files = unzipSync(saveProject(p, T(3)));
    const names = Object.keys(files).filter((n) => n.startsWith("history/"));
    expect(names).toHaveLength(2);
    files[names[0]] = strToU8("{ broken");
    const { project, warnings } = loadProject(zipSync(files));
    expect(project.history).toHaveLength(1);
    expect(warnings[0]).toMatch(/history/);
  });

  it("recovers history when project.json is destroyed", () => {
    let p = fullProject();
    p = addHistorySnapshot(p, T(1));
    const files = unzipSync(saveProject(p, T(2)));
    files["project.json"] = strToU8("garbage");
    const bytes = zipSync(files);
    expect(code(() => loadProject(bytes))).toBe("invalid-json");
    const { entries } = recoverHistory(bytes);
    expect(entries).toHaveLength(1);
    expect(historyDoc(entries[0]).title).toBe("Crest");
  });

  it("refuses a zip with an absurd number of entries", () => {
    const many: Record<string, Uint8Array> = {};
    for (let i = 0; i < 5100; i++) many[`images/f${i}.png`] = new Uint8Array([1]);
    many["project.json"] = strToU8("{}");
    expect(code(() => loadProject(zipSync(many)))).toBe("not-a-project");
  });

  it("caps real decompressed size even when the zip header lies about it", () => {
    const real = new Uint8Array(3 * 1024 * 1024); // 3 MB of zeros, a few KB deflated
    const doc = strToU8(JSON.stringify({ format: "lilo-project", version: 1 }));
    const zip = zipSync({ "project.json": doc, "images/bomb.png": real });
    // rewrite the claimed uncompressed size (local header @22, central directory @24) to 10 bytes
    const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    let patched = 0;
    for (let i = 0; i + 46 < zip.length; i++) {
      const sig = dv.getUint32(i, true);
      if (sig !== 0x04034b50 && sig !== 0x02014b50) continue;
      const local = sig === 0x04034b50;
      const nameLen = dv.getUint16(i + (local ? 26 : 28), true);
      const nameAt = i + (local ? 30 : 46);
      if (strFromU8(zip.subarray(nameAt, nameAt + nameLen)) !== "images/bomb.png") continue;
      dv.setUint32(i + (local ? 22 : 24), 10, true);
      patched++;
    }
    expect(patched).toBe(2);
    expect(code(() => loadProject(zip, { maxFileBytes: 1024 * 1024 }))).toBe("not-a-project");
    expect(code(() => loadProject(zip, { maxTotalBytes: 1024 * 1024 }))).toBe("not-a-project");
  });
});
