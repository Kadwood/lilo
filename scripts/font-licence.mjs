// Licence + attribution helpers for scripts/import-fonts.mjs (separate file so they can be unit-tested).

/**
 * Classify licence text. Returns an allowed id ("OFL" | "CC0" | "PD" | "CC-BY-SA" | "CC-BY") or an
 * exclusion code ("NC", "ND", "GPL", "UNKNOWN"). Restrictions always win over permissions.
 */
export function classify(text) {
  const t = text.toLowerCase().replace(/\s+/g, " ");
  if (/non[- ]?commercial|by-nc|by nc|\bcc[- ]?nc|\bnc[- ]?(sa|nd)/.test(t)) return "NC";
  // "Personal use" is a restriction unless commercial use is allowed too ("personal and commercial use").
  if (/personal use/.test(t) && !/commercial use|personal (and|or) commercial|both personal/.test(t)) return "NC";
  // "All rights reserved" in a copyright line is normal next to an open licence grant; on its own it
  // means no licence was given.
  const grant = /open font licen[sc]e|\bofl\b|creative commons|\bcc0\b|\bcc[- ]?by|(public|mublic) domain|permission is hereby granted|gnu general public/;
  if (/all rights reserved/.test(t) && !grant.test(t)) return "NC";
  if (/no[- ]?derivativ|by-nd|by nd|\bcc[- ]?nd|\bnd\b/.test(t)) return "ND";
  if (/open font licen[sc]e|\bofl\b/.test(t)) return "OFL";
  if (/cc0|creative commons zero/.test(t)) return "CC0";
  if (/(public|mublic) domain/.test(t)) return "PD";
  if (/by-sa|by sa|sa 4\.0|sa 2\.5|share ?alike/.test(t)) return "CC-BY-SA";
  if (/\bcc[- ]?by\b|creative commons attribution|attribution 4/.test(t)) return "CC-BY";
  if (/gnu general public|\bgpl\b/.test(t)) return "GPL";
  return "UNKNOWN";
}

export const ALLOWED = new Set(["OFL", "PD", "CC0", "CC-BY", "CC-BY-SA"]);

export const LICENCE_NAMES = {
  OFL: "SIL Open Font License 1.1",
  PD: "Public domain",
  CC0: "CC0 1.0",
  "CC-BY": "Creative Commons Attribution",
  "CC-BY-SA": "Creative Commons Attribution-ShareAlike",
};

/** Canonical licence URL for a class (CC versions are read from the upstream label, default 4.0). */
export function licenceUrl(cls, label = "") {
  const v = /\b([1-4]\.\d)\b/.exec(label)?.[1] ?? "4.0";
  switch (cls) {
    case "OFL":
      return "https://openfontlicense.org/";
    case "CC0":
      return "https://creativecommons.org/publicdomain/zero/1.0/";
    case "CC-BY":
      return `https://creativecommons.org/licenses/by/${v}/`;
    case "CC-BY-SA":
      return `https://creativecommons.org/licenses/by-sa/${v}/`;
    default:
      return ""; // public domain: no URL
  }
}

const STOP =
  "(?=\\s*,?\\s*(?:and is\\b|and are\\b|is licen|are licen|with (?:the )?(?:kind )?permission|original font|\\(|copyright|this font|licensed|and licensed)|(?<![ ][A-Za-z])\\.(?:\\s|$)|:|$)";
const AUTHOR_PATTERNS = [
  new RegExp(`\\b(?:adapted|created|digitized|digitised|made|designed|converted)\\b[^.]{0,60}? by (.+?)${STOP}`, "i"),
  new RegExp(`(?:copyright|\\(c\\)|\\u00a9)\\s*(?:\\(c\\)\\s*)?\\d{4}(?:\\s*-\\s*\\d{4})?,?\\s*(?:by\\s+)?(.+?)${STOP}`, "i"),
];

/** Best-effort digitizer/author from a font's LICENSE text ("" when none can be found). */
export function authorOf(text) {
  const t = text.replace(/\s+/g, " ").trim();
  for (const re of AUTHOR_PATTERNS) {
    const m = re.exec(t);
    if (m) {
      const a = m[1].replace(/\s+and\s*$/i, "").replace(/[\s,]+$/, "").trim();
      if (a.length > 2 && a.length < 200) return a;
    }
  }
  return "";
}
