// Tests for the guide validators (scripts/guide-lib.mjs) and a check that the real guide passes them.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkFront, checkGuideRef, checkHints, checkLiveHints, checkTour, checkWorkflow, headingsOf, parsePage, slug, voiceProblems } from "./guide-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pages = new Map([["a", { headings: [{ slug: "one" }] }]]);
const SECTIONS = ["help"];
const CONTEXTS = ["panel.help"];

test("parsePage reads JSON frontmatter and the body", () => {
  const { meta, body } = parsePage('---\nid: "a"\norder: 2\nkeywords: ["x"]\n---\n\n# Hi\n', "a.md");
  assert.equal(meta.id, "a");
  assert.equal(meta.order, 2);
  assert.deepEqual(meta.keywords, ["x"]);
  assert.equal(body, "# Hi\n");
});

test("headings get stable slugs, code fences are skipped", () => {
  const hs = headingsOf("## Pull compensation\n```\n## nope\n```\n### A high stitch count (long)\n");
  assert.deepEqual(hs.map((h) => h.slug), ["pull-compensation", "a-high-stitch-count-long"]);
  assert.equal(slug("Start spacing ×"), "start-spacing");
});

test("frontmatter problems are reported", () => {
  const good = { id: "a", title: "T", summary: "S", section: "help", order: 1, keywords: ["k"], appContext: ["panel.help"], status: "ready" };
  assert.deepEqual(checkFront(good, "a.md", SECTIONS, CONTEXTS), []);
  assert.match(checkFront({ ...good, id: "b" }, "a.md", SECTIONS, CONTEXTS).join(), /must equal the file name/);
  assert.match(checkFront({ ...good, appContext: ["nope"] }, "a.md", SECTIONS, CONTEXTS).join(), /unknown appContext/);
  assert.match(checkFront({ ...good, section: "x" }, "a.md", SECTIONS, CONTEXTS).join(), /unknown section/);
  assert.match(checkFront({ id: "a" }, "a.md", SECTIONS, CONTEXTS).join(), /missing/);
});

test("guide references need a real page and heading", () => {
  assert.deepEqual(checkGuideRef("a#one", pages, "w"), []);
  assert.match(checkGuideRef("b", pages, "w")[0], /unknown guide page/);
  assert.match(checkGuideRef("a#two", pages, "w")[0], /no heading/);
});

test("voice check catches banned words and emoji", () => {
  assert.equal(voiceProblems("Press the button.", "x").length, 0);
  assert.equal(voiceProblems("Simply press it.", "x").length, 1);
  assert.equal(voiceProblems("It is just a test", "x").length, 1);
  assert.equal(voiceProblems("Nice \u{1F600}", "x").length, 1);
});

test("hint rules: word limits, ids, guide links", () => {
  const ok = { id: "area.name", label: "L", what: "Short.", when: "When.", typical: "T", guideId: "a", level: "basic" };
  assert.deepEqual(checkHints([ok], pages), []);
  assert.match(checkHints([{ ...ok, what: "w ".repeat(21).trim() }], pages).join(), /max 20/);
  assert.match(checkHints([{ ...ok, when: "w ".repeat(26).trim() }], pages).join(), /max 25/);
  assert.match(checkHints([ok, ok], pages).join(), /duplicate/);
  assert.match(checkHints([{ ...ok, guideId: "zz" }], pages).join(), /unknown guide page/);
  assert.match(checkHints([{ ...ok, level: "pro" }], pages).join(), /level/);
});

test("tour rules: 6 to 10 steps per path, known conditions", () => {
  const step = (i) => ({ id: `s${i}`, target: null, title: "T", body: "B", advanceOn: { type: "next" } });
  const tour = (n, extra = {}) => ({ welcome: { title: "t", body: "b", choices: [{ path: "p", label: "l", hint: "h" }] }, paths: [{ id: "p", steps: Array.from({ length: n }, (_, i) => ({ ...step(i), ...extra })) }] });
  assert.deepEqual(checkTour(tour(6), pages), []);
  assert.match(checkTour(tour(5), pages).join(), /need 6 to 10/);
  assert.match(checkTour(tour(11), pages).join(), /need 6 to 10/);
  assert.match(checkTour(tour(6, { advanceOn: { type: "state", cond: "bogus" } }), pages).join(), /unknown condition/);
});

test("workflow and live-hint rules", () => {
  const wf = JSON.parse(readFileSync(join(root, "docs/guide/workflow.json"), "utf8"));
  assert.deepEqual(checkWorkflow(wf, new Map([...pages, ["first-design", { headings: [] }], ["sizing-and-hoops", { headings: [] }], ["sewing-setup", { headings: [] }], ["stitch-player", { headings: [] }], ["send-a-design", { headings: [] }]])), []);
  assert.match(checkWorkflow({ steps: [] }, pages).join(), /steps must be/);
  const live = { id: "x", signal: "plan:density", severity: "care", message: "Short.", guideId: "a" };
  assert.deepEqual(checkLiveHints([live], pages), []);
  assert.match(checkLiveHints([{ ...live, message: "w ".repeat(26).trim() }], pages).join(), /25 words/);
  assert.match(checkLiveHints([{ ...live, signal: "nope" }], pages).join(), /unknown signal/);
  assert.match(checkLiveHints([{ ...live, guideId: undefined }], pages).join(), /fix or a guide link/);
});

test("the real guide passes every check and index.json is current", () => {
  execFileSync("node", ["--experimental-strip-types", "--no-warnings", join(root, "scripts/gen-guide-reference.mjs"), "--check"], { cwd: root, stdio: "pipe" });
  execFileSync("node", [join(root, "scripts/build-guide-index.mjs"), "--check"], { cwd: root, stdio: "pipe" });
});
