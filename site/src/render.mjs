// Static page renderer: (locale strings + build data) -> HTML. No framework; plain template strings.
import { icon, GITHUB_SVG } from "./icons.mjs";

export const SITE = "https://lilo.kadwood.com";
export const REPO = "https://github.com/Kadwood/lilo";

const esc = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fill = (s, vars) => String(s).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));

const FONTS = {
  latin:
    "family=Inter:wght@400;500;600&family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;1,6..72,400",
  zh: "family=Inter:wght@400;500;600&family=Noto+Sans+SC:wght@400;500;700&family=Noto+Serif+SC:wght@500;600",
  ar: "family=Noto+Naskh+Arabic:wght@500;600;700&family=Noto+Sans+Arabic:wght@400;500;600",
};
const fontsHref = (code) =>
  `https://fonts.googleapis.com/css2?${code === "zh" ? FONTS.zh : code === "ar" ? FONTS.ar : FONTS.latin}&display=swap`;

export const urlFor = (loc, path = "") => `/${[loc.meta.path, path].filter(Boolean).join("/")}${loc.meta.path || path ? "/" : ""}`;
const absUrl = (loc, path) => SITE + urlFor(loc, path);

function head(loc, locales, { title, description, path, jsonLd }) {
  const m = loc.meta;
  const alts = locales
    .map((l) => `<link rel="alternate" hreflang="${l.meta.lang}" href="${absUrl(l, path)}">`)
    .join("\n    ");
  const en = locales.find((l) => l.meta.path === "");
  return `<meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">
    <meta name="color-scheme" content="light dark">
    <meta name="theme-color" content="#fafaf8" media="(prefers-color-scheme: light)">
    <meta name="theme-color" content="#0e0c0c" media="(prefers-color-scheme: dark)">
    <link rel="canonical" href="${absUrl(loc, path)}">
    ${alts}
    <link rel="alternate" hreflang="x-default" href="${absUrl(en, path)}">
    <meta property="og:type" content="website">
    <meta property="og:site_name" content="Lilo by Kadwood">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:url" content="${absUrl(loc, path)}">
    <meta property="og:image" content="${SITE}/img/og.jpg">
    <meta property="og:locale" content="${m.ogLocale}">
    <meta name="twitter:card" content="summary_large_image">
    <link rel="icon" type="image/svg+xml" href="/brand/lilo-mark.svg">
    <link rel="apple-touch-icon" href="/img/apple-touch-icon.png">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="/assets/site.css">
    <link rel="stylesheet" href="${fontsHref(m.path)}" media="print" id="gfonts">
    <noscript><link rel="stylesheet" href="${fontsHref(m.path)}"></noscript>${jsonLd ? `\n    <script type="application/ld+json">${jsonLd}</script>` : ""}`;
}

function header(loc, locales, path) {
  const n = loc.nav;
  const links = [
    ["#features", n.features],
    ["#works", n.works],
    ["#how", n.how],
    ["#faq", n.faq],
  ]
    .map(([h, t]) => `<a href="${path ? urlFor(loc) : ""}${h}">${esc(t)}</a>`)
    .join("");
  const langs = locales
    .map(
      (l) =>
        `<li><a href="${urlFor(l, path)}" hreflang="${l.meta.lang}" lang="${l.meta.lang}" data-lang="${l.meta.path || "en"}"${l === loc ? ' aria-current="true"' : ""}>${esc(l.meta.name)}</a></li>`,
    )
    .join("");
  return `<header class="site-header">
      <div class="wrap bar">
        <a class="lockup" href="${urlFor(loc)}">
          <img class="lockup-mark" src="/brand/lilo-mark.svg" width="34" height="34" alt="">
          <span class="lockup-name">Lilo</span>
          <span class="lockup-by">${esc(loc.footer.by)}</span>
          <span class="wordmark" role="img" aria-label="Kadwood"></span>
        </a>
        <nav class="nav" aria-label="${esc(n.primary)}">${links}</nav>
        <div class="bar-end">
          <details class="menu lang" id="lang-menu">
            <summary aria-label="${esc(n.language)}">${icon("globe", { size: 20 })}<span class="lang-cur" lang="${loc.meta.lang}">${esc(loc.meta.name)}</span>${icon("chevron", { size: 16, cls: "caret" })}</summary>
            <ul class="menu-list">${langs}</ul>
          </details>
          <a class="btn btn-dark btn-sm bar-dl" href="${path ? urlFor(loc) : ""}#download">${esc(n.download)}</a>
          <details class="menu burger">
            <summary aria-label="${esc(n.menu)}">${icon("menu", { size: 22 })}</summary>
            <div class="menu-list menu-links">${links}</div>
          </details>
        </div>
      </div>
    </header>`;
}

function footer(loc, locales, path) {
  const f = loc.footer;
  return `<footer class="site-footer">
      <div class="wrap">
        <div class="foot-top">
          <div class="foot-brand">
            <a class="lockup" href="${urlFor(loc)}">
              <img class="lockup-mark" src="/brand/lilo-mark.svg" width="34" height="34" alt="">
              <span class="lockup-name">Lilo</span>
              <span class="lockup-by">${esc(f.by)}</span>
              <span class="wordmark" role="img" aria-label="Kadwood"></span>
            </a>
            <p class="foot-tag">${esc(f.tagline)}</p>
          </div>
          <ul class="foot-links">
            <li><a href="${REPO}">${GITHUB_SVG}<span>${esc(f.github)}</span></a></li>
            <li><a href="${REPO}/blob/main/LICENSE">${esc(f.licence)}</a></li>
            <li><a href="${REPO}/releases">${esc(f.releases)}</a></li>
            <li><a href="${REPO}/blob/main/CHANGELOG.md">${esc(f.changelog)}</a></li>
            <li><a href="${urlFor(loc, "compatibility")}">${esc(f.compat)}</a></li>
            <li><a href="https://kadwood.com" rel="noopener" aria-label="${esc(f.kadwoodAria)}">${esc(f.kadwood)}</a></li>
          </ul>
        </div>
        <p class="foot-legal">${esc(f.trademark)}</p>
        <p class="foot-legal">${esc(f.rights)}</p>
      </div>
    </footer>`;
}

function picture(card, alt, i) {
  const set = (mode) => [640, 1024, 1920].map((w) => `/img/${card.img}-${mode}-${w}.webp ${w}w`).join(", ");
  const sizes = "(min-width: 1200px) 1100px, calc(100vw - 32px)";
  return `<picture>
            <source media="(prefers-color-scheme: dark)" srcset="${set("dark")}" sizes="${sizes}" type="image/webp">
            <img src="/img/${card.img}-light-1024.webp" srcset="${set("light")}" sizes="${sizes}" width="1920" height="1200" alt="${esc(alt)}" ${i === 0 ? 'fetchpriority="high"' : 'loading="lazy" decoding="async"'}>
          </picture>`;
}

function featureCards(loc, build, path) {
  const vars = build.vars;
  const targets = {
    digitize: "#download",
    letters: "#download",
    send: urlFor(loc, "compatibility"),
    threads: "#download",
    pixel: "#download",
    free: REPO,
  };
  return loc.features.cards
    .map((c, i) => {
      const items = c.items
        .map(
          (it) => `<li class="feat">
              <span class="feat-ico">${icon(it.icon, { size: 20 })}</span>
              <span class="feat-title">${esc(fill(it.title, vars))}</span>
              <span class="feat-text">${esc(fill(it.text, vars))}</span>
            </li>`,
        )
        .join("");
      return `<article class="card-block" id="f-${c.id}" aria-labelledby="t-${c.id}">
          <div class="card">
            ${picture(c, c.alt, i)}
            <a class="pill pill-dark card-cta" href="${targets[c.id]}"><span>${esc(c.cta)}</span><span class="pill-arrow">${icon("arrow", { size: 16 })}</span></a>
            <div class="card-text">
              <h3 id="t-${c.id}">${esc(c.title)}</h3>
              <p>${esc(c.sub)}</p>
            </div>
          </div>
          <ul class="feats">${items}</ul>
        </article>`;
    })
    .join("\n");
}

function downloads(loc, build) {
  const d = loc.download;
  const dl = build.downloads;
  const a = dl.assets;
  const href = (k) => (a[k] ? a[k].url : dl.releasesUrl);
  const row = (key, label, note, files) => `<li class="os-row" data-os="${key}">
          <div class="os-info"><strong>${esc(label)}</strong><span>${esc(note)}</span></div>
          <div class="os-files">${files
            .map(([k, t]) => `<a class="pill pill-soft" href="${href(k)}" rel="noopener">${icon("download", { size: 16 })}<span>${esc(t)}</span></a>`)
            .join("")}</div>
        </li>`;
  return `<section class="section" id="download" aria-labelledby="h-download">
        <div class="wrap narrow center">
          <h2 id="h-download" class="h2">${esc(d.title)}</h2>
          <p class="lede">${esc(d.sub)}</p>
          <div class="dl-main">
            <a class="btn btn-dark btn-lg" id="dl-main" href="${dl.releasesUrl}" rel="noopener">${icon("download", { size: 20 })}<span id="dl-label">${esc(fill(d.button, { os: "" }).trim() || d.title)}</span></a>
            <p class="dl-version" id="dl-version">${esc(dl.version ? fill(d.version, { version: dl.version }) : d.versionNone)}</p>
            <p class="dl-note" id="dl-note" aria-live="polite"></p>
          </div>
          <div class="others">
            <h3 class="h4">${esc(d.other)}</h3>
            <p class="muted small">${esc(d.otherHint)}</p>
            <ul class="os-list">
              ${row("mac", d.mac, d.macNote, [["mac", d.macFile]])}
              ${row("windows", d.windows, d.windowsNote, [["windows", d.windowsFile]])}
              ${row("linux", d.linux, d.linuxNote, [["linuxAppImage", d.linuxAppImage], ["linuxDeb", d.linuxDeb]])}
            </ul>
            <p class="small"><a class="link" href="${dl.releasesUrl}" rel="noopener">${esc(d.all)}</a></p>
          </div>
        </div>
      </section>`;
}

function works(loc, build) {
  const w = loc.works;
  const c = build.compat.counts;
  const nf = build.nf;
  const stats = [
    [nf.format(c.formatsReadWrite + c.formatsWriteOnly), w.stats.formats],
    [nf.format(c.brands), w.stats.brands],
    [nf.format(c.machines), w.stats.machines],
    [nf.format(c.threadColours), w.stats.threads],
    [nf.format(c.hoops), w.stats.hoops],
  ]
    .map(([n, l]) => `<li><span class="stat-n">${esc(n)}</span><span class="stat-l">${esc(l)}</span></li>`)
    .join("");
  const brands = build.compat.brands.map((b) => `<li>${esc(b.name)}</li>`).join("");
  return `<section class="section" id="works" aria-labelledby="h-works">
        <div class="wrap narrow center">
          <h2 id="h-works" class="h2">${esc(w.title)}</h2>
          <p class="lede">${esc(w.sub)}</p>
          <ul class="stats">${stats}</ul>
          <p class="wifi-line">${icon("wifi", { size: 20 })}<span>${esc(w.wifi)}</span></p>
          <h3 class="visually-hidden">${esc(w.brandsLabel)}</h3>
          <ul class="brands">${brands}</ul>
          <a class="btn btn-soft" href="${urlFor(loc, "compatibility")}"><span>${esc(w.cta)}</span>${icon("arrow", { size: 18 })}</a>
        </div>
      </section>`;
}

function how(loc) {
  const h = loc.how;
  return `<section class="section" id="how" aria-labelledby="h-how">
        <div class="wrap">
          <h2 id="h-how" class="h2 center">${esc(h.title)}</h2>
          <ol class="steps">${h.steps
            .map(
              (s, i) => `<li class="step">
              <span class="step-n" aria-hidden="true">${i + 1}</span>
              <span class="step-ico">${icon(s.icon, { size: 26 })}</span>
              <h3>${esc(s.title)}</h3>
              <p>${esc(s.text)}</p>
            </li>`,
            )
            .join("")}</ol>
        </div>
      </section>`;
}

function faq(loc) {
  const f = loc.faq;
  return `<section class="section" id="faq" aria-labelledby="h-faq">
        <div class="wrap narrow">
          <h2 id="h-faq" class="h2 center">${esc(f.title)}</h2>
          <div class="faq">${f.items
            .map(
              (it) => `<details class="qa"><summary><span>${esc(it.q)}</span>${icon("plus", { size: 20, cls: "qa-ico" })}</summary><p>${esc(it.a)}</p></details>`,
            )
            .join("")}</div>
        </div>
      </section>`;
}

function clientData(loc, locales, build) {
  const data = {
    lang: loc.meta.path || "en",
    langs: locales.map((l) => ({
      code: l.meta.path || "en",
      tag: l.meta.lang,
      name: l.meta.name,
      url: urlFor(l, build.pagePath),
      dir: l.meta.dir,
      banner: l.langBanner,
    })),
    hero: loc.hero,
    download: loc.download,
    banner: loc.langBanner,
    releasesUrl: build.downloads.releasesUrl,
    assets: Object.fromEntries(Object.entries(build.downloads.assets).map(([k, v]) => [k, v.url])),
    version: build.downloads.version,
  };
  // "<" is escaped so the JSON can never close its own <script> tag
  return `<script type="application/json" id="lilo-data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

export function renderHome(loc, locales, build) {
  const h = loc.hero;
  const vars = build.vars;
  const jsonLd = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Lilo",
    applicationCategory: "DesignApplication",
    operatingSystem: "macOS, Windows, Linux",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    license: "https://www.gnu.org/licenses/gpl-3.0.html",
    description: loc.meta.description,
    url: absUrl(loc, ""),
    author: { "@type": "Organization", name: "Kadwood", url: "https://kadwood.com" },
  });
  build = { ...build, pagePath: "" };
  return `<!doctype html>
<html lang="${loc.meta.lang}" dir="${loc.meta.dir}">
  <head>
    ${head(loc, locales, { title: loc.meta.title, description: loc.meta.description, path: "", jsonLd })}
  </head>
  <body class="lang-${loc.meta.path || "en"}">
    <a class="skip" href="#main">${esc(loc.nav.skip || "Skip to content")}</a>
    <div id="lang-banner" class="lang-banner" role="region" hidden></div>
    ${header(loc, locales, "")}
    <main id="main">
      <section class="hero" aria-labelledby="h-hero">
        <div class="wrap center">
          <img class="hero-mark" src="/brand/lilo-mark.svg" width="64" height="64" alt="">
          <h1 id="h-hero" class="h1">${esc(h.title)}</h1>
          <p class="lede">${esc(h.sub)}</p>
          <div class="drop" id="drop">
            <div class="drop-stage">
              <canvas id="demo" width="560" height="560" role="img" aria-label="${esc(fill(h.demoCaption, { stitches: build.demo.stitches, colours: build.demo.colours }))}"></canvas>
              <img id="drop-img" class="drop-img" alt="${esc(h.droppedAlt)}" hidden>
            </div>
            <div class="drop-body">
              <div id="drop-idle">
                <label class="drop-pick" for="file">
                  <span class="drop-ico">${icon("upload", { size: 22 })}</span>
                  <span class="drop-title">${esc(h.dropTitle)}</span>
                  <span class="drop-hint">${esc(h.dropHint)}</span>
                </label>
                <input id="file" class="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" aria-label="${esc(h.dropAria)}">
                <ol class="stages" id="stages" aria-hidden="true"><li data-s="0">${esc(h.stageLook)}</li><li data-s="1">${esc(h.stageTrace)}</li><li data-s="2">${esc(h.stageSew)}</li></ol>
                <p class="demo-cap">${esc(fill(h.demoCaption, { stitches: build.nf.format(build.demo.stitches), colours: build.demo.colours }))}</p>
                <button class="mini" id="demo-toggle" type="button" aria-pressed="false">${esc(h.pause)}</button>
              </div>
              <div id="drop-done" hidden>
                <h2 class="drop-title">${esc(h.droppedTitle)}</h2>
                <p class="muted">${esc(h.droppedText)}</p>
                <a class="btn btn-dark" href="#download">${esc(h.droppedCta)}</a>
                <button class="mini" id="drop-reset" type="button">${esc(h.droppedOther)}</button>
              </div>
              <p class="drop-err" id="drop-err" role="alert" hidden>${esc(h.notImage)}</p>
            </div>
          </div>
          <p class="price">${esc(h.price)}</p>
          <div class="cta-row">
            <a class="btn btn-dark" href="#download">${esc(h.cta)}</a>
            <a class="btn btn-soft" href="#how">${esc(h.cta2)}</a>
          </div>
        </div>
      </section>

      <section class="section features" id="features" aria-labelledby="h-features">
        <div class="wrap">
          <h2 id="h-features" class="h2 center">${esc(loc.features.title)}</h2>
          ${featureCards(loc, build, "")}
        </div>
      </section>

      ${downloads(loc, build)}
      ${works(loc, build)}
      ${how(loc)}
      ${faq(loc)}

      <section class="section final" aria-labelledby="h-final">
        <div class="wrap narrow center">
          <h2 id="h-final" class="h2">${esc(loc.cta.title)}</h2>
          <p class="price">${esc(loc.cta.sub)}</p>
          <a class="btn btn-dark btn-lg" href="#download">${esc(h.cta)}</a>
        </div>
      </section>
    </main>
    ${footer(loc, locales, "")}
    ${clientData(loc, locales, build)}
    <script src="/assets/main.js" defer></script>
  </body>
</html>
`;
}

export function renderCompat(loc, locales, build) {
  const c = loc.compat;
  const data = build.compat;
  build = { ...build, pagePath: "compatibility" };
  const nf = build.nf;
  const fmt = (s) => String(s).toUpperCase();
  const date = data.compiled;
  const rows = data.formats
    .map(
      (f) => `<tr>
          <th scope="row">.${esc(f.ext)}</th>
          <td>${esc(f.name)}</td>
          <td>${f.colours ? esc(c.yes) : esc(c.no)}</td>
          <td>${f.lilo === "read+write" ? esc(c.rw) : esc(c.wo)}</td>
        </tr>`,
    )
    .join("");
  const brands = data.brands
    .map((b) => {
      const verified = b.models.filter((m) => m.verified).length;
      const models = b.models
        .map(
          (m) =>
            `<li><span>${esc(m.name)}</span><span class="muted">${esc((m.formats || []).map(fmt).join(", "))}</span></li>`,
        )
        .join("");
      return `<article class="brand" id="b-${esc(b.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}">
          <h3>${esc(b.name)}</h3>
          <p class="muted">${esc(b.summary)}</p>
          <dl>
            <dt>${esc(c.reads)}</dt><dd>${esc((b.acceptedFormats || []).map(fmt).join(", "))}</dd>
            <dt>${esc(c.getsDesign)}</dt><dd>${esc((b.transferMethods || []).join(" / "))}</dd>
          </dl>
          <details><summary>${esc(fill(c.machines, { n: nf.format(b.models.length) }))} (${esc(fill(c.checked, { n: nf.format(verified) }))})</summary><ul class="models">${models}</ul></details>
        </article>`;
    })
    .join("");
  return `<!doctype html>
<html lang="${loc.meta.lang}" dir="${loc.meta.dir}">
  <head>
    ${head(loc, locales, { title: c.metaTitle, description: c.metaDescription, path: "compatibility" })}
  </head>
  <body class="lang-${loc.meta.path || "en"}">
    <a class="skip" href="#main">${esc(loc.nav.skip || "Skip to content")}</a>
    <div id="lang-banner" class="lang-banner" role="region" hidden></div>
    ${header(loc, locales, "compatibility")}
    <main id="main" class="compat">
      <div class="wrap narrow">
        <p><a class="link back" href="${urlFor(loc)}">${icon("arrow", { size: 16, cls: "flip-back" })}<span>${esc(c.back)}</span></a></p>
        <h1 class="h1 h1-sm">${esc(c.title)}</h1>
        <p class="lede left">${esc(c.intro)}</p>
        <aside class="note"><strong>${esc(c.status)}.</strong> ${esc(c.statusText)} <span class="muted">${esc(fill(c.compiled, { date }))}</span></aside>
        <p class="wifi-line left">${icon("wifi", { size: 20 })}<span>${esc(loc.works.wifi)}</span></p>
        <p class="muted small">${esc(c.wifiLine)}</p>
        <h2 class="h2 h2-sm">${esc(c.formatsTitle)}</h2>
        <p class="muted">${esc(c.formatsText)}</p>
        <div class="table-wrap" tabindex="0" role="region" aria-label="${esc(c.formatsTitle)}">
          <table>
            <thead><tr><th scope="col">${esc(c.ext)}</th><th scope="col">${esc(c.name)}</th><th scope="col">${esc(c.colours)}</th><th scope="col"><span class="visually-hidden">Lilo</span></th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <h2 class="h2 h2-sm">${esc(c.brandsTitle)}</h2>
        <div class="brand-list">${brands}</div>
        <p class="muted small">${esc(c.disclaimer)}</p>
      </div>
    </main>
    ${footer(loc, locales, "compatibility")}
    ${clientData(loc, locales, build)}
    <script src="/assets/main.js" defer></script>
  </body>
</html>
`;
}
