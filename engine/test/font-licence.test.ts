import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const url = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "scripts", "font-licence.mjs")).href;
const { classify, authorOf, licenceUrl } = (await import(/* @vite-ignore */ url)) as {
  classify(t: string): string;
  authorOf(t: string): string;
  licenceUrl(c: string, label?: string): string;
};

describe("font licence classifier", () => {
  it("accepts the open licences", () => {
    expect(classify("licensed under the SIL Open Font License, Version 1.1")).toBe("OFL");
    expect(classify("This ink/stitch font is public domain")).toBe("PD");
    expect(classify("licensed CC-BY-SA (http://creativecommons.org/licenses/by-sa/4.0/)")).toBe("CC-BY-SA");
    expect(classify("SCC-BY-SA 4.0")).toBe("CC-BY-SA");
    expect(classify("licensed under CC BY 4.0")).toBe("CC-BY");
    expect(classify("CC0 1.0")).toBe("CC0");
  });

  it.each([
    ["CC BY-NC-SA 4.0", "NC"],
    ["free for non commercial use", "NC"],
    ["Non-Commercial only", "NC"],
    ["noncommercial", "NC"],
    ["Free for personal use", "NC"],
    ["Copyright 2020 Someone. All rights reserved.", "NC"],
    ["Creative Commons CC BY-ND", "ND"],
    ["no derivatives allowed", "ND"],
    ["No-Derivatives", "ND"],
    ["no derivativ", "ND"],
    ["GNU General Public License v3", "GPL"],
    ["do what you want", "UNKNOWN"],
  ])("%s -> %s", (text, cls) => {
    expect(classify(text)).toBe(cls);
  });

  it("does not over-exclude: copyright lines and commercial-use permissions are fine", () => {
    expect(classify("Copyright (c) 2014, X. All rights reserved. This Font Software is licensed under the SIL Open Font License, Version 1.1.")).toBe("OFL");
    expect(classify("Copyright (c) 2003 Bitstream, Inc. All Rights Reserved. Permission is hereby granted, free of charge, to any person")).toBe("UNKNOWN");
    expect(classify("free for personal use and commercial use. licensed CC-BY-SA")).toBe("CC-BY-SA");
    expect(classify("may be used for both personal and commercial use, CC-BY-SA")).toBe("CC-BY-SA");
  });

  it("restrictions beat permissions in the same text", () => {
    expect(classify("SIL Open Font License, but personal use only")).toBe("NC");
    expect(classify("CC-BY-SA with no derivatives")).toBe("ND");
  });

  it("licence URLs carry the CC version", () => {
    expect(licenceUrl("CC-BY-SA", "SCC-BY-SA 2.5")).toBe("https://creativecommons.org/licenses/by-sa/2.5/");
    expect(licenceUrl("CC-BY-SA", "SCC-BY-SA 4.0")).toBe("https://creativecommons.org/licenses/by-sa/4.0/");
    expect(licenceUrl("OFL")).toMatch(/openfontlicense/);
    expect(licenceUrl("PD")).toBe("");
  });
});

describe("author extraction", () => {
  it("reads digitizers from the usual phrasings", () => {
    expect(authorOf("This font has been adapted for Ink/Stitch by Corinne Renaud, and is licensed under the SIL Open Font License")).toBe("Corinne Renaud");
    expect(authorOf("This font has been adapted for Ink/Stitch by George Zouridakis and is licensed under the SIL")).toBe("George Zouridakis");
    expect(authorOf("This Ink/Stitch embroidery alphabet is copyright 2022 by Karen Cravens d/b/a Silver Seams, and is licensed CC-BY-SA")).toBe("Karen Cravens d/b/a Silver Seams");
    expect(authorOf("Copyright (c) 2017, Lex Neva. This Font Software is licensed under the SIL Open Font License")).toBe("Lex Neva");
    expect(authorOf("adapted for Ink/Stitch by Karen J. Cravens/Silver Seams with permission")).toBe("Karen J. Cravens/Silver Seams");
  });
  it("returns an empty string when it cannot tell", () => {
    expect(authorOf("licensed under the SIL Open Font License")).toBe("");
  });
});
