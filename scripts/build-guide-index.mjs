// Builds docs/guide/index.json (the app's Help panel reads it) and checks the whole guide:
//   - every page has valid frontmatter, an id equal to its file name, a known section and known appContext values
//   - every link points at a real page and heading, every image has alt text and an existing file (diagrams)
//     or a line in SCREENSHOTS.md (screenshots we have not captured yet)
//     (a screenshot that exists in screenshots/ needs no line)
//   - hints.json, tour.json, workflow.json and live-hints.json are valid and only link to real pages
//   - every error code Lilo Link can return is explained on the troubleshooting page
//   - hand-written copy avoids the banned words and emoji
// `node scripts/build-guide-index.mjs` writes index.json. `--check` fails if it is stale or anything is wrong.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFront, checkGuideRef, checkHints, checkLiveHints, checkTour, checkWorkflow, headingsOf, linksOf, parsePage, voiceProblems, wordCount } from "./guide-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const GUIDE = join(root, "docs", "guide");
const check = process.argv.includes("--check");
const problems = [];
const read = (p) => readFileSync(join(GUIDE, p), "utf8");
const json = (p) => JSON.parse(read(p));

const sections = json("sections.json");
const contexts = Object.keys(json("contexts.json"));
const files = readdirSync(GUIDE).filter((f) => f.endsWith(".md") && f !== "SCREENSHOTS.md").sort();
const shotList = existsSync(join(GUIDE, "SCREENSHOTS.md")) ? read("SCREENSHOTS.md") : "";

const pages = new Map();
for (const file of files) {
  const { meta, body } = parsePage(read(file), file);
  problems.push(...checkFront(meta, file, sections.map((s) => s.id), contexts));
  if (pages.has(meta.id)) problems.push(`${file}: duplicate id ${meta.id}`);
  pages.set(meta.id, { ...meta, body, headings: headingsOf(body), words: wordCount(body) });
}

for (const page of pages.values()) {
  const where = `${page.id}.md`;
  if (page.status !== "generated") problems.push(...voiceProblems(page.body, where));
  if (!/^# /m.test(page.body)) problems.push(`${where}: needs a "# " title heading`);
  for (const l of linksOf(page.body)) {
    if (l.image) {
      if (!l.text.trim()) problems.push(`${where}: image ${l.target} has no alt text`);
      if (l.target.startsWith("diagrams/")) {
        if (!existsSync(join(GUIDE, l.target))) problems.push(`${where}: missing diagram ${l.target}`);
      } else if (l.target.startsWith("screenshots/")) {
        if (!existsSync(join(GUIDE, l.target)) && !shotList.includes(l.target.replace("screenshots/", ""))) problems.push(`${where}: ${l.target} is neither captured nor listed in SCREENSHOTS.md`);
      } else problems.push(`${where}: images must live in diagrams/ or screenshots/ (${l.target})`);
      continue;
    }
    if (/^https?:\/\//.test(l.target)) continue;
    if (/^(here|link|this)$/i.test(l.text.trim())) problems.push(`${where}: link text "${l.text}" is not descriptive`);
    if (/\.md(#|$)/.test(l.target)) {
      const ref = l.target.replace(/\.md/, "");
      if (l.target.startsWith("../")) continue; // a file outside the guide (checked by eye, like compatibility.md)
      problems.push(...checkGuideRef(ref, pages, where));
    } else if (!l.target.startsWith("#")) problems.push(`${where}: unsupported link target ${l.target}`);
  }
}

// data files
const hints = json("hints.json");
const tour = json("tour.json");
const workflow = json("workflow.json");
const live = json("live-hints.json");
problems.push(...checkHints(hints, pages), ...checkTour(tour, pages), ...checkWorkflow(workflow, pages), ...checkLiveHints(live, pages));

// Every error code the Rust side can return must be explained on the troubleshooting page.
{
  const codes = new Set(["not_found", "unauthorized", "internal_error"]);
  const rs = (p) => readFileSync(join(root, "app", "src-tauri", "src", p), "utf8");
  for (const m of rs("machine/error.rs").matchAll(/=>\s*"([a-z_]+)"/g)) codes.add(m[1]);
  for (const f of ["server/routes.rs", "server/jobs.rs", "server/pairing.rs", "server/mod.rs"]) {
    if (!existsSync(join(root, "app", "src-tauri", "src", f))) continue;
    for (const m of rs(f).matchAll(/(?:bad_request|forbidden|conflict)\(\s*"([a-z_]+)"/g)) codes.add(m[1]);
  }
  const t = pages.get("send-troubleshooting");
  for (const c of codes) if (!t?.body.includes(`\`${c}\``)) problems.push(`send-troubleshooting.md: no entry for error code \`${c}\``);
}

const out = {
  version: 1,
  sections,
  pages: [...pages.values()]
    .sort((a, b) => sections.findIndex((s) => s.id === a.section) - sections.findIndex((s) => s.id === b.section) || a.order - b.order || a.id.localeCompare(b.id))
    .map((p) => ({ id: p.id, title: p.title, summary: p.summary, section: p.section, order: p.order, keywords: p.keywords, appContext: p.appContext, status: p.status, words: p.words, headings: p.headings, body: p.body })),
};
const text = `${JSON.stringify(out, null, 1)}\n`;
const target = join(GUIDE, "index.json");
if (check) {
  const now = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (now !== text) problems.push("index.json is stale (run: node scripts/build-guide-index.mjs)");
} else writeFileSync(target, text);

const words = out.pages.reduce((n, p) => n + p.words, 0);
console.log(`${out.pages.length} pages, ${words} words, ${hints.length} hints, ${tour.paths.reduce((n, p) => n + p.steps.length, 0)} tour steps, ${live.length} live warnings`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):\n${problems.map((p) => `  - ${p}`).join("\n")}`);
  process.exit(1);
}
