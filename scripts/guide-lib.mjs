// Shared by scripts/build-guide-index.mjs, the guide tests and (through index.json) the app.
// Pure functions only: parse a page, slug a heading, and validate every guide data file.

export const BANNED_WORDS = ["simply", "just", "easily"];
// Pictographs and dingbats: the guide has no emoji.
export const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B50}\u{2705}\u{274C}]/u;
export const REQUIRED_FRONT = ["id", "title", "summary", "section", "order", "keywords", "appContext", "status"];
export const STATUSES = ["draft", "ready", "generated"];
export const HINT_LEVELS = ["basic", "advanced"];

/** Conditions a tour step can advance on. The editor implements each one (editor/src/guide/conditions.ts). */
export const TOUR_CONDITIONS = ["has-objects", "tool:closed", "tool:text", "dialog:any", "played", "view:editor", "sewing-open"];
/** Signals a live warning can listen to (editor/src/guide/liveSignals.ts). */
export const LIVE_SIGNALS = ["plan:outside-hoop", "plan:density", "plan:stitch-too-long", "plan:thin-satin", "plan:long-stitch-snag", "plan:object-failed", "colour-changes", "stitch-count", "sewing-time", "tiny-region", "satin-too-wide", "letters-small"];
export const LIVE_FIXES = ["smallest-hoop", "group-by-colour", "set-60wt", "enable-split", "loosen-spacing", "delete-tiny"];
export const WORKFLOW_IDS = ["design", "size", "stitches", "preview", "send"];
export const WORKFLOW_ACTIONS = ["open-digitize", "open-hoop", "open-sewing", "focus-player", "open-send", "none"];

export const slug = (text) =>
  text
    .toLowerCase()
    .replace(/`|\*|_/g, "")
    .replace(/[^a-z0-9 \-]/g, "")
    .trim()
    .replace(/ +/g, "-");

export const wordCount = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);

/** Split `---` frontmatter (key: JSON value) from the body. */
export function parsePage(text, file) {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) throw new Error(`${file}: no frontmatter`);
  const meta = {};
  for (const line of m[1].split("\n")) {
    if (!line.trim()) continue;
    const i = line.indexOf(":");
    if (i < 0) throw new Error(`${file}: bad frontmatter line "${line}"`);
    const key = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    try {
      meta[key] = JSON.parse(raw);
    } catch {
      meta[key] = raw;
    }
  }
  return { meta, body: text.slice(m[0].length).replace(/^\n+/, "") };
}

/** Headings (levels 2 and 3) outside code fences. */
export function headingsOf(body) {
  const out = [];
  let fence = false;
  for (const line of body.split("\n")) {
    if (line.startsWith("```")) fence = !fence;
    if (fence) continue;
    const m = /^(#{2,3})\s+(.+?)\s*$/.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2].replace(/\*\*/g, ""), slug: slug(m[2]) });
  }
  return out;
}

/** `[text](target)` and `![alt](target)` in a body. */
export function linksOf(body) {
  const out = [];
  const re = /(!?)\[([^\]]*)\]\(([^)\s]+)\)/g;
  for (const raw of body.split("\n")) {
    let m;
    while ((m = re.exec(raw))) out.push({ image: m[1] === "!", text: m[2], target: m[3] });
  }
  return out;
}

const hasWord = (text, w) => new RegExp(`\\b${w}\\b`, "i").test(text);

/** Voice checks that apply to hand-written copy (pages, hints, tour, warnings). */
export function voiceProblems(text, where) {
  const p = [];
  for (const w of BANNED_WORDS) if (hasWord(text, w)) p.push(`${where}: uses "${w}"`);
  if (EMOJI.test(text)) p.push(`${where}: has an emoji`);
  return p;
}

/** Validate one page's frontmatter. Returns problems. */
export function checkFront(meta, file, sections, contexts) {
  const p = [];
  for (const k of REQUIRED_FRONT) if (!(k in meta)) p.push(`${file}: missing "${k}"`);
  if (p.length) return p;
  const base = file.replace(/\.md$/, "");
  if (meta.id !== base) p.push(`${file}: id "${meta.id}" must equal the file name "${base}"`);
  if (!/^[a-z0-9-]+$/.test(meta.id)) p.push(`${file}: id must be lower-case letters, numbers and dashes`);
  if (!sections.includes(meta.section)) p.push(`${file}: unknown section "${meta.section}"`);
  if (typeof meta.order !== "number") p.push(`${file}: order must be a number`);
  if (!Array.isArray(meta.keywords) || meta.keywords.length === 0) p.push(`${file}: keywords must be a non-empty array`);
  if (!Array.isArray(meta.appContext)) p.push(`${file}: appContext must be an array`);
  else for (const c of meta.appContext) if (!contexts.includes(c)) p.push(`${file}: unknown appContext "${c}"`);
  if (!STATUSES.includes(meta.status)) p.push(`${file}: status must be one of ${STATUSES.join(", ")}`);
  if (typeof meta.title !== "string" || !meta.title) p.push(`${file}: empty title`);
  if (typeof meta.summary !== "string" || wordCount(meta.summary) > 30) p.push(`${file}: summary must be a string of 30 words or fewer`);
  return p;
}

/** Split "page#heading" into parts. */
export const splitGuideRef = (ref) => {
  const [id, anchor] = ref.split("#");
  return { id, anchor };
};

/** Check a guide reference against the page table (id -> {headings}). */
export function checkGuideRef(ref, pages, where) {
  const { id, anchor } = splitGuideRef(ref);
  const page = pages.get(id);
  if (!page) return [`${where}: unknown guide page "${ref}"`];
  if (anchor && !page.headings.some((h) => h.slug === anchor)) return [`${where}: page "${id}" has no heading "${anchor}"`];
  return [];
}

export function checkHints(hints, pages) {
  const p = [];
  if (!Array.isArray(hints)) return ["hints.json: must be an array"];
  const seen = new Set();
  for (const h of hints) {
    const w = `hint ${h.id ?? "?"}`;
    for (const k of ["id", "label", "what", "when", "typical", "guideId", "level"]) if (typeof h[k] !== "string" || !h[k]) p.push(`${w}: missing "${k}"`);
    if (typeof h.id !== "string") continue;
    if (!/^[a-z0-9]+(\.[a-z0-9-]+)+$/.test(h.id)) p.push(`${w}: id must look like area.name`);
    if (seen.has(h.id)) p.push(`${w}: duplicate id`);
    seen.add(h.id);
    if (typeof h.what === "string" && wordCount(h.what) > 20) p.push(`${w}: "what" is ${wordCount(h.what)} words (max 20)`);
    if (typeof h.when === "string" && wordCount(h.when) > 25) p.push(`${w}: "when" is ${wordCount(h.when)} words (max 25)`);
    if (h.level && !HINT_LEVELS.includes(h.level)) p.push(`${w}: level must be basic or advanced`);
    if (h.effects !== undefined && typeof h.effects !== "string") p.push(`${w}: effects must be a string`);
    if (typeof h.guideId === "string") p.push(...checkGuideRef(h.guideId, pages, w));
    for (const k of ["label", "what", "when", "typical", "effects"]) if (typeof h[k] === "string") p.push(...voiceProblems(h[k], `${w}.${k}`));
  }
  return p;
}

export function checkTour(tour, pages) {
  const p = [];
  if (!tour || !Array.isArray(tour.paths)) return ["tour.json: needs a paths array"];
  const w = tour.welcome;
  if (!w || !w.title || !w.body || !Array.isArray(w.choices)) p.push("tour.json: welcome needs title, body and choices");
  const ids = new Set(tour.paths.map((x) => x.id));
  for (const c of w?.choices ?? []) {
    if (!ids.has(c.path)) p.push(`tour welcome choice "${c.label}": unknown path "${c.path}"`);
    if (!c.label || !c.hint) p.push(`tour welcome choice: needs label and hint`);
  }
  for (const path of tour.paths) {
    const n = path.steps?.length ?? 0;
    if (n < 6 || n > 10) p.push(`tour path ${path.id}: ${n} steps (need 6 to 10)`);
    const seen = new Set();
    for (const s of path.steps ?? []) {
      const sw = `tour ${path.id}/${s.id ?? "?"}`;
      if (!s.id || seen.has(s.id)) p.push(`${sw}: missing or duplicate id`);
      seen.add(s.id);
      if (!s.title || !s.body) p.push(`${sw}: needs title and body`);
      if (wordCount(s.body ?? "") > 40) p.push(`${sw}: body over 40 words`);
      if (s.target !== null && typeof s.target !== "string") p.push(`${sw}: target must be a string or null`);
      const a = s.advanceOn;
      if (!a || !["next", "state"].includes(a.type)) p.push(`${sw}: advanceOn.type must be next or state`);
      else if (a.type === "state" && !TOUR_CONDITIONS.includes(a.cond)) p.push(`${sw}: unknown condition "${a.cond}"`);
      if (s.guideId) p.push(...checkGuideRef(s.guideId, pages, sw));
      p.push(...voiceProblems(`${s.title} ${s.body}`, sw));
    }
  }
  return p;
}

export function checkWorkflow(wf, pages) {
  const p = [];
  if (!wf || !Array.isArray(wf.steps)) return ["workflow.json: needs a steps array"];
  if (wf.steps.map((s) => s.id).join() !== WORKFLOW_IDS.join()) p.push(`workflow.json: steps must be ${WORKFLOW_IDS.join(", ")} in that order`);
  for (const s of wf.steps) {
    const w = `workflow ${s.id}`;
    if (!s.label || !s.tip?.title || !s.tip?.body) p.push(`${w}: needs label and tip title and body`);
    if (!WORKFLOW_ACTIONS.includes(s.tip?.action?.kind)) p.push(`${w}: unknown action "${s.tip?.action?.kind}"`);
    if (s.tip?.guideId) p.push(...checkGuideRef(s.tip.guideId, pages, w));
    p.push(...voiceProblems(`${s.label} ${s.tip?.title} ${s.tip?.body}`, w));
  }
  return p;
}

export function checkLiveHints(list, pages) {
  const p = [];
  if (!Array.isArray(list)) return ["live-hints.json: must be an array"];
  const seen = new Set();
  for (const h of list) {
    const w = `live hint ${h.id ?? "?"}`;
    if (!h.id || seen.has(h.id)) p.push(`${w}: missing or duplicate id`);
    seen.add(h.id);
    if (!LIVE_SIGNALS.includes(h.signal)) p.push(`${w}: unknown signal "${h.signal}"`);
    if (!h.message || wordCount(h.message) > 25) p.push(`${w}: message must be 1 to 25 words (is ${wordCount(h.message ?? "")})`);
    if (!["info", "care"].includes(h.severity)) p.push(`${w}: severity must be info or care`);
    const fix = h.fix;
    if (fix && (!fix.label || !LIVE_FIXES.includes(fix.action))) p.push(`${w}: bad fix`);
    if (h.threshold !== undefined && typeof h.threshold !== "number") p.push(`${w}: threshold must be a number`);
    if (!fix && !h.guideId) p.push(`${w}: needs a fix or a guide link`);
    if (h.guideId) p.push(...checkGuideRef(h.guideId, pages, w));
    p.push(...voiceProblems(`${h.message} ${fix?.label ?? ""}`, w));
  }
  return p;
}
