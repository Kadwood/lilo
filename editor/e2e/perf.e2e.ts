import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterAll, describe, expect, it } from "vitest";
import { chromium, type Page } from "playwright-core";
import { REPO } from "./harness";
import { chromiumPath } from "./chromium";

/**
 * Opt-in performance run (`LILO_PERF=1 pnpm --filter editor exec vitest run -c vitest.e2e.config.ts e2e/perf.e2e.ts`).
 * Builds the editor for production, serves it with `vite preview`, and measures it in headless Chromium
 * with a stress project (300 objects, 76k stitches; `LILO_STRESS_FILE`, made by `engine/test/perf.test.ts`'s
 * fixtures). `LILO_ROOT` points at another checkout to measure instead (for before/after). Results go to
 * stdout and, with `LILO_PERF_OUT`, to a JSON file. Numbers come from software WebGL (SwiftShader): good for
 * comparing two builds, not for the absolute frame rate of a real GPU.
 */
const ON = process.env.LILO_PERF === "1";
const ROOT = process.env.LILO_ROOT ?? REPO;
const STRESS = process.env.LILO_STRESS_FILE ?? join(tmpdir(), "lilo-stress.lilo");

let preview: ChildProcess | null = null;
afterAll(() => void preview?.kill());

const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const r1 = (n: number) => Math.round(n * 10) / 10;

function sizes(dist: string) {
  const dir = join(dist, "assets");
  const files = readdirSync(dir).filter((f) => f.endsWith(".js"));
  const info = (f: string) => {
    const b = readFileSync(join(dir, f));
    return { file: f, bytes: b.length, gzip: gzipSync(b).length };
  };
  const find = (re: RegExp) => files.filter((f) => re.test(f)).map(info).sort((a, b) => b.bytes - a.bytes)[0];
  const all = files.map(info).sort((a, b) => b.bytes - a.bytes);
  const total = all.reduce((n, f) => n + f.bytes, 0);
  return { main: find(/^index-/), worker: find(/^worker-/), largestChunks: all.slice(0, 5), jsTotalBytes: total, jsChunks: all.length };
}

/** Per-phase long-task numbers from the page's observer, then reset it. */
async function longTasks(page: Page) {
  return page.evaluate(() => {
    const p = (window as unknown as { __perf: { long: { start: number; dur: number }[] } }).__perf;
    const l = p.long.splice(0);
    return { count: l.length, over100: l.filter((t) => t.dur > 100).length, maxMs: Math.round(Math.max(0, ...l.map((t) => t.dur))), totalMs: Math.round(l.reduce((n, t) => n + t.dur, 0)) };
  });
}

/** Frame times (ms) of every animation frame over `ms`. */
async function frames(page: Page, ms: number): Promise<number[]> {
  return page.evaluate(
    (span) =>
      new Promise<number[]>((resolve) => {
        const ts: number[] = [];
        const f = (t: number) => {
          ts.push(t);
          if (t - ts[0] < span) requestAnimationFrame(f);
          else resolve(ts.slice(1).map((x, i) => x - ts[i]));
        };
        requestAnimationFrame(f);
      }),
    ms,
  );
}
const fpsOf = (dts: number[]) => {
  const sorted = [...dts].sort((a, b) => a - b);
  const total = dts.reduce((n, x) => n + x, 0);
  return { fps: r1((dts.length / total) * 1000), p95FrameMs: r1(sorted[Math.floor(sorted.length * 0.95)] ?? 0), worstFrameMs: r1(sorted[sorted.length - 1] ?? 0), frames: dts.length };
};

const statsOf = async (page: Page): Promise<number> => {
  const t = page.getByLabel("Design totals");
  if ((await t.count()) === 0) return 0;
  return Number(/([\d,]+) \/ ([\d,]+) stitches/.exec(await t.innerText())?.[2].replace(/,/g, "") ?? 0);
};

describe.skipIf(!ON)("performance", () => {
  it("measures the production build", async () => {
    const out: Record<string, unknown> = { root: ROOT };
    // every phase is reported as soon as it is done, so a run that stalls still leaves numbers behind
    const report = (key: string) => {
      console.log(`[perf] ${key}: ${JSON.stringify(out[key])}`);
      if (process.env.LILO_PERF_OUT) writeFileSync(process.env.LILO_PERF_OUT, JSON.stringify(out, null, 2));
    };
    const dist = join(tmpdir(), `lilo-perf-dist-${process.pid}`);
    mkdirSync(dist, { recursive: true });

    // ---- build + sizes ------------------------------------------------------------------------
    const t0 = Date.now();
    execFileSync("npx", ["vite", "build", "--outDir", dist, "--emptyOutDir"], { cwd: join(ROOT, "editor"), stdio: "pipe", env: { ...process.env, NODE_ENV: "production", VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" } });
    out.buildSeconds = r1((Date.now() - t0) / 1000);
    out.bundle = sizes(dist);
    report("bundle");

    // ---- serve it -----------------------------------------------------------------------------
    const port = 4300 + (process.pid % 500);
    preview = spawn("npx", ["vite", "preview", "--outDir", dist, "--port", String(port), "--strictPort", "--host", "127.0.0.1"], { cwd: join(ROOT, "editor"), stdio: "pipe", env: { ...process.env, NODE_ENV: "production", VITE_CONFIG_NATIVE_IGNORE_WARNING: "true" } });
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("vite preview did not start")), 30_000);
      preview!.stdout!.on("data", (d: Buffer) => /Local:/.test(d.toString()) && (clearTimeout(timer), resolve()));
      preview!.on("exit", () => reject(new Error("vite preview exited")));
    });
    const url = `http://127.0.0.1:${port}/`;

    const browser = await chromium.launch({ executablePath: chromiumPath(), args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-precise-memory-info", "--js-flags=--expose-gc"] });
    const init = () => {
      const w = window as unknown as { __perf: { long: { start: number; dur: number }[] } };
      w.__perf = { long: [] };
      new PerformanceObserver((l) => l.getEntries().forEach((e) => w.__perf.long.push({ start: e.startTime, dur: e.duration }))).observe({ type: "longtask", buffered: true });
    };

    try {
      // ---- cold start: new context (empty HTTP cache) each time, median of 3 ------------------------
      const cold: { fcp: number; ready: number; interactive: number; longTasks: number; maxLongMs: number }[] = [];
      for (let i = 0; i < 3; i++) {
        const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        await ctx.addInitScript(init);
        const page = await ctx.newPage();
        await page.goto(url, { waitUntil: "commit" });
        await page.getByRole("button", { name: "New design" }).waitFor();
        const ready = await page.evaluate(() => performance.now());
        await page.waitForTimeout(1200);
        const m = await page.evaluate(() => {
          const w = window as unknown as { __perf: { long: { start: number; dur: number }[] } };
          const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;
          return { fcp, long: w.__perf.long };
        });
        // interactive: the button is there and the main thread then stays quiet; if a long task ends after it, use that end
        const lastEnd = Math.max(0, ...m.long.filter((t) => t.start < ready + 500).map((t) => t.start + t.dur));
        cold.push({ fcp: m.fcp, ready, interactive: Math.max(ready, lastEnd), longTasks: m.long.length, maxLongMs: Math.max(0, ...m.long.map((t) => t.dur)) });
        await ctx.close();
      }
      out.coldStart = {
        firstContentfulPaintMs: Math.round(median(cold.map((c) => c.fcp))),
        homeReadyMs: Math.round(median(cold.map((c) => c.ready))),
        interactiveMs: Math.round(median(cold.map((c) => c.interactive))),
        longTasks: median(cold.map((c) => c.longTasks)),
        maxLongTaskMs: Math.round(median(cold.map((c) => c.maxLongMs))),
        runs: cold.map((c) => Math.round(c.interactive)),
      };
      report("coldStart");

      // ---- the stress project ----------------------------------------------------------------------
      expect(existsSync(STRESS), `stress project not found at ${STRESS}`).toBe(true);
      out.stressFileBytes = statSync(STRESS).size;
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
      await ctx.addInitScript(init);
      const page = await ctx.newPage();
      const problems: string[] = [];
      page.on("console", (m) => m.type() === "error" && problems.push(m.text()));
      page.on("pageerror", (e) => problems.push(String(e)));
      await page.goto(url);
      await page.getByRole("button", { name: "Open…" }).waitFor();
      await longTasks(page);

      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Open…" }).click();
      const tLoad = Date.now();
      await (await chooser).setFiles(STRESS);
      await page.getByText(/\d[\d,]* \/ [\d,]+ stitches/).waitFor({ timeout: 120_000 });
      out.stressLoad = { toStitchesMs: Date.now() - tLoad, stitches: await statsOf(page), longTasks: await longTasks(page) };
      report("stressLoad");
      await page.waitForTimeout(1500);
      await longTasks(page);

      // pan (Pan tool drag) and zoom (wheel), measured frame by frame
      const box = (await page.getByRole("main", { name: "Canvas" }).boundingBox())!;
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2 - 40;
      await page.getByRole("button", { name: "Pan", exact: true }).click();
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      console.log("[perf] panning");
      const panFrames = frames(page, 3000);
      for (let i = 0; i < 90; i++) {
        await page.mouse.move(cx + Math.sin(i / 8) * 160, cy + Math.cos(i / 8) * 90);
        await page.waitForTimeout(30);
      }
      const pan = fpsOf(await panFrames);
      await page.mouse.up();
      out.pan = { ...pan, longTasks: await longTasks(page) };
      report("pan");

      await page.mouse.move(cx, cy);
      const zoomFrames = frames(page, 3000);
      for (let i = 0; i < 90; i++) {
        await page.mouse.wheel(0, i % 30 < 15 ? -90 : 90);
        await page.waitForTimeout(30);
      }
      out.zoom = { ...fpsOf(await zoomFrames), longTasks: await longTasks(page) };
      report("zoom");
      await page.getByRole("button", { name: "Fit", exact: true }).click();
      await page.getByRole("button", { name: "Select", exact: true }).click();

      // stitch player at 50x
      const bar = page.getByRole("group", { name: "Stitch player" });
      await bar.getByLabel("Scrub stitches").fill("0");
      await bar.getByLabel("Playback speed").fill("50");
      await page.evaluate(() => (document.querySelector('.player input[type="checkbox"]') as HTMLInputElement | null)?.click()); // Auto-continue: the stress design has a colour change after every object
      await longTasks(page);
      await bar.getByRole("button", { name: "Play" }).click();
      const playFrames = frames(page, 3000);
      const played = fpsOf(await playFrames);
      const scrubbed = Number(await page.evaluate(() => (document.querySelector('input[aria-label="Scrub stitches"]') as HTMLInputElement | null)?.value ?? 0));
      await page.evaluate(() => (document.querySelector('button[aria-label="Pause"]') as HTMLButtonElement | null)?.click());
      out.player50x = { ...played, stitchesPlayedIn3s: scrubbed, longTasks: await longTasks(page) };
      report("player50x");

      // re-stitch latency after a single-object change: click a row, flip it, time until "Stitching…" goes away
      await page.evaluate(() => {
        const w = window as unknown as { __lat: { t0: number; done: number[] }; __perfLat: () => void };
        w.__lat = { t0: 0, done: [] };
        const pill = () => [...document.querySelectorAll(".canvas-status .status-pill")].some((e) => /Stitching/.test(e.textContent ?? ""));
        let seen = false;
        new MutationObserver(() => {
          const now = pill();
          if (now) seen = true;
          else if (seen && w.__lat.t0) {
            w.__lat.done.push(performance.now() - w.__lat.t0);
            seen = false;
            w.__lat.t0 = 0;
          }
        }).observe(document.body, { subtree: true, childList: true, characterData: true });
        window.addEventListener("pointerdown", () => (w.__lat.t0 = performance.now()), true);
      });
      const rows = page.getByRole("complementary", { name: "Sew order" }).locator("li.seq-row");
      await rows.first().waitFor();
      const lat: number[] = [];
      for (let i = 0; i < 12; i++) {
        await rows.nth(40 + i).click();
        await page.waitForTimeout(500);
        await page.evaluate(() => void ((window as unknown as { __lat: { done: number[] } }).__lat.done.length = 0));
        await page.getByRole("button", { name: "Flip H" }).click(); // pointerdown starts the clock
        await page.waitForFunction(() => (window as unknown as { __lat: { done: number[] } }).__lat.done.length > 0, null, { timeout: 30_000 });
        lat.push(await page.evaluate(() => (window as unknown as { __lat: { done: number[] } }).__lat.done[0]));
      }
      out.restitchLatencyMs = { median: Math.round(median(lat)), max: Math.round(Math.max(...lat)), runs: lat.map(Math.round), note: "includes the 150 ms debounce" };
      out.restitchLongTasks = await longTasks(page);
      report("restitchLatencyMs");

      // memory: many edits and 50 autosave snapshots (a blur is an autosave), then the heap
      const cdp = await ctx.newCDPSession(page);
      const heap = async () => {
        await cdp.send("HeapProfiler.collectGarbage");
        await cdp.send("HeapProfiler.collectGarbage");
        const u = (await cdp.send("Runtime.getHeapUsage")) as { usedSize: number };
        return Math.round(u.usedSize / 1024 / 1024);
      };
      const heapStart = await heap();
      const tEdit = Date.now();
      let edits = 0;
      for (let snap = 0; snap < 50; snap++) {
        await rows.nth(snap % 200).click();
        for (let k = 0; k < 12; k++) {
          await page.getByRole("button", { name: k % 2 ? "Flip V" : "Flip H" }).click();
          edits++;
        }
        await page.evaluate(() => window.dispatchEvent(new Event("blur"))); // autosave
        await page.waitForTimeout(120);
      }
      await page.waitForTimeout(1500);
      out.edits = { count: edits, seconds: r1((Date.now() - tEdit) / 1000), heapStartMB: heapStart, heapAfterMB: await heap(), longTasks: await longTasks(page) };
      let snapBytes = 0;
      cdp.on("HeapProfiler.addHeapSnapshotChunk", (c: { chunk: string }) => (snapBytes += c.chunk.length));
      await cdp.send("HeapProfiler.takeHeapSnapshot", { reportProgress: false });
      (out.edits as Record<string, unknown>).heapSnapshotMB = Math.round(snapBytes / 1024 / 1024);
      report("edits");

      // save with 50 snapshots, then load it again
      await page.keyboard.press("Escape");
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      const dl = page.waitForEvent("download", { timeout: 60_000 });
      const tSave = Date.now();
      await page.keyboard.press("Control+s");
      const download = await dl;
      const saved = await download.path();
      const saveMs = Date.now() - tSave;
      out.save = { ms: saveMs, bytes: saved ? statSync(saved).size : 0 };
      const again = await ctx.newPage();
      await again.goto(url);
      await again.getByRole("button", { name: "Open…" }).waitFor();
      const chooser2 = again.waitForEvent("filechooser");
      await again.getByRole("button", { name: "Open…" }).click();
      const tReload = Date.now();
      await (await chooser2).setFiles(saved!);
      await again.getByText(/\d[\d,]* \/ [\d,]+ stitches/).waitFor({ timeout: 120_000 });
      (out.save as Record<string, unknown>).reopenToStitchesMs = Date.now() - tReload;
      report("save");
      out.problems = problems.slice(0, 10);
    } finally {
      await browser.close();
    }

    const text = JSON.stringify(out, null, 2);
    console.log(text);
    if (process.env.LILO_PERF_OUT) writeFileSync(process.env.LILO_PERF_OUT, text);
  }, 1_800_000);
});
