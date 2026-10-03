import { describe, expect, it } from "vitest";
import { classifyFile, decodeFile } from "./decode";

describe("classifyFile", () => {
  it("sorts files by extension or MIME type", () => {
    expect(classifyFile("logo.PNG")).toBe("raster");
    expect(classifyFile("photo.jpeg")).toBe("raster");
    expect(classifyFile("pic.webp")).toBe("raster");
    expect(classifyFile("art.svg")).toBe("svg");
    expect(classifyFile("blob", "image/svg+xml")).toBe("svg");
    expect(classifyFile("blob", "image/png")).toBe("raster");
    expect(classifyFile("notes.pdf")).toBeNull();
    expect(classifyFile("design.pes")).toBeNull();
  });

  it("rejects unsupported files with a helpful message", async () => {
    await expect(decodeFile({ name: "x.pdf", bytes: new Uint8Array(4) })).rejects.toThrow(/PNG, JPG, WEBP and SVG/);
  });
});
