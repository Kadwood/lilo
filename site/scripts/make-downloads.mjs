// Writes site/public/downloads.json from the latest GitHub release (asset names carry the version, e.g.
// Lilo_0.2.0_universal.dmg, so they cannot be hard-coded). With no release yet, or no network, it writes
// an empty list and the site links to the releases page instead. Run by `pnpm --dir site build`.
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = "Kadwood/lilo";
const RELEASES = `https://github.com/${REPO}/releases`;
const here = dirname(fileURLToPath(import.meta.url));
export const DOWNLOADS_FILE = join(here, "../public/downloads.json");

export async function makeDownloads({ quiet = false } = {}) {
  const out = { version: null, tag: null, publishedAt: null, releasesUrl: `${RELEASES}/latest`, assets: {} };
  if (process.env.SKIP_DOWNLOADS === "1") return finish(out, "skipped (SKIP_DOWNLOADS=1)", quiet);
  try {
    const headers = { accept: "application/vnd.github+json", "user-agent": "lilo-site-build" };
    if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers, signal: AbortSignal.timeout(10000) });
    if (res.status === 404) return finish(out, "no published release yet", quiet);
    if (!res.ok) return finish(out, `GitHub answered ${res.status}`, quiet);
    const rel = await res.json();
    out.tag = rel.tag_name;
    out.version = String(rel.tag_name).replace(/^v/, "");
    out.publishedAt = rel.published_at;
    const url = (name) => `${RELEASES}/latest/download/${encodeURIComponent(name)}`;
    for (const a of rel.assets ?? []) {
      const n = a.name;
      const entry = { name: n, url: url(n), size: a.size };
      if (/\.dmg$/i.test(n)) out.assets.mac = entry;
      else if (/-setup\.exe$/i.test(n)) out.assets.windows = entry;
      else if (/\.AppImage$/i.test(n)) out.assets.linuxAppImage = entry;
      else if (/\.deb$/i.test(n)) out.assets.linuxDeb = entry;
      else if (n === "SHA256SUMS") out.assets.checksums = entry;
    }
    return finish(out, `latest is ${rel.tag_name}`, quiet);
  } catch (e) {
    return finish(out, `could not reach GitHub (${e.message})`, quiet);
  }
}

function finish(out, why, quiet) {
  mkdirSync(dirname(DOWNLOADS_FILE), { recursive: true });
  const text = JSON.stringify(out, null, 2) + "\n";
  // only touch the file when it changed, so the dev server's file watcher does not loop
  if (!existsSync(DOWNLOADS_FILE) || readFileSync(DOWNLOADS_FILE, "utf8") !== text) writeFileSync(DOWNLOADS_FILE, text);
  if (!quiet) console.log(`downloads.json: ${why}; assets: ${Object.keys(out.assets).join(", ") || "none"}`);
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await makeDownloads();
