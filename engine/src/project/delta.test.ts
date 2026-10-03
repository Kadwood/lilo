import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { applyDelta, diff, type Json } from "./delta";
import { addHistorySnapshot, createProject, historyDoc, loadProject, saveProject } from "./file";
import { DEFAULT_HOOP, emptyDesign, makeRun, nodesFromPolyline, type Design } from "../model";
import { getCatalogue, toDesignThread } from "../threads";

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const roundTrip = (a: Json, b: Json) => {
  const d = diff(a, b);
  return d === undefined ? a : applyDelta(a, d);
};

/** Small deterministic generator so the mutations are the same on every run. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

describe("JSON delta", () => {
  it("equal values give no delta", () => {
    expect(diff({ a: [1, { id: "x" }], b: "s" }, { a: [1, { id: "x" }], b: "s" })).toBeUndefined();
    expect(diff(null, null)).toBeUndefined();
  });

  it("round-trips scalars, objects, arrays with and without ids", () => {
    const cases: [Json, Json][] = [
      [1, 2],
      [{ a: 1 }, { a: 1, b: 2 }],
      [{ a: 1, b: 2 }, { a: 1 }],
      [[1, 2, 3], [1, 9, 3]],
      [[1, 2, 3], [1, 2]],
      [[{ id: "a", v: 1 }, { id: "b", v: 2 }], [{ id: "b", v: 2 }, { id: "a", v: 1 }]],
      [[{ id: "a", v: 1 }, { id: "b", v: 2 }], [{ id: "a", v: 1 }, { id: "c", v: 3 }, { id: "b", v: 5 }]],
      [[{ id: "a" }, { id: "a" }], [{ id: "a" }]], // duplicate ids fall back to a whole replacement
      [{ x: [] }, { x: [{ id: "q" }] }],
      [{ n: null }, { n: { deep: [1] } }],
    ];
    for (const [a, b] of cases) expect(roundTrip(clone(a), clone(b))).toEqual(b);
  });

  it("does not mutate its inputs and shares what did not change", () => {
    const a: Json = { keep: { big: [1, 2, 3] }, objs: [{ id: "a", v: 1 }, { id: "b", v: 2 }] };
    const frozen = JSON.stringify(a);
    const b = clone(a) as { keep: Json; objs: { id: string; v: number }[] };
    b.objs[1].v = 9;
    const out = applyDelta(a, diff(a, b as Json)!) as { keep: Json; objs: Json[] };
    expect(JSON.stringify(a)).toBe(frozen);
    expect(out).toEqual(b);
    expect(out.keep).toBe((a as { keep: Json }).keep);
    expect(out.objs[0]).toBe((a as { objs: Json[] }).objs[0]);
  });

  it("a one-object edit in 300 is a tiny delta", () => {
    const objs = Array.from({ length: 300 }, (_, i) => ({ id: `o${i}`, name: `Object ${i}`, pts: Array.from({ length: 20 }, (_, k) => [k, i]) }));
    const b = clone(objs);
    b[150].name = "edited";
    const d = diff(objs, b);
    expect(JSON.stringify(d).length).toBeLessThan(400);
    expect(JSON.stringify(d).length * 100).toBeLessThan(JSON.stringify(b).length);
  });

  it("random edits always round-trip (200 runs)", () => {
    const r = rng(5);
    for (let run = 0; run < 200; run++) {
      const a = { title: "t", list: Array.from({ length: 8 }, (_, i) => ({ id: `i${i}`, v: [i, i + 1], m: { k: i } })), flat: [1, 2, 3, 4], opt: { x: 1 } } as Record<string, Json>;
      const b = clone(a) as typeof a & { list: { id: string; v: number[]; m: { k: number } }[] };
      for (let e = 0; e < 1 + Math.floor(r() * 4); e++) {
        const pick = Math.floor(r() * 7);
        if (pick === 0) b.list.splice(Math.floor(r() * b.list.length), 1);
        else if (pick === 1) b.list.splice(Math.floor(r() * b.list.length), 0, { id: `n${run}-${e}`, v: [9], m: { k: 9 } });
        else if (pick === 2) b.list.reverse();
        else if (pick === 3 && b.list.length) b.list[Math.floor(r() * b.list.length)].m.k = Math.floor(r() * 100);
        else if (pick === 4) (b.flat as number[]).push(5);
        else if (pick === 5) delete b.opt;
        else b.title = `t${run}`;
      }
      expect(roundTrip(clone(a), clone(b) as Json)).toEqual(b);
    }
  });

  it("refuses malformed deltas and __proto__ keys instead of applying them", () => {
    expect(() => applyDelta({ a: 1 }, { o: JSON.parse('{"__proto__":{"s":1}}') })).toThrow();
    expect(() => applyDelta([1], { e: { "5": { s: 1 } } })).toThrow();
    expect(() => applyDelta({ a: 1 }, { e: {} })).toThrow();
    expect(() => applyDelta([{ id: "a" }], { i: ["zzz"], c: {} })).toThrow();
    expect(() => applyDelta(1, 5 as never)).toThrow();
    expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
  });
});

// ---- history in a project file ----------------------------------------------------------------

const THREAD = toDesignThread(getCatalogue().threads[0]);
function design(n: number): Design {
  const d = emptyDesign(DEFAULT_HOOP);
  d.threads = [THREAD];
  d.objects = Array.from({ length: n }, (_, i) => makeRun(`r${i}`, `Run ${i}`, THREAD.id, nodesFromPolyline(Array.from({ length: 30 }, (_, k) => [i + k * 0.5, (k % 3) * 0.7] as [number, number])), false));
  return d;
}

function projectWithHistory(snaps: number, objects = 120) {
  let p = createProject({ title: "big", design: design(objects) });
  for (let i = 0; i < snaps; i++) {
    p = { ...p, doc: { ...p.doc, title: `v${i}`, design: { ...p.doc.design, objects: p.doc.design.objects.map((o, k) => (k === i % objects ? { ...o, name: `edit ${i}` } : o)) } } };
    p = addHistorySnapshot(p, new Date(2026, 0, 1, 0, i));
  }
  return p;
}

describe("version history keeps deltas", () => {
  it("every snapshot reads back exactly (in memory, and after save and load)", () => {
    const p = projectWithHistory(30);
    const back = loadProject(saveProject(p));
    expect(back.project.history).toHaveLength(30);
    for (let i = 0; i < 30; i++) {
      expect(historyDoc(p.history[i]).title).toBe(`v${i}`);
      expect(historyDoc(back.project.history[i]).title).toBe(`v${i}`);
      expect(historyDoc(back.project.history[i]).design.objects).toEqual(historyDoc(p.history[i]).design.objects);
      expect(back.project.history[i].id).toBe(p.history[i].id);
    }
  });

  it("50 snapshots of a big design stay small: far below 50 full copies", () => {
    const p = projectWithHistory(50, 300);
    const bytes = saveProject(p);
    const oneDoc = JSON.stringify(p.doc).length;
    expect(bytes.length).toBeLessThan(oneDoc * 6); // 50 full copies would be 50 x oneDoc (before compression)
    const files = unzipSync(bytes);
    const delta = Object.entries(files).filter(([n]) => n.startsWith("history/")).map(([, d]) => strFromU8(d)).filter((t) => t.includes('"delta"'));
    expect(delta.length).toBeGreaterThan(30);
  });

  it("the newest entry is stored whole, and a damaged older file only costs its dependents", () => {
    const p = projectWithHistory(20);
    const files = unzipSync(saveProject(p));
    const names = Object.keys(files).filter((n) => n.startsWith("history/")).sort();
    expect(strFromU8(files[names[names.length - 1]])).toContain('"doc"');
    files[names[2]] = new Uint8Array([123, 34]); // damage entry 3 (keyframe or delta)
    const { project, warnings } = loadProject(zipSync(files));
    expect(warnings.some((w) => /history/.test(w))).toBe(true);
    expect(project.history.length).toBeLessThan(20);
    expect(project.history.length).toBeGreaterThanOrEqual(12);
    expect(historyDoc(project.history[project.history.length - 1]).title).toBe("v19");
  });

  it("a trimmed history (limit) still rebuilds, and saves as whole copies where the base fell away", () => {
    let p = createProject({ title: "t", design: design(20) });
    for (let i = 0; i < 25; i++) {
      p = { ...p, doc: { ...p.doc, title: `v${i}` } };
      p = addHistorySnapshot(p, new Date(2026, 0, 1, 0, i), 5);
    }
    expect(p.history.map((h) => historyDoc(h).title)).toEqual(["v20", "v21", "v22", "v23", "v24"]);
    const back = loadProject(saveProject(p));
    expect(back.project.history.map((h) => historyDoc(h).title)).toEqual(["v20", "v21", "v22", "v23", "v24"]);
  });

  it("a hostile delta is reported when the entry is opened, not applied", () => {
    const p = projectWithHistory(3);
    const files = unzipSync(saveProject(p));
    const names = Object.keys(files).filter((n) => n.startsWith("history/")).sort();
    const first = JSON.parse(strFromU8(files[names[0]])) as { savedAt: string };
    expect(first.savedAt).toBeTruthy();
    const id0 = names[0].replace("history/", "").replace(".json", "");
    files[names[1]] = strToU8(JSON.stringify({ savedAt: "x", base: id0, delta: { o: { design: { e: { "99999": { s: 1 } } } } } }));
    const back = loadProject(zipSync(files));
    const bad = back.project.history.find((h) => h.id === names[1].replace("history/", "").replace(".json", ""));
    expect(bad).toBeDefined();
    expect(() => historyDoc(bad!)).toThrow();
  });
});
