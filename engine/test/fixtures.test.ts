import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIXTURES } from "./fixtures/fixtures";
import { encodePng } from "./fixtures/png";

// Compare decoded pixel rows, not file bytes: zlib output differs between Node versions.
function pixels(png: Uint8Array): Buffer {
  const parts: Uint8Array[] = [];
  for (let at = 8; at < png.length; ) {
    const len = new DataView(png.buffer, png.byteOffset + at).getUint32(0);
    const type = String.fromCharCode(...png.subarray(at + 4, at + 8));
    if (type === "IDAT") parts.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  return inflateSync(Buffer.concat(parts));
}

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("committed fixture images", () => {
  for (const f of FIXTURES) {
    it(`${f.name}.png matches the generator (set UPDATE_FIXTURES=1 to rewrite)`, () => {
      const img = f.make();
      const bytes = encodePng(img.width, img.height, img.data);
      const path = join(dir, `${f.name}.png`);
      if (process.env.UPDATE_FIXTURES || !existsSync(path)) writeFileSync(path, bytes);
      expect(pixels(readFileSync(path)).equals(pixels(bytes))).toBe(true);
    });
  }
});
