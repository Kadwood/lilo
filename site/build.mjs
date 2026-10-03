// Static site build: locales + docs/compat.json + latest-release downloads -> site/dist.
//   node build.mjs          build once
//   node build.mjs --dev    build, serve on :4321 and rebuild on change
import { build as esbuild } from "esbuild";
import { readFileSync, writeFileSync, mkdirSync, rmSync, cpSync, readdirSync, existsSync, watch, createReadStream, statSync } from "node:fs";
import { createServer } from "node:http";
import { gzipSync } from "node:zlib";
import { dirname, join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { renderHome, renderCompat, urlFor, SITE } from "./src/render.mjs";
import { makeDownloads } from "./scripts/make-downloads.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const DIST = join(here, "dist");
const ORDER = ["en", "fr", "es", "zh", "ar"];
const dev = process.argv.includes("--dev");

const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

function keyPaths(o, prefix = "") {
  if (Array.isArray(o)) return o.flatMap((v, i) => keyPaths(v, `${prefix}[${i}]`));
  if (o && typeof o === "object") return Object.entries(o).flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k));
  return [prefix];
}

function loadLocales() {
  const locales = ORDER.map((c) => readJson(join(here, `src/i18n/${c}.json`)));
  const base = new Set(keyPaths(locales[0]));
  for (const l of locales.slice(1)) {
    const mine = new Set(keyPaths(l).filter((k) => k !== "_review"));
    const missing = [...base].filter((k) => !mine.has(k));
    const extra = [...mine].filter((k) => !base.has(k));
    if (missing.length || extra.length) throw new Error(`locale ${l.meta.path}: missing ${missing.join(", ") || "-"}; extra ${extra.join(", ") || "-"}`);
    // every {placeholder} used in English must survive translation
    const en = JSON.stringify(locales[0]);
    for (const ph of new Set(en.match(/\{\w+\}/g) ?? [])) {
      if (!JSON.stringify(l).includes(ph)) throw new Error(`locale ${l.meta.path}: placeholder ${ph} not used`);
    }
  }
  return locales;
}

async function buildOnce() {
  rmSync(DIST, { recursive: true, force: true });
  mkdirSync(join(DIST, "assets"), { recursive: true });

  const downloads = await makeDownloads({ quiet: false });
  cpSync(join(here, "public"), DIST, { recursive: true });

  // client bundle + css
  const out = await esbuild({
    entryPoints: { main: join(here, "src/client/main.ts"), site: join(here, "src/styles.css") },
    bundle: true,
    minify: true,
    format: "iife",
    target: ["es2020", "safari14"],
    outdir: join(DIST, "assets"),
    entryNames: "[name]-[hash]",
    loader: { ".svg": "dataurl" },
    external: ["/brand/*", "/img/*"],
    metafile: true,
    logLevel: "warning",
  });
  const names = Object.keys(out.metafile.outputs).map((p) => p.split("/").pop());
  const js = names.find((n) => n.startsWith("main-") && n.endsWith(".js"));
  const css = names.find((n) => n.startsWith("site-") && n.endsWith(".css"));

  const compat = readJson(join(here, "../docs/compat.json"));
  const demo = readJson(join(here, "public/demo/demo.json"));
  const demoInfo = { stitches: demo.stats.stitches, colours: new Set(demo.threads).size };

  const locales = loadLocales();
  const pages = [];
  for (const loc of locales) {
    const nf = new Intl.NumberFormat(loc.meta.lang === "ar" ? "ar-u-nu-latn" : loc.meta.lang);
    const c = compat.counts;
    const buildData = {
      downloads,
      nf,
      demo: demoInfo,
      compat: { ...compat, compiled: compat.compiled },
      vars: {
        threadColours: nf.format(c.threadColours),
        threadLines: nf.format(c.threadLines),
        hoops: nf.format(c.hoops),
        formats: nf.format(c.formatsReadWrite + c.formatsWriteOnly),
      },
    };
    for (const [path, render] of [["", renderHome], ["compatibility", renderCompat]]) {
      const html = render(loc, locales, buildData)
        .replaceAll("/assets/main.js", `/assets/${js}`)
        .replaceAll("/assets/site.css", `/assets/${css}`);
      const dir = join(DIST, ...[loc.meta.path, path].filter(Boolean));
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "index.html"), html);
      pages.push({ loc, path });
    }
  }

  // sitemap (every page lists all its language alternates)
  const alt = (path) =>
    locales.map((l) => `    <xhtml:link rel="alternate" hreflang="${l.meta.lang}" href="${SITE}${urlFor(l, path)}"/>`).join("\n") +
    `\n    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${urlFor(locales[0], path)}"/>`;
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(
    join(DIST, "sitemap.xml"),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
      pages.map(({ loc, path }) => `  <url>\n    <loc>${SITE}${urlFor(loc, path)}</loc>\n    <lastmod>${today}</lastmod>\n${alt(path)}\n  </url>`).join("\n") +
      `\n</urlset>\n`,
  );
  writeFileSync(join(DIST, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`);
  writeFileSync(
    join(DIST, "_headers"),
    `/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Content-Security-Policy: default-src 'self'; img-src 'self' data: blob:; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'none'; frame-ancestors 'none'
/assets/*
  Cache-Control: public, max-age=31536000, immutable
/img/*
  Cache-Control: public, max-age=31536000, immutable
/brand/*
  Cache-Control: public, max-age=604800
/demo/*
  Cache-Control: public, max-age=86400
/downloads.json
  Cache-Control: public, max-age=300
`,
  );
  await sharp(join(here, "../app/src-tauri/icons/icon.png")).resize(180, 180).png().toFile(join(DIST, "img/apple-touch-icon.png"));

  const size = (p) => statSync(join(DIST, "assets", p)).size;
  console.log(`built ${pages.length} pages in ${locales.length} languages -> site/dist  (js ${size(js)} B, css ${size(css)} B)`);
}

await buildOnce();

if (dev) {
  let timer;
  const rebuild = () => {
    clearTimeout(timer);
    timer = setTimeout(() => buildOnce().catch((e) => console.error(e.message)), 150);
  };
  for (const d of ["src", "public"]) watch(join(here, d), { recursive: true }, rebuild);
  const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".webp": "image/webp", ".png": "image/png", ".jpg": "image/jpeg" };
  createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
    if (p.endsWith("/")) p += "index.html";
    const f = join(DIST, p);
    if (!f.startsWith(DIST) || !existsSync(f) || statSync(f).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    const type = types[extname(f)] ?? "application/octet-stream";
    const headers = { "content-type": type };
    if (f.includes("/assets/") || f.includes("/img/")) headers["cache-control"] = "public, max-age=31536000, immutable"; // like _headers in production
    if (/^(text|application\/json|image\/svg)/.test(type) || type.includes("javascript")) {
      // production (Cloudflare Pages) compresses text; do the same here so local timings mean something
      res.writeHead(200, { ...headers, "content-encoding": "gzip", vary: "accept-encoding" });
      res.end(gzipSync(readFileSync(f)));
      return;
    }
    res.writeHead(200, headers);
    createReadStream(f).pipe(res);
  }).listen(4321, () => console.log("dev server: http://localhost:4321"));
}
