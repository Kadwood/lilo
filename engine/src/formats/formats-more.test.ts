import { describe, expect, it } from "vitest";
import { fixed3, writeGcode } from "./gcode";
import { HUS_MAGIC, readHus, readVip, VIP_MAGIC, VIP_MAX_COLORS, writeHus, writeVip } from "./hus";
import { compressLiterals, expand } from "./hus-compress";
import { FormatError, readEmbroidery, convert, planToPattern, writeEmbroidery, READABLE_EXTENSIONS, FORMATS } from "./index";
import { readTbf, TBF_MAX_COLORS, writeTbf } from "./tbf";
import type { EmbPattern } from "./types";
import { islandsPlan, samplePlan } from "./test-plans";

const u32 = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const i16 = (b: Uint8Array, at: number) => ((b[at] | (b[at + 1] << 8)) << 16) >> 16;
const text = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

/** Small deterministic generator, so the fuzz runs are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

const islands = () => planToPattern(islandsPlan(), "islands");
const needles = (p: EmbPattern) => p.stitches.filter((s) => s.cmd === "stitch").map((s) => [Math.round(s.x), Math.round(s.y)]);

/** A pattern with `n` colour blocks of a few stitches each. */
function manyColours(n: number): EmbPattern {
  const stitches: EmbPattern["stitches"] = [];
  const threads: EmbPattern["threads"] = [];
  for (let i = 0; i < n; i++) {
    if (i > 0) stitches.push({ x: i * 5, y: 0, cmd: "colorChange" });
    stitches.push({ x: i * 5, y: 0, cmd: "stitch" }, { x: i * 5 + 3, y: 4, cmd: "stitch" });
    threads.push({ hex: `#${((i * 2654435) & 0xffffff).toString(16).padStart(6, "0")}` });
  }
  return { stitches, threads };
}

describe("HUS/VIP compression", () => {
  it("expand(compressLiterals(x)) is x, across block boundaries", () => {
    const rand = rng(1);
    for (const n of [0, 1, 2, 255, 256, 65534, 65535, 65536, 65537, 140000]) {
      const data = Uint8Array.from({ length: n }, () => Math.floor(rand() * 256));
      expect(expand(compressLiterals(data), n), `n=${n}`).toEqual(data);
    }
  });

  it("the literal header is the one pyembroidery and libembroidery write, with the count big-endian", () => {
    const c = compressLiterals(Uint8Array.from([7, 8, 9]));
    expect([...c.subarray(0, 6)]).toEqual([0, 3, 0x02, 0xa0, 0x01, 0xfe]);
    expect([...c.subarray(6)]).toEqual([7, 8, 9]);
  });

  /** Bits, most significant first, as the format packs them. */
  class Bits {
    private bits: number[] = [];
    put(value: number, n: number): this {
      for (let i = n - 1; i >= 0; i--) this.bits.push((value >> i) & 1);
      return this;
    }
    bytes(): Uint8Array {
      const out = new Uint8Array(Math.ceil(this.bits.length / 8));
      this.bits.forEach((b, i) => (out[i >> 3] |= b << (7 - (i & 7))));
      return out;
    }
  }

  it("decodes copy tokens, including a copy that overlaps its own output", () => {
    // One block of 5 tokens. Length table: a single value (11), so every character gets a 9-bit
    // code (11 - 2) and symbol i has code i. Distance table: a single value (0), so every copy is
    // "1 back" with no extra bits.
    const b = new Bits().put(5, 16);
    b.put(0, 5).put(11, 5); // character-length table: one value, 11
    b.put(257, 9); // 257 characters (0..256), each a 9-bit code
    b.put(0, 5).put(0, 5); // distance table: one value, 0 (one byte back)
    b.put(0x41, 9); // literal A
    b.put(256, 9); // copy 3, 1 back: A A A
    b.put(0x42, 9); // literal B
    b.put(256, 9); // copy 3, 1 back: B B B
    b.put(0x43, 9); // literal C
    expect([...expand(b.bytes(), 9)].map((c) => String.fromCharCode(c)).join("")).toBe("AAAABBBBC");
  });

  it("refuses a copy from before the start and an unreachable code, and stops at the end of the input", () => {
    const back = new Bits().put(1, 16).put(0, 5).put(11, 5).put(257, 9).put(0, 5).put(1, 5).put(256, 9);
    expect(() => expand(back.bytes(), 10)).toThrow(FormatError);
    // a length table that leaves most codes unassigned: the first lookup misses
    const hole = new Bits().put(5, 16).put(1, 5).put(5, 3).put(1, 9).put(0xffff, 16);
    expect(() => expand(hole.bytes(), 10)).toThrow(FormatError);
    expect(expand(new Uint8Array(0), 5)).toHaveLength(0);
  });

  it("random bytes never hang or throw anything but FormatError", () => {
    const rand = rng(7);
    for (let i = 0; i < 400; i++) {
      const junk = Uint8Array.from({ length: 1 + Math.floor(rand() * 400) }, () => Math.floor(rand() * 256));
      try {
        expand(junk, 5000);
      } catch (e) {
        expect(e).toBeInstanceOf(FormatError);
      }
    }
  });
});

describe("HUS", () => {
  const file = writeHus(islands(), { label: "islands" });

  it("writes the documented header", () => {
    expect(u32(file, 0)).toBe(HUS_MAGIC);
    expect([...file.subarray(0, 4)]).toEqual([0x5b, 0xaf, 0xc8, 0x00]);
    const count = u32(file, 4);
    const colours = u32(file, 8);
    expect(colours).toBe(3);
    const cmdAt = u32(file, 0x14);
    const xAt = u32(file, 0x18);
    const yAt = u32(file, 0x1c);
    expect(cmdAt).toBe(0x2a + 2 * colours);
    expect(cmdAt).toBeLessThan(xAt);
    expect(xAt).toBeLessThan(yAt);
    expect(yAt).toBeLessThan(file.length);
    // each stream holds exactly `count` records and ends with the END command
    const cmd = expand(file.subarray(cmdAt, xAt), count);
    expect(cmd).toHaveLength(count);
    expect(cmd[count - 1]).toBe(0x90);
    expect(new Set(cmd)).toEqual(new Set([0x80, 0x81, 0x84, 0x88, 0x90]));
    expect(expand(file.subarray(xAt, yAt), count)).toHaveLength(count);
    expect(expand(file.subarray(yAt), count)).toHaveLength(count);
    expect(text(file, 0x20, 8).replace(/\0+$/, "")).toBe("islands");
    // extents: +X, +Y, -X, -Y around the origin (0.1 mm)
    expect(i16(file, 0x0c)).toBeGreaterThan(0);
    expect(i16(file, 0x10)).toBeLessThan(0);
  });

  it("colour indices point at Husqvarna's palette and read back as named threads", () => {
    const back = readHus(file);
    expect(back.threads.map((t) => t.name)).toEqual(["Blue", "Red", "Black"]);
    expect(back.threads.every((t) => t.brand === "Husqvarna" && /^\d{3}$/.test(t.code ?? ""))).toBe(true);
    expect(back.name).toBe("islands");
  });

  it("round-trips needles, colour blocks and trims", () => {
    const back = readHus(file);
    expect(needles(back)).toEqual(needles(islands()));
    expect(back.stitches.filter((s) => s.cmd === "colorChange")).toHaveLength(2);
    expect(back.stitches.some((s) => s.cmd === "trim")).toBe(true);
    expect(back.stitches[back.stitches.length - 1].cmd).toBe("end");
  });

  it("splits jumps and stitches longer than 12.7 mm", () => {
    const p: EmbPattern = { threads: [{ hex: "#ff0000" }], stitches: [{ x: 0, y: 0, cmd: "stitch" }, { x: 500, y: 0, cmd: "stitch" }, { x: 500, y: 300, cmd: "jump" }, { x: 505, y: 300, cmd: "stitch" }] };
    const back = readHus(writeHus(p));
    for (let i = 1; i < back.stitches.length; i++) {
      expect(Math.abs(back.stitches[i].x - back.stitches[i - 1].x)).toBeLessThanOrEqual(127);
      expect(Math.abs(back.stitches[i].y - back.stitches[i - 1].y)).toBeLessThanOrEqual(127);
    }
    expect(back.stitches.filter((s) => s.cmd === "stitch").pop()).toMatchObject({ x: 505, y: 300 });
  });

  it("rejects the wrong signature, bad counts and bad offsets", () => {
    const bad = (mutate: (b: Uint8Array) => void) => {
      const b = file.slice();
      mutate(b);
      expect(() => readHus(b)).toThrow(FormatError);
    };
    bad((b) => (b[0] = 0));
    bad((b) => b.set([0, 0, 0, 0], 4)); // zero stitches
    bad((b) => b.set([0xff, 0xff, 0xff, 0xff], 4)); // 4 billion stitches
    bad((b) => b.set([0xff, 0xff, 0, 0], 8)); // 65535 colours
    bad((b) => b.set([0xff, 0xff, 0xff, 0x7f], 0x1c)); // y stream beyond the file
    bad((b) => b.set(b.subarray(0x1c, 0x20), 0x18)); // x stream empty
    bad((b) => b.set([0xff, 0, 0, 0], 0x2a)); // colour index 255
    expect(() => readHus(new Uint8Array(10))).toThrow(FormatError);
    expect(() => readHus(file.subarray(0, file.length - 5))).toThrow(FormatError);
  });

  it("fuzz: flipped and truncated bytes only ever give a FormatError or a pattern", () => {
    const rand = rng(11);
    for (let i = 0; i < 600; i++) {
      const b = file.slice(0, i % 3 === 0 ? 1 + Math.floor(rand() * file.length) : file.length);
      for (let k = 0; k < 1 + (i % 4); k++) b[Math.floor(rand() * b.length)] = Math.floor(rand() * 256);
      try {
        readHus(b);
      } catch (e) {
        expect(e).toBeInstanceOf(FormatError);
      }
    }
  });

  it("reads a file with more than 65535 stitches (several blocks per stream)", () => {
    const stitches: EmbPattern["stitches"] = [];
    for (let i = 0; i < 70000; i++) stitches.push({ x: (i % 50) * 2, y: Math.floor(i / 50) % 40, cmd: "stitch" });
    const p: EmbPattern = { threads: [{ hex: "#00ff00" }], stitches };
    const back = readHus(writeHus(p));
    expect(needles(back).length).toBe(needles(p).length);
    expect(needles(back).slice(-1)[0]).toEqual(needles(p).slice(-1)[0]);
  });
});

describe("VIP", () => {
  const file = writeVip(islands());

  it("writes the documented header and colour record", () => {
    expect([...file.subarray(0, 4)]).toEqual([0x5d, 0xfc, 0x90, 0x01]);
    expect(u32(file, 0)).toBe(VIP_MAGIC);
    const colours = u32(file, 8);
    expect(colours).toBe(3);
    expect(u32(file, 0x2a)).toBe(4 * colours);
    const cmdAt = u32(file, 0x14);
    expect(cmdAt).toBe(0x38 + 8 * colours);
    // (colours + 1) u32 ones, a zero u32 and a zero u16 sit between the colours and the streams
    const record = 0x2e + 4 * colours;
    for (let i = 0; i <= colours; i++) expect(u32(file, record + 4 * i)).toBe(1);
    expect(u32(file, record + 4 * (colours + 1))).toBe(0);
    expect(cmdAt).toBe(record + 4 * (colours + 1) + 6);
    const count = u32(file, 4);
    expect(expand(file.subarray(cmdAt, u32(file, 0x18)), count)[count - 1]).toBe(0x90);
  });

  it("stores exact RGB colours that read back unchanged", () => {
    const back = readVip(file);
    expect(back.threads.map((t) => t.hex)).toEqual(islands().threads.map((t) => t.hex));
    expect(needles(back)).toEqual(needles(islands()));
    expect(back.stitches.filter((s) => s.cmd === "colorChange")).toHaveLength(2);
  });

  it("decodes Jason Weiler's published colour example", () => {
    // From "HUS and VIP File Formats": these 28 encoded bytes decode to seven RGB0 colours.
    const encoded = [0x48, 0x70, 0xdd, 0xb2, 0x77, 0x07, 0x05, 0xc3, 0x48, 0x0e, 0xd6, 0x7a, 0x70, 0xe2, 0x0e, 0x40, 0x4b, 0x0a, 0xfa, 0x1e, 0xc5, 0x64, 0xdb, 0xb3, 0xee, 0x36, 0xc9, 0x7d];
    const p = manyColours(7);
    const f = writeVip(p);
    f.set(encoded, 0x2e);
    expect(readVip(f).threads.map((t) => t.hex)).toEqual(["#66ba49", "#fdd9de", "#f0f0f0", "#f73866", "#7d6f00", "#feba35", "#134a46"]);
  });

  it("holds as many colours as the scramble table covers, and no more", () => {
    expect(VIP_MAX_COLORS).toBe(100);
    const hundred = readVip(writeVip(manyColours(VIP_MAX_COLORS)));
    expect(hundred.threads).toHaveLength(VIP_MAX_COLORS);
    expect(() => writeVip(manyColours(VIP_MAX_COLORS + 1))).toThrow(FormatError);
  });

  it("rejects a HUS file, bad counts and bad offsets", () => {
    expect(() => readVip(writeHus(islands()))).toThrow(FormatError);
    expect(() => readHus(file)).toThrow(FormatError);
    const bad = (mutate: (b: Uint8Array) => void) => {
      const b = file.slice();
      mutate(b);
      expect(() => readVip(b)).toThrow(FormatError);
    };
    bad((b) => b.set([0, 0, 0, 0], 4));
    bad((b) => b.set([101, 0, 0, 0], 8)); // more colours than the table
    bad((b) => b.set([0xff, 0xff, 0xff, 0x7f], 0x18));
    expect(() => readVip(file.subarray(0, 0x2d))).toThrow(FormatError);
    expect(() => readVip(file.subarray(0, file.length >> 1))).toThrow(FormatError);
  });

  it("fuzz: flipped and truncated bytes only ever give a FormatError or a pattern", () => {
    const rand = rng(13);
    for (let i = 0; i < 600; i++) {
      const b = file.slice(0, i % 3 === 0 ? 1 + Math.floor(rand() * file.length) : file.length);
      for (let k = 0; k < 1 + (i % 4); k++) b[Math.floor(rand() * b.length)] = Math.floor(rand() * 256);
      try {
        readVip(b);
      } catch (e) {
        expect(e).toBeInstanceOf(FormatError);
      }
    }
  });
});

describe("TBF", () => {
  const file = writeTbf(islands(), { label: "islands" });

  it("writes the documented 0x600-byte header", () => {
    expect(text(file, 0, 4)).toBe("3.00");
    expect(text(file, 0x80, 3)).toBe("LA:");
    expect(text(file, 0x83, 16)).toBe("islands         ");
    expect(file[0x93]).toBe(0x0d);
    expect(text(file, 0x94, 3)).toBe("ST:");
    expect(text(file, 0x9f, 3)).toBe("CO:");
    expect(text(file, 0x9f + 3, 3).trim()).toBe("3");
    expect(text(file, 0x107, 3)).toBe("DO:");
    // needle order: 1, 2, 3 then zeros
    expect([...file.subarray(0x10a, 0x10d)]).toEqual([1, 2, 3]);
    expect(file[0x10d]).toBe(0);
    expect(text(file, 0x20a, 1)).toBe("\r");
    expect(text(file, 0x20b, 3)).toBe("DA:");
    // thread list: 0x45 R G B 0x20, with the exact RGB of each colour
    const t = islandsPlan().threads;
    t.forEach((th, i) => {
      const at = 0x20e + 5 * i;
      expect(file[at]).toBe(0x45);
      expect(`#${[file[at + 1], file[at + 2], file[at + 3]].map((v) => v.toString(16).padStart(2, "0")).join("")}`).toBe(th.hex);
      expect(file[at + 4]).toBe(0x20);
    });
    expect(file[0x20e + 15]).toBe(0x20);
    expect(file.length).toBeGreaterThan(0x600);
    // stitch records are 3 bytes; the last is END (0x8f) and then a 0x1a
    expect(file[file.length - 1]).toBe(0x1a);
    expect(file[file.length - 2]).toBe(0x8f);
    expect((file.length - 0x600 - 1) % 3).toBe(0);
    // jumps to the first stitch, then the needle change, then sewing
    const cmds: number[] = [];
    for (let at = 0x600 + 2; at < file.length - 3; at += 3) cmds.push(file[at]);
    expect(cmds[0]).toBe(0x90);
    expect(cmds.indexOf(0x81)).toBeGreaterThan(0);
    expect(cmds.indexOf(0x81)).toBeLessThan(cmds.indexOf(0x80));
  });

  it("round-trips needles, colours, trims and the name", () => {
    const back = readTbf(file);
    expect(needles(back)).toEqual(needles(islands()));
    expect(back.threads.map((t) => t.hex)).toEqual(islands().threads.map((t) => t.hex));
    expect(back.name).toBe("islands");
    expect(back.stitches.filter((s) => s.cmd === "needleSet").map((s) => s.needle)).toEqual([1, 2, 3]);
    expect(back.stitches.some((s) => s.cmd === "trim")).toBe(true);
  });

  it("numbers needles 1 to 5 round and round", () => {
    const back = readTbf(writeTbf(manyColours(7)));
    expect(back.stitches.filter((s) => s.cmd === "needleSet").map((s) => s.needle)).toEqual([1, 2, 3, 4, 5, 1, 2]);
  });

  it("holds as many colours as the header has room for", () => {
    expect(TBF_MAX_COLORS).toBe(202);
    expect(readTbf(writeTbf(manyColours(TBF_MAX_COLORS))).threads).toHaveLength(TBF_MAX_COLORS);
    expect(() => writeTbf(manyColours(TBF_MAX_COLORS + 1))).toThrow(FormatError);
  });

  it("cleans the name to what the 16-character field can hold", () => {
    const f = writeTbf(islands(), { label: "A very long design name\r\nwith line breaks" });
    expect(text(f, 0x83, 16)).toBe("A very long desi");
    expect(f[0x93]).toBe(0x0d);
  });

  it("rejects short files, a missing header and too many colour changes", () => {
    expect(() => readTbf(new Uint8Array(0x5ff))).toThrow(FormatError);
    expect(() => readTbf(new Uint8Array(0x700))).toThrow(FormatError);
    const long = new Uint8Array(0x600 + 3 * 300 + 1);
    long.set(file.subarray(0, 0x600));
    for (let i = 0; i < 300; i++) long.set([0, 0, 0x81], 0x600 + 3 * i);
    expect(() => readTbf(long)).toThrow(FormatError);
  });

  it("fuzz: flipped and truncated bytes only ever give a FormatError or a pattern", () => {
    const rand = rng(17);
    for (let i = 0; i < 600; i++) {
      const b = file.slice(0, i % 3 === 0 ? 1 + Math.floor(rand() * file.length) : file.length);
      for (let k = 0; k < 1 + (i % 4); k++) b[Math.floor(rand() * b.length)] = Math.floor(rand() * 256);
      try {
        readTbf(b);
      } catch (e) {
        expect(e).toBeInstanceOf(FormatError);
      }
    }
  });
});

describe("G-code", () => {
  const plan = samplePlan();
  const gcode = new TextDecoder().decode(writeEmbroidery(plan, "gcode", { label: "sample" }));
  const lines = gcode.split("\n");

  it("writes the comment header, one move plus one Z line per stitch, a pause per colour change and M30", () => {
    expect(lines[0]).toMatch(/^\(STITCH_COUNT: \d+\)$/);
    expect(lines[1]).toBe("(THREAD_COUNT: 1)");
    expect(lines.slice(2, 8).map((l) => l.split(":")[0])).toEqual(["(EXTENTS_LEFT", "(EXTENTS_TOP", "(EXTENTS_RIGHT", "(EXTENTS_BOTTOM", "(EXTENTS_WIDTH", "(EXTENTS_HEIGHT"]);
    expect(lines).toContain("(name: sample)");
    const needleCount = plan.stitches.filter((s) => s.type === "stitch").length;
    expect(lines.filter((l) => l.startsWith("G00 X"))).toHaveLength(needleCount);
    expect(lines.filter((l) => l.startsWith("G00 Z"))).toHaveLength(needleCount);
    expect(lines.filter((l) => l === "M00")).toHaveLength(1);
    expect(lines[lines.length - 2]).toBe("M30");
    expect(lines[lines.length - 1]).toBe("");
    expect(lines.filter((l) => l.startsWith("G00 Z")).slice(0, 3)).toEqual(["G00 Z0.0", "G00 Z10.0", "G00 Z20.0"]);
  });

  it("lists the threads like pyembroidery and flips both axes", () => {
    expect(lines.filter((l) => l.startsWith("(Thread"))).toHaveLength(plan.threads.length);
    expect(lines.find((l) => l.startsWith("(Thread0:"))!).toMatch(/^\(Thread0: #[0-9a-f]{6} /);
    const first = plan.stitches.find((s) => s.type === "stitch")!;
    const move = lines.find((l) => l.startsWith("G00 X"))!;
    expect(move).toBe(`G00 X${fixed3(-first.x)} Y${fixed3(-first.y)}`);
  });

  it("formats numbers like Python's %.3f", () => {
    expect(fixed3(1.0625)).toBe("1.062"); // exact tie, even digit
    expect(fixed3(1.1875)).toBe("1.188"); // exact tie, odd digit rounds up
    expect(fixed3(-0.0625)).toBe("-0.062");
    expect(fixed3(0.1)).toBe("0.100");
    expect(fixed3(-0)).toBe("0.000");
    expect(fixed3(-1e-9)).toBe("0.000");
    expect(fixed3(19.1666666)).toBe("19.167");
  });

  it("is write-only: opening it is a clear FormatError, and it never lists as readable", () => {
    expect(() => readEmbroidery(new TextEncoder().encode(gcode), "gcode")).toThrow(/can't open/);
    expect(() => convert(new TextEncoder().encode(gcode), "gcode", "pes")).toThrow(FormatError);
    expect(READABLE_EXTENSIONS).not.toContain("gcode");
    expect(FORMATS.find((f) => f.ext === "gcode")?.canRead).toBe(false);
  });

  it("keeps threads with brackets or line breaks from breaking the comment lines", () => {
    const p: EmbPattern = { threads: [{ hex: "#112233", name: "Red (dark)\nline", brand: "B)rand" }], stitches: [{ x: 0, y: 0, cmd: "stitch" }, { x: 10, y: 0, cmd: "stitch" }] };
    const out = new TextDecoder().decode(writeGcode(p)).split("\n");
    expect(out.find((l) => l.startsWith("(Thread0:"))!).toBe("(Thread0: #112233 Red (darkline Brand None)");
    expect(out.filter((l) => l.startsWith("(") && !l.endsWith(")"))).toEqual([]);
  });
});

describe("random input", () => {
  it("HUS, VIP and TBF readers answer random bytes (with and without a valid signature) with a FormatError or a pattern", () => {
    const rand = rng(23);
    const heads: [string, Uint8Array][] = [
      ["hus", Uint8Array.from([0x5b, 0xaf, 0xc8, 0x00])],
      ["vip", Uint8Array.from([0x5d, 0xfc, 0x90, 0x01])],
      ["tbf", new Uint8Array(0)],
    ];
    for (const [ext, head] of heads) {
      for (let i = 0; i < 300; i++) {
        const body = Uint8Array.from({ length: Math.floor(rand() * (ext === "tbf" ? 4000 : 600)) }, () => Math.floor(rand() * 256));
        const bytes = new Uint8Array(head.length + body.length);
        bytes.set(head);
        bytes.set(body, head.length);
        if (ext === "tbf" && i % 2 === 0 && bytes.length >= 0x83) bytes.set([0x4c, 0x41, 0x3a], 0x80); // "LA:", to get past the header check
        try {
          readEmbroidery(bytes, ext);
        } catch (e) {
          expect(e, `${ext} #${i}`).toBeInstanceOf(FormatError);
        }
      }
    }
  });
});

describe("the new formats through the public API", () => {
  it("convert() reaches HUS, VIP and TBF from PES and back", () => {
    const pes = writeEmbroidery(samplePlan(), "pes");
    const want = needles(planToPattern(readEmbroidery(pes, "pes").plan));
    for (const ext of ["hus", "vip", "tbf"] as const) {
      const r = convert(pes, "pes", ext);
      expect(needles(planToPattern(readEmbroidery(r.bytes, ext).plan)), ext).toEqual(want);
    }
  });

  it("every other format opens a HUS, VIP or TBF file and keeps the colour blocks", () => {
    for (const ext of ["hus", "vip", "tbf"] as const) {
      const bytes = writeEmbroidery(islandsPlan(), ext);
      for (const to of ["pes", "dst", "jef", "vp3"] as const) {
        const r = readEmbroidery(convert(bytes, ext, to).bytes, to);
        expect(r.plan.stitches.filter((s) => s.type === "colorChange"), `${ext} to ${to}`).toHaveLength(2);
      }
    }
  });
});
