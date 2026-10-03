// Writes the guide pages that are generated from the app's own data, so they cannot drift:
//   fill-patterns.md, sewing-presets.md, keyboard-shortcuts.md, formats-reference.md
// Run `node scripts/gen-guide-reference.mjs` to rewrite them, or add --check to fail if they are stale
// (used by `pnpm guide:check`). The engine's extensionless .ts imports resolve through ts-resolve-hook.mjs.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
register(pathToFileURL(join(root, "scripts", "ts-resolve-hook.mjs")).href);
const load = (p) => import(pathToFileURL(join(root, p)).href);
const GUIDE = join(root, "docs", "guide");
const check = process.argv.includes("--check");

const { FILL_PATTERNS } = await load("engine/src/model/patterns.ts");
const sewing = await load("engine/src/presets/sewing.ts");
const { FORMATS } = await load("engine/src/formats/types.ts");
const { TOOLS } = await load("editor/src/tools/registry.ts");

const cell = (s) => String(s).replace(/\|/g, "/").replace(/\s+/g, " ").trim();
const front = (o) => `---\n${Object.entries(o).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n")}\n---\n\n# ${o.title}\n`;

const pages = {};

// ---- fill patterns --------------------------------------------------------------------------------
{
  const fam = { rows: "Rows", motif: "Motif", path: "Path" };
  let body = `${front({
    id: "fill-patterns",
    title: "All fill patterns",
    summary: `Every one of the ${FILL_PATTERNS.length} fill patterns: what it looks like, what its sliders do, and when to pick it.`,
    section: "stitches",
    order: 40,
    keywords: ["fill", "pattern", "tatami", "texture", "motif", "gradient", "contour", "spiral"],
    appContext: ["panel.fill-pattern"],
    status: "generated",
  })}
This page is built from the app's own pattern list, so it always matches what you see in the picker. It has ${FILL_PATTERNS.length} patterns in three families.

- **Rows** are parallel lines of stitches. You can bend them, break them and fade them with a gradient.
- **Motif** patterns repeat a small shape across the area, like a brick or a weave.
- **Path** patterns follow the shape: rings, spirals, rays or flow lines.

Set the pattern in the **Fill pattern** section of the left panel. Each preview there shows the pattern on a 40 by 30 mm shape. Pull compensation, underlay and row spacing work the same for every pattern. Read about them in [Underlay and pull compensation](underlay-and-pull.md).

`;
  for (const f of ["rows", "motif", "path"]) {
    const list = FILL_PATTERNS.filter((p) => p.family === f);
    body += `## ${fam[f]} patterns (${list.length})\n\n`;
    for (const p of list) {
      body += `### ${p.label}\n\n${p.help}\n\n`;
      const facts = [];
      facts.push(p.gradient ? "Supports a gradient." : "No gradient.");
      facts.push(p.underlay ? "Gets the automatic underlay." : "Open pattern: no automatic underlay, because it would show through the gaps.");
      if (p.centred) facts.push("Has a movable centre: drag the cross on the canvas.");
      if (p.guided) facts.push("Follows guide curves you draw.");
      body += `${facts.join(" ")}\n\n`;
      if (p.settings.length) {
        body += `| Setting | Range | Default | What it does |\n| --- | --- | --- | --- |\n`;
        for (const s of p.settings) body += `| ${cell(s.label)} | ${s.min} to ${s.max} | ${s.default} | ${cell(s.help)} |\n`;
        body += "\n";
      }
    }
  }
  pages["fill-patterns.md"] = body;
}

// ---- Sewing setup presets -------------------------------------------------------------------------
{
  const { FABRICS, FABRIC_IDS, THREAD_WEIGHTS, THREAD_WEIGHT_IDS, QUALITIES, QUALITY_IDS } = sewing;
  let body = `${front({
    id: "sewing-presets",
    title: "Sewing setup presets",
    summary: "What each fabric, thread weight and quality choice means: needle, stabiliser, hooping and how the stitches change.",
    section: "stitches",
    order: 60,
    keywords: ["fabric", "needle", "stabiliser", "stabilizer", "thread weight", "40 wt", "60 wt", "quality", "preset", "suiting", "knit", "towel", "leather"],
    appContext: ["panel.sewing-setup", "dialog.before-you-sew"],
    status: "generated",
  })}
This page is built from the same tables the app uses for the **Sewing setup** card and the **Before you sew** checklist. Every number is a starting point. Sew a small test first, on a scrap of the same cloth.

You choose three things: the **fabric**, the **thread weight** and the **quality**. Lilo then picks stitch spacing, edge compensation and underlay for you. Read how they work in [Sewing setup](sewing-setup.md).

## Fabrics

`;
  for (const id of FABRIC_IDS) {
    const f = FABRICS[id];
    body += `### ${f.label}\n\n${f.description}\n\n`;
    body += `- **Needle:** ${f.needle.size} ${f.needle.type}. ${f.needle.note}\n`;
    body += `- **Stabiliser:** ${f.stabiliser.type}, ${f.stabiliser.weight}. ${f.stabiliser.note}\n`;
    body += `- **Topping:** ${f.topping === "none" ? "none needed." : "a water-soluble topping on top, so the stitches do not sink into the pile."}\n`;
    for (const h of f.hooping) body += `- **Hooping:** ${h}\n`;
    const e = f.engine;
    const bits = [];
    if (e.pullCompFactor !== 1) bits.push(`edge compensation is ${Math.round(e.pullCompFactor * 100)} % of the woven value`);
    if (e.densityFactor !== 1) bits.push(`line spacing is ${e.densityFactor > 1 ? "looser" : "tighter"} (x${e.densityFactor})`);
    if (e.minSatinFloorMm) bits.push(`the narrowest satin column is ${e.minSatinFloorMm} mm`);
    if (!e.zigzagUnderlay) bits.push("no zig-zag underlay");
    body += `- **What Lilo changes:** ${bits.length ? bits.join("; ") + "." : "nothing. This is the baseline the other fabrics are measured against."}\n\n`;
  }
  body += `## Thread weight\n\n`;
  for (const w of THREAD_WEIGHT_IDS) {
    const t = THREAD_WEIGHTS[w];
    body += `### ${t.label}\n\n${t.description}\n\n- **Needle:** ${t.needle}.\n- **Smallest letters:** ${t.minLetterHeightMm} mm tall.\n\n`;
  }
  body += `## Quality\n\n`;
  for (const q of QUALITY_IDS) {
    const p = QUALITIES[q];
    body += `### ${p.label}\n\n${p.summary}\n\nTypical stitch count: ${p.stitchCountMultiplier === 1 ? "the baseline." : `about ${p.stitchCountMultiplier} times the Standard count.`}\n\n`;
  }
  pages["sewing-presets.md"] = body;
}

// ---- Keyboard shortcuts ---------------------------------------------------------------------------
{
  const read = (p) => readFileSync(join(root, p), "utf8");
  const rows = [];
  const grab = (src, group) => {
    for (const line of src.split("\n")) {
      const pc = /\bc\("[^"]+",\s*"([^"]+)".*shortcut:\s*"([^"]+)"/.exec(line);
      if (pc) {
        rows.push({ group, label: pc[1], shortcut: pc[2] });
        continue;
      }
      if (!line.includes("add(")) continue;
      const g = /group:\s*"([^"]+)"/.exec(line);
      const m = /label:\s*"([^"]+)"/.exec(line);
      const s = /shortcut:\s*"([^"]+)"/.exec(line);
      if (m && s) rows.push({ group: g ? g[1] : group, label: m[1], shortcut: s[1] });
    }
  };
  grab(read("editor/src/tools/commands.ts"), "Other");
  if (existsSync(join(root, "editor/src/project/commands.ts"))) grab(read("editor/src/project/commands.ts"), "File");
  const toolRows = TOOLS.filter((t) => t.enabled).map((t) => ({ group: "Tools", label: `${t.label} tool`, shortcut: t.key === " " ? "Space" : t.key.toUpperCase() }));
  const seen = new Set();
  const all = [];
  for (const r of [...toolRows, ...rows]) {
    const k = `${r.group}|${r.label}`;
    if (!seen.has(k)) {
      seen.add(k);
      all.push(r);
    }
  }
  all.push({ group: "Help", label: "Open the Help panel", shortcut: "⌘?" }, { group: "Help", label: "Search every tool and action", shortcut: "⌘K" });
  const groups = [...new Set(all.map((r) => r.group))];
  let body = `${front({
    id: "keyboard-shortcuts",
    title: "Keyboard shortcuts",
    summary: "Every keyboard shortcut, built from the app's own tool list and command list.",
    section: "reference",
    order: 10,
    keywords: ["keyboard", "shortcut", "hotkey", "key", "command", "palette"],
    appContext: ["dialog.command-palette"],
    status: "generated",
  })}
This list is built from the app's tool registry and command list. On Windows and Linux, use **Ctrl** where you see **⌘**. **⇧** is Shift. **⌫** is Backspace.

You do not have to remember these. Press **⌘K** and type what you want. The search box finds every tool and action.

`;
  for (const g of groups) {
    body += `## ${g}\n\n| Action | Keys |\n| --- | --- |\n`;
    for (const r of all.filter((x) => x.group === g)) body += `| ${cell(r.label)} | ${cell(r.shortcut)} |\n`;
    body += "\n";
  }
  body += `## Mouse and trackpad\n\n- **Scroll** or pinch to zoom the canvas.\n- Hold **Space** and drag to pan with any tool.\n- **Shift**-click adds to a selection.\n- Drag from a ruler to pull out a guide line.\n- **Double-click** a shape to reshape its points.\n`;
  pages["keyboard-shortcuts.md"] = body;
}

// ---- Formats ----------------------------------------------------------------------------------------
{
  const compatPath = join(root, "docs", "compat.json");
  const compat = existsSync(compatPath) ? JSON.parse(readFileSync(compatPath, "utf8")) : null;
  const meta = new Map((compat?.formats ?? []).map((f) => [f.ext, f]));
  let body = `${front({
    id: "formats-reference",
    title: "File formats",
    summary: `The ${FORMATS.length} embroidery file formats Lilo writes (all but G-code it also reads), and which machines use each one.`,
    section: "reference",
    order: 20,
    keywords: ["format", "pes", "dst", "exp", "jef", "vp3", "xxx", "u01", "pec", "brand", "machine", "compatibility"],
    appContext: ["dialog.export", "view.converter"],
    status: "generated",
  })}
Lilo writes ${FORMATS.length} embroidery formats and reads ${FORMATS.filter((f) => f.canRead !== false).length} of them. The list is built from the app's own format table.

A format is the file type your machine understands. Brother and Baby Lock machines use **PES**. Most commercial machines use **DST**. If you are not sure, check your machine manual or the type of file it already sews.

| Extension | Name | Lilo | Keeps thread colours? | Used by |
| --- | --- | --- | --- | --- |
`;
  for (const f of FORMATS) {
    const m = meta.get(f.ext);
    const brands = m ? m.brands.join(", ") : "See your machine manual";
    body += `| .${f.ext} | ${cell(f.label)} | ${f.canRead === false ? "Write only" : "Read and write"} | ${f.hasColors ? "Yes" : "No"} | ${cell(brands)} |\n`;
  }
  body += `\n**Keeps thread colours** matters when you send a file. Formats without colours still sew in the right order. They just show you "colour 1, colour 2" instead of real thread names. See [Choosing a format](export-formats.md).\n\n`;
  if (compat) {
    body += `## Machine compatibility\n\nThe research behind Lilo covers ${compat.counts.brands} brands, ${compat.counts.machines} machines and ${compat.counts.threadBrands} thread brands. No machine has been tested on real hardware beyond one pending Brother run, so treat every machine as "should work" until you have sewn one design. The full tables are in compatibility.md in the docs folder.\n`;
  } else {
    body += `## Machine compatibility\n\nWi-Fi sending works with Brother and Baby Lock machines that have built-in Wi-Fi. Every other machine uses a file on a USB stick. Read [Send over Wi-Fi](lilo-link-wifi.md) and [USB stick](usb-stick.md).\n`;
  }
  pages["formats-reference.md"] = body;
}

let stale = 0;
for (const [name, text] of Object.entries(pages)) {
  const path = join(GUIDE, name);
  if (check) {
    const now = existsSync(path) ? readFileSync(path, "utf8") : "";
    if (now !== text) {
      console.error(`stale: docs/guide/${name} (run node scripts/gen-guide-reference.mjs)`);
      stale++;
    }
  } else writeFileSync(path, text);
}
if (check && stale) process.exit(1);
if (!check) console.log(`wrote ${Object.keys(pages).length} generated pages`);
