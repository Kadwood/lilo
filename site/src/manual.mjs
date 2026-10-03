// The manual: docs/guide/*.md (written with the app, English only) -> /manual/ and /manual/<id>/.
// Read at build time from the repo root; nothing is copied into site/. With no docs/guide yet the build
// emits a "coming soon" front page instead of failing.
import { readFileSync, readdirSync, existsSync, mkdirSync, cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { head, header, footer, clientData, REPO } from "./render.mjs";
import { icon } from "./icons.mjs";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
export const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/* ------------------------------------------------------------------ loading */
function frontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    const k = line.slice(0, i).trim();
    const raw = line.slice(i + 1).trim();
    try {
      meta[k] = /^["[\d]/.test(raw) ? JSON.parse(raw) : raw;
    } catch {
      meta[k] = raw.replace(/^"|"$/g, "");
    }
  }
  return { meta, body: text.slice(m[0].length) };
}

export function loadGuide(dir) {
  const empty = { dir, ids: new Set(), sections: [], pages: [] };
  if (!existsSync(dir)) return empty;
  let sections = [];
  const sj = join(dir, "sections.json");
  const ij = join(dir, "index.json");
  if (existsSync(sj)) sections = JSON.parse(readFileSync(sj, "utf8"));
  else if (existsSync(ij)) sections = JSON.parse(readFileSync(ij, "utf8")).sections ?? [];
  const pages = [];
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".md"))) {
    const { meta, body } = frontmatter(readFileSync(join(dir, f), "utf8"));
    if (!meta.id || !meta.title) continue;
    if (meta.status === "draft") continue; // "ready" and "generated" (reference tables) are published
    pages.push({ ...meta, file: f, markdown: body, keywords: meta.keywords ?? [] });
  }
  const so = new Map(sections.map((s) => [s.id, s.order ?? 99]));
  pages.sort((a, b) => (so.get(a.section) ?? 99) - (so.get(b.section) ?? 99) || (a.order ?? 99) - (b.order ?? 99) || a.title.localeCompare(b.title));
  sections = sections.filter((s) => pages.some((p) => p.section === s.id)).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));
  return { dir, ids: new Set(pages.map((p) => p.id)), sections, pages };
}

/* ------------------------------------------------------------------ markdown (small, safe: everything is escaped first) */
function imageHtml(alt, src, ctx, block) {
  const real = !/^https?:/.test(src) && /^(screenshots|diagrams)\//.test(src) && existsSync(join(ctx.guide.dir, src));
  if (real) {
    ctx.images.add(src);
    const img = `<img src="/manual/img/${esc(src)}" alt="${alt}" loading="lazy" decoding="async">`;
    return block ? `<figure class="shot">${img}<figcaption>${alt}</figcaption></figure>` : img;
  }
  // not captured yet: a labelled placeholder, never a broken image
  const box = `<span class="shot-box">${icon("image", { size: 22 })}<span>Screenshot coming soon</span></span>`;
  return block
    ? `<figure class="shot shot-missing">${box}<figcaption>${alt}</figcaption></figure>`
    : `<span class="shot-missing" role="img" aria-label="Screenshot coming soon: ${alt}">${box}</span>`;
}

function inline(src, ctx) {
  const hold = [];
  const keep = (h) => `\u0000${hold.push(h) - 1}\u0000`;
  let s = esc(src);
  s = s.replace(/`([^`]+)`/g, (_, c) => keep(`<code>${c}</code>`));
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => keep(imageHtml(alt, url, ctx, false)));
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, url) => {
    if (/^https?:\/\//.test(url)) return keep(`<a href="${url}" rel="noopener">${text}</a>`);
    if (url.startsWith("#")) return keep(`<a href="${url}">${text}</a>`);
    const m = /^([\w-]+)\.md(#[\w-]+)?$/.exec(url);
    if (m && ctx.guide.ids.has(m[1])) return keep(`<a href="/manual/${m[1]}/${m[2] ?? ""}">${text}</a>`);
    if (m) ctx.broken.add(m[1]);
    return text; // a link to a page that is not published: plain text
  });
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[\s(])\*(?!\s)(.+?)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => hold[+i]);
}

const isTableSep = (l) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
const listRe = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

export function markdown(src, ctx) {
  const lines = src.replace(/\r/g, "").split("\n");
  const out = [];
  const heads = [];
  const seen = new Map();
  let i = 0;
  let first = true;
  const blockStart = (l, n) => /^(#{1,4})\s/.test(l) || /^```/.test(l) || listRe.test(l) || /^>/.test(l) || /^---+$/.test(l) || (/^\|/.test(l) && n !== undefined && isTableSep(n));

  function list(base) {
    const m = listRe.exec(lines[i]);
    const ordered = /\d/.test(m[2]);
    const tag = ordered ? "ol" : "ul";
    let html = `<${tag}>`;
    while (i < lines.length) {
      const mm = listRe.exec(lines[i]);
      if (!mm || mm[1].length < base) break;
      if (mm[1].length > base) {
        // a deeper list belongs to the item above
        html = html.replace(/<\/li>$/, "") + list(mm[1].length) + "</li>";
        continue;
      }
      let text = mm[3];
      i++;
      // wrapped lines of the same item
      while (i < lines.length && lines[i].trim() && !listRe.test(lines[i]) && /^\s+\S/.test(lines[i])) text += " " + lines[i++].trim();
      html += `<li>${inline(text, ctx)}</li>`;
      while (i < lines.length && !lines[i].trim() && listRe.test(lines[i + 1] ?? "") && (listRe.exec(lines[i + 1])[1].length >= base)) i++;
    }
    return html + `</${tag}>`;
  }

  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) {
      i++;
      continue;
    }
    let m;
    if ((m = /^```(\w*)\s*$/.exec(l))) {
      const code = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`);
    } else if ((m = /^(#{1,4})\s+(.*?)\s*#*\s*$/.exec(l))) {
      i++;
      const level = m[1].length;
      if (level === 1 && first) {
        first = false; // the page template renders the title
        continue;
      }
      first = false;
      const text = m[2].replace(/[*`]/g, "");
      let id = slug(text) || "section";
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      if (n) id += `-${n + 1}`;
      const lv = Math.max(2, level);
      if (lv <= 3) heads.push({ level: lv, text, id });
      out.push(`<h${lv} id="${id}">${inline(m[2], ctx)}<a class="anchor" href="#${id}" aria-label="Link to this section">#</a></h${lv}>`);
    } else if (/^---+$/.test(l.trim())) {
      i++;
      out.push("<hr>");
    } else if (/^\|/.test(l) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(l);
      i += 2;
      let rows = "";
      while (i < lines.length && /^\|/.test(lines[i])) rows += `<tr>${cells(lines[i++]).map((c) => `<td>${inline(c, ctx)}</td>`).join("")}</tr>`;
      out.push(
        `<div class="table-wrap" tabindex="0" role="region" aria-label="Table ${(ctx.tables = (ctx.tables ?? 0) + 1)}: ${esc(head.join(", "))}"><table><thead><tr>${head.map((c) => `<th scope="col">${inline(c, ctx)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div>`,
      );
    } else if (listRe.test(l)) {
      out.push(list(listRe.exec(l)[1].length));
    } else if (/^>/.test(l)) {
      const q = [];
      while (i < lines.length && /^>/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote>${markdown(q.join("\n"), ctx).html}</blockquote>`);
    } else {
      const para = [];
      while (i < lines.length && lines[i].trim() && !blockStart(lines[i], lines[i + 1])) para.push(lines[i++].trim());
      const text = para.join(" ");
      const img = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(text);
      out.push(img ? imageHtml(esc(img[1]), img[2], ctx, true) : `<p>${inline(text, ctx)}</p>`);
      first = false;
    }
  }
  return { html: out.join("\n"), heads };
}

/* ------------------------------------------------------------------ pages */
const wrapPage = (loc, locales, build, { title, description, path, body, cls = "" }) => `<!doctype html>
<html lang="en" dir="ltr">
  <head>
    ${head(loc, locales, { title, description, path, alts: false })}
  </head>
  <body class="lang-en">
    <a class="skip" href="#main">${esc(loc.nav.skip)}</a>
    ${header(loc, locales, "", true)}
    <main id="main" class="manual ${cls}">
${body}
    </main>
    ${footer(loc, locales, "")}
    ${clientData(loc, locales, { ...build, pagePath: "" })}
    <script src="/assets/main.js" defer></script>
  </body>
</html>
`;

function sidebar(guide, current, heads) {
  return `<nav class="m-nav" aria-label="Manual contents">
          ${guide.sections
            .map((s) => {
              const pages = guide.pages.filter((p) => p.section === s.id);
              return `<div class="m-sec"><h2 class="m-sec-title">${esc(s.title)}</h2><ul>${pages
                .map((p) => {
                  const on = p.id === current;
                  const toc = on && heads.length ? `<ul class="m-toc">${heads.filter((h) => h.level === 2).map((h) => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join("")}</ul>` : "";
                  return `<li><a href="/manual/${p.id}/"${on ? ' aria-current="page"' : ""}>${esc(p.title)}</a>${toc}</li>`;
                })
                .join("")}</ul></div>`;
            })
            .join("\n          ")}
        </nav>`;
}

function indexPage(loc, locales, build, guide) {
  if (!guide.pages.length) {
    return wrapPage(loc, locales, build, {
      title: "Manual (coming soon) | Lilo",
      description: "The Lilo manual is on its way.",
      path: "manual",
      cls: "m-stub",
      body: `      <div class="wrap narrow center">
        <h1 class="h1 h1-sm">Manual</h1>
        <p class="lede">The manual is coming soon. It will show you, step by step, how to turn a picture into stitches, add lettering and send a design to your machine.</p>
        <p class="m-actions"><a class="btn btn-dark" href="/">Back to home</a><a class="btn btn-soft" href="${REPO}">View on GitHub</a></p>
      </div>`,
    });
  }
  const cards = guide.sections
    .map((s) => {
      const pages = guide.pages.filter((p) => p.section === s.id);
      return `<section class="m-section" data-section aria-labelledby="s-${s.id}">
          <h2 id="s-${s.id}" class="h2 h2-sm">${esc(s.title)}</h2>
          ${s.blurb ? `<p class="muted">${esc(s.blurb)}</p>` : ""}
          <ul class="m-cards">${pages
            .map(
              (p) => `<li class="m-card" data-search="${esc([p.title, p.summary, ...p.keywords, s.title].join(" ").toLowerCase())}"><a href="/manual/${p.id}/"><strong>${esc(p.title)}</strong><span>${esc(p.summary ?? "")}</span></a></li>`,
            )
            .join("")}</ul>
        </section>`;
    })
    .join("\n");
  return wrapPage(loc, locales, build, {
    title: "Manual | Lilo by Kadwood",
    description: "How to use Lilo, the free, open-source embroidery app: pictures to stitches, lettering, threads, hoops and sending designs to your machine.",
    path: "manual",
    body: `      <div class="wrap narrow">
        <h1 class="h1 h1-sm">Manual</h1>
        <p class="lede left">Short, plain guides for everyone, from your first design to fixing a gap in a fill.</p>
        <form class="m-search" role="search" id="m-form">
          <label for="m-q" class="visually-hidden">Search the manual</label>
          ${icon("search", { size: 20 })}
          <input id="m-q" type="search" placeholder="Search the manual" autocomplete="off" enterkeyhint="search">
        </form>
        <p id="m-status" class="visually-hidden" role="status" aria-live="polite"></p>
        <p id="m-none" class="muted" hidden>Nothing found. Try a simpler word, like "thread" or "letters".</p>
        <div id="m-list">
${cards}
        </div>
      </div>`,
  });
}

function articlePage(loc, locales, build, guide, p, idx) {
  const ctx = { guide, images: build.guideImages, broken: build.guideBroken };
  const { html, heads } = markdown(p.markdown, ctx);
  const prev = guide.pages[idx - 1];
  const next = guide.pages[idx + 1];
  const sec = guide.sections.find((s) => s.id === p.section);
  const pn = (x, dir) =>
    x ? `<a class="m-pn m-${dir}" href="/manual/${x.id}/" rel="${dir}"><span class="m-pn-l">${dir === "prev" ? "Previous" : "Next"}</span><strong>${esc(x.title)}</strong></a>` : "<span></span>";
  const here = heads.filter((h) => h.level === 2);
  return wrapPage(loc, locales, build, {
    title: `${p.title} | Lilo manual`,
    description: p.summary ?? `${p.title}: part of the Lilo manual.`,
    path: `manual/${p.id}`,
    body: `      <div class="wrap m-wrap">
        <details class="m-mobile"><summary>${icon("menu", { size: 18 })}<span>All guides</span></summary>${sidebar(guide, p.id, [])}</details>
        <aside class="m-side">${sidebar(guide, p.id, heads)}</aside>
        <article class="m-article">
          <p class="m-crumb"><a href="/manual/">Manual</a>${sec ? ` <span aria-hidden="true">/</span> ${esc(sec.title)}` : ""}</p>
          <h1 class="h1 h1-sm">${esc(p.title)}</h1>
          ${p.summary ? `<p class="lede left">${esc(p.summary)}</p>` : ""}
          ${here.length > 2 ? `<nav class="m-here" aria-label="On this page"><strong>On this page</strong><ul>${here.map((h) => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`).join("")}</ul></nav>` : ""}
          <div class="prose">
${html}
          </div>
          <nav class="m-pager" aria-label="Previous and next guide">${pn(prev, "prev")}${pn(next, "next")}</nav>
          <p class="m-edit muted small"><a class="link" href="${REPO}/blob/main/docs/guide/${esc(p.file)}" rel="noopener">Improve this page on GitHub</a></p>
        </article>
      </div>`,
  });
}

/** Renders every manual page. Returns [{ path, html }] and copies the images the guide uses into dist. */
export function renderManual(loc, locales, build, guide, dist) {
  build = { ...build, guideImages: new Set(), guideBroken: new Set() };
  const pages = [{ path: "manual", html: indexPage(loc, locales, build, guide) }];
  guide.pages.forEach((p, idx) => pages.push({ path: `manual/${p.id}`, html: articlePage(loc, locales, build, guide, p, idx) }));
  for (const rel of build.guideImages) {
    const to = join(dist, "manual", "img", rel);
    mkdirSync(join(to, ".."), { recursive: true });
    cpSync(join(guide.dir, rel), to);
  }
  if (build.guideBroken.size) console.warn(`manual: links to unpublished pages rendered as plain text: ${[...build.guideBroken].join(", ")}`);
  return pages;
}

export function writePages(pages, dist) {
  for (const { path, html } of pages) {
    mkdirSync(join(dist, path), { recursive: true });
    writeFileSync(join(dist, path, "index.html"), html);
  }
}
