import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createServer, type ViteDevServer } from "vite";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

/**
 * Shared setup for the journey suite (`pnpm --filter editor e2e`): a Vite dev server on a free port, one
 * headless Chromium, and a page per journey that records every console error, uncaught exception and
 * failed request. Any of those is a bug, so each journey ends with `expectClean()`.
 *
 * The browser: `LILO_CHROMIUM` if set, else the newest `chrome-headless-shell` Playwright has cached
 * (`npx playwright-core install chromium-headless-shell` puts one there), else Playwright's own pick.
 */

const EDITOR = join(import.meta.dirname, "..");
export const REPO = join(EDITOR, "..");
export const SHOTS = process.env.LILO_SHOTS ?? join(EDITOR, "e2e", ".shots");

export const fixture = (name: string): Buffer => readFileSync(join(REPO, "engine", "test", "fixtures", name));
export const fontFixture = (name: string): Buffer => readFileSync(join(REPO, "engine", "test", "fixtures", "fonts", name));

function findChromium(): string | undefined {
  if (process.env.LILO_CHROMIUM) return process.env.LILO_CHROMIUM;
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH ?? join(process.env.HOME ?? "", "Library", "Caches", "ms-playwright");
  const alt = join(process.env.HOME ?? "", ".cache", "ms-playwright");
  for (const root of [cache, alt]) {
    if (!existsSync(root)) continue;
    const dirs = readdirSync(root)
      .filter((d) => d.startsWith("chromium_headless_shell"))
      .sort()
      .reverse();
    for (const d of dirs) {
      for (const sub of readdirSync(join(root, d))) {
        const exe = join(root, d, sub, process.platform === "win32" ? "chrome-headless-shell.exe" : "chrome-headless-shell");
        if (existsSync(exe)) return exe;
      }
    }
  }
  return undefined;
}

let server: ViteDevServer | null = null;
let browser: Browser | null = null;
export let baseUrl = "";

export async function startStack(): Promise<void> {
  if (server) return;
  server = await createServer({ root: EDITOR, configFile: join(EDITOR, "vite.config.ts"), server: { port: 0, strictPort: false, host: "127.0.0.1" }, clearScreen: false, logLevel: "error" });
  await server.listen();
  const addr = server.httpServer?.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 5173}`;
  browser = await chromium.launch({
    executablePath: findChromium(),
    // software GL so Pixi's WebGL canvas draws in a headless box
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--enable-precise-memory-info"],
  });
}

export async function stopStack(): Promise<void> {
  await browser?.close();
  await server?.close();
  browser = null;
  server = null;
}

export interface Journey {
  page: Page;
  context: BrowserContext;
  /** Console errors, page errors and failed requests seen so far. */
  problems: string[];
  /** Save a screenshot as `<journey>-<step>.png` in the shots folder. */
  shot(step: string): Promise<void>;
  /** Fail if anything was logged as an error. */
  expectClean(): void;
  /** Run a journey body; if it throws, keep a screenshot (`<journey>-FAILED.png`) and the console problems. */
  run(body: () => Promise<void>): Promise<void>;
  close(): Promise<void>;
}

/** A new page on `/?mock` (sample projects, My Threads, canned OCR), recording everything that goes wrong. */
export async function openApp(name: string, opts: { viewport?: { width: number; height: number }; query?: string; setup?: (context: BrowserContext) => Promise<void> } = {}): Promise<Journey> {
  if (!browser) await startStack();
  mkdirSync(SHOTS, { recursive: true });
  const context = await browser!.newContext({ viewport: opts.viewport ?? { width: 1440, height: 900 }, acceptDownloads: true });
  await opts.setup?.(context);
  const page = await context.newPage();
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`request failed: ${r.url()} (${r.failure()?.errorText})`));
  page.on("response", (r) => {
    if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`);
  });
  await page.goto(`${baseUrl}/?mock${opts.query ?? ""}`);
  await page.getByRole("button", { name: "New design" }).waitFor();
  return {
    page,
    context,
    problems,
    async shot(step) {
      await page.screenshot({ path: join(SHOTS, `${name}-${step}.png`) });
    },
    expectClean() {
      if (problems.length) throw new Error(`Journey "${name}" logged ${problems.length} problem(s):\n${problems.join("\n")}`);
    },
    async run(body) {
      try {
        await body();
      } catch (e) {
        await page.screenshot({ path: join(SHOTS, `${name}-FAILED.png`) }).catch(() => undefined);
        if (problems.length) console.error(`[${name}] problems before the failure:\n${problems.join("\n")}`);
        throw e;
      } finally {
        await context.close();
      }
    },
    close: () => context.close(),
  };
}

/** Make the next "open a file" dialog pick this file (the mock platform's `pickFiles`). */
export async function pickFile(page: Page, name: string, bytes: Uint8Array): Promise<void> {
  await page.evaluate(([n, b]) => void (window.__lilo!.state.pickFiles = [{ name: n as string, bytes: new Uint8Array(b as number[]) }]), [name, [...bytes]] as const);
}

/** Projects the mock platform holds (path -> `.lilo` bytes): what Save wrote, and the sample projects. */
export async function projectFiles(page: Page): Promise<Map<string, Uint8Array>> {
  const list = await page.evaluate(() => [...window.__lilo!.state.files.entries()].map(([p, b]) => [p, [...b]] as [string, number[]]));
  return new Map(list.map(([p, b]) => [p, new Uint8Array(b)]));
}

/** Every file the app has "saved" so far (downloads and Save As in the mock platform). */
export async function savedFiles(page: Page): Promise<{ name: string; bytes: number[] }[]> {
  return page.evaluate(() => window.__lilo!.state.saved.map((s) => ({ name: s.name, bytes: [...s.bytes] })));
}
