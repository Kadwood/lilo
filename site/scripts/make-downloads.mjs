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
    // The release workflow adds stable-named copies of the installers (see docs/RELEASING.md). Buttons
    // prefer them (the link never goes stale); a release that predates them falls back to the versioned name.
    const STABLE = { mac: "Lilo-mac.dmg", windows: "Lilo-windows-setup.exe", linuxAppImage: "Lilo-linux.AppImage", linuxDeb: "Lilo-linux.deb" };
    const keyOf = (n) =>
      /\.dmg$/i.test(n) ? "mac" : /-setup\.exe$/i.test(n) ? "windows" : /\.AppImage$/i.test(n) ? "linuxAppImage" : /\.deb$/i.test(n) ? "linuxDeb" : null;
    const versioned = {};
    const stable = {};
    for (const a of rel.assets ?? []) {
      const k = keyOf(a.name);
      if (k) (a.name === STABLE[k] ? stable : versioned)[k] = a;
      else if (a.name === "SHA256SUMS") out.assets.checksums = { name: a.name, url: url(a.name), size: a.size };
    }
    for (const k of Object.keys(STABLE)) {
      const a = stable[k] ?? versioned[k];
      if (!a) continue;
      // size and version come from the versioned file when there is one (the copies are identical)
      out.assets[k] = { name: a.name, url: url(a.name), size: (versioned[k] ?? a).size, stable: Boolean(stable[k]), versionedName: versioned[k]?.name ?? null };
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
