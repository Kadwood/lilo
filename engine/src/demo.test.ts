import { describe, expect, it } from "vitest";
import { demoSatinPes } from "./index";

describe("demoSatinPes", () => {
  const bytes = demoSatinPes();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const ascii = (from: number, len: number) =>
    String.fromCharCode(...bytes.subarray(from, from + len));

  it("starts with the PES magic and is non-trivial", () => {
    expect(ascii(0, 4)).toBe("#PES");
    expect(ascii(0, 8)).toBe("#PES0001");
    expect(bytes.length).toBeGreaterThan(100);
  });

  it("has a PEC section offset inside the file pointing at the PEC label", () => {
    const pecOffset = view.getUint32(8, true);
    expect(pecOffset).toBeGreaterThan(0);
    expect(pecOffset).toBeLessThan(bytes.length);
    expect(ascii(pecOffset, 3)).toBe("LA:");
  });

  /** Walk the PEC stitch stream; returns counts and where it ended. */
  function decodePec() {
    const pec = view.getUint32(8, true);
    const graphicsOffset = bytes[pec + 514] | (bytes[pec + 515] << 8) | (bytes[pec + 516] << 16);
    const graphicsStart = pec + 512 + graphicsOffset;
    let i = pec + 512 + 20;
    let stitches = 0;
    let colorChanges = 0;
    while (i < bytes.length) {
      const b = bytes[i];
      if (b === 0xff) {
        i += 1;
        break;
      }
      if (b === 0xfe && bytes[i + 1] === 0xb0) {
        colorChanges++;
        i += 3;
        continue;
      }
      // 2-byte short form or 4-byte long form (high bit on the first byte of each axis)
      const long = (b & 0x80) !== 0;
      const trim = long && (b & 0x20) !== 0;
      if (!trim) stitches++;
      i += long ? 4 : 2;
    }
    return { endAt: i, graphicsStart, stitches, colorChanges };
  }

  it("has a well-formed stitch stream that ends exactly where the graphics begin", () => {
    const { endAt, graphicsStart } = decodePec();
    expect(graphicsStart).toBeLessThan(bytes.length);
    expect(endAt).toBe(graphicsStart);
  });

  it("contains hundreds of stitches across two colours", () => {
    const { stitches, colorChanges } = decodePec();
    expect(stitches).toBeGreaterThan(200);
    expect(colorChanges).toBe(1);
  });

  it("is deterministic", () => {
    expect(demoSatinPes()).toEqual(bytes);
  });
});
