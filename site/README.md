# Lilo website (lilo.kadwood.com)

A small static site: no framework, a ~7 KB script, one CSS file. It is its own package (not part of
the app workspace), so installing and building it never touches the editor or the engine.

```sh
pnpm site:dev      # build + serve on http://localhost:4321, rebuilds when you edit
pnpm site:build    # one-off build into site/dist
```

(`site:*` run `pnpm --dir site install --ignore-workspace` first.)

## What is where

| Path | What |
| --- | --- |
| `build.mjs` | The build: renders every page in every language, bundles `src/client` + `src/styles.css` with esbuild, writes `sitemap.xml`, `robots.txt` and Cloudflare `_headers` into `dist/`. |
| `src/render.mjs` | Page templates (plain template strings). |
| `src/i18n/*.json` | One file per language: `en`, `fr`, `es`, `zh` (Simplified Chinese, served at `/zh/`), `ar` (RTL). The build fails if a language misses a key or drops a `{placeholder}`. Every non-English file carries `"_review": "needs native speaker review"` (never shown on the page). |
| `src/client/main.ts` | OS-aware download button, language suggestion banner, drop zone + stitch demo. |
| `src/styles.css` | All styling. Logical properties only (`inline-start`, `margin-inline`...), so Arabic mirrors itself. Light and dark follow `prefers-color-scheme`. |
| `public/` | Copied as-is into `dist/`: brand files, card images (`img/`), demo data (`demo/`). |
| `public/downloads.json` | Generated at build time (git-ignored), see below. |

Pages: `/`, `/compatibility/`, and the same under `/fr/`, `/es/`, `/zh/`, `/ar/`. Each has `hreflang`
alternates and a canonical URL. A visitor whose browser language differs gets a small, dismissible
suggestion (never a forced redirect); the choice is remembered in `localStorage`.

## Downloads

`scripts/make-downloads.mjs` asks the GitHub API for the latest release and writes
`public/downloads.json` (`Lilo_<version>_universal.dmg`, `_x64-setup.exe`, `_amd64.AppImage`, `_amd64.deb`,
`SHA256SUMS`). The page picks the visitor's OS in the browser (`navigator.userAgentData`, UA as a
fallback). Until a release is published (or if GitHub cannot be reached) every button links to
<https://github.com/Kadwood/lilo/releases/latest>. The deploy workflow also runs on `release: published`,
so the buttons switch to the new installers on their own.

## The compatibility page

Generated from `../docs/compat.json` (itself generated from `data/compat`). Run `pnpm compat` at the repo
root after changing that data, then rebuild. The counts on the home page come from the same file.

## Pictures and the demo

All imagery is real Lilo.

- `scripts/capture.mjs` drives the editor in `?mock` mode with Playwright (start `pnpm dev` and run
  `pnpm fonts` first) and writes raw screenshots to `raw-shots/` (git-ignored).
- `scripts/make-images.mjs` crops them, rounds the corners and floats them on a soft studio gradient, in
  a light and a dark variant, at 640 / 1024 / 1920 px (WebP). Cards use `<picture>` with
  `prefers-color-scheme`.
- The hero drop zone replays **real engine output**: `scripts/make-demo-data.mjs` runs Lilo's
  auto-digitize engine in Node on the hibiscus mark and stores the stitches as `public/demo/demo.json`
  (130 KB, about 30 KB gzipped). The browser only draws them. We do not run the engine in the browser:
  it bundles to about 2 MB gzipped (the straight-skeleton WASM), too heavy for a landing page. A picture a
  visitor drops is shown back to them with a "Download Lilo to sew it" button; nothing is uploaded.

## Checks

```sh
pnpm --dir site typecheck                      # client code
node scripts/a11y.mjs                          # axe-core on every page (needs `pnpm site:dev` running)
node scripts/shots.mjs <outdir> / /ar/ /zh/    # full-page screenshots, light/dark, desktop/mobile
```

Lighthouse (run against `pnpm site:dev`, which gzips and sets cache headers like production):
performance, accessibility, best practices and SEO are 100 on `/`, `/ar/` and `/compatibility/`.

## Deploying

`.github/workflows/site.yml` builds the site and publishes `site/dist` to the Cloudflare Pages project
**`lilo-site`** with `wrangler pages deploy`. It runs on pushes to `main` that touch `site/**` (or
`docs/compat.json`), on every published release, and by hand (Actions > Site > Run workflow).

One-time setup (done by a person, not by the workflow):

1. Cloudflare dashboard > Workers & Pages > Create > Pages > **Direct Upload**, project name `lilo-site`.
   (Leave the Git integration off; the workflow does the deploy.)
2. On that project, Custom domains > add `lilo.kadwood.com` (Cloudflare adds the DNS record).
3. In GitHub, repo `Kadwood/lilo` > Settings > Secrets and variables > Actions, add:
   - `CLOUDFLARE_API_TOKEN`: an API token with **Account > Cloudflare Pages > Edit**
   - `CLOUDFLARE_ACCOUNT_ID`: `0e89beda49bd49a0c880e515b71220b6`
4. Merge to `main` (or run the workflow by hand).

`dist/_headers` sets a strict Content-Security-Policy (only Google Fonts is allowed as an outside
origin), long caching for hashed assets and images, and a short cache for `downloads.json`.

The site sets no cookies and has no analytics. The only third party is Google Fonts (Inter, Newsreader,
Noto Sans/Serif SC, Noto Naskh/Sans Arabic).
