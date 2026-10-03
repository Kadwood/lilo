import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The browser the journeys drive: `LILO_CHROMIUM` if set, else the newest `chrome-headless-shell` Playwright has
 * cached (`pnpm --filter editor exec playwright-core install chromium-headless-shell` puts one there), else
 * undefined (Playwright then looks for its own).
 */
export function chromiumPath(): string | undefined {
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
