import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FIXTURES } from "./fixtures/fixtures";
import { encodePng } from "./fixtures/png";

const dir = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

describe("committed fixture images", () => {
  for (const f of FIXTURES) {
    it(`${f.name}.png matches the generator (set UPDATE_FIXTURES=1 to rewrite)`, () => {
      const img = f.make();
      const bytes = encodePng(img.width, img.height, img.data);
      const path = join(dir, `${f.name}.png`);
      if (process.env.UPDATE_FIXTURES || !existsSync(path)) writeFileSync(path, bytes);
      expect(Buffer.from(readFileSync(path)).equals(Buffer.from(bytes))).toBe(true);
    });
  }
});
