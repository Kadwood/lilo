// Lilo site client: OS-aware download button, language suggestion, drop zone + stitch demo.
// No framework. Everything degrades: without JS the page is complete and the links still work.

interface Lang {
  code: string;
  tag: string;
  name: string;
  url: string;
  banner?: { text: string; switch: string; dismiss: string; dismissAria: string };
  dir?: string;
}
interface Data {
  lang: string;
  langs: Lang[];
  hero: Record<string, string>;
  download: Record<string, string>;
  releasesUrl: string;
  assets: Record<string, string>;
  version: string | null;
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;
const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
const dataEl = $("lilo-data");
const data: Data | null = dataEl ? (JSON.parse(dataEl.textContent || "{}") as Data) : null;

const store = {
  get: (): string | null => {
    try {
      return localStorage.getItem("lilo-lang");
    } catch {
      return null;
    }
  },
  set: (v: string) => {
    try {
      localStorage.setItem("lilo-lang", v);
    } catch {
      /* private mode: fine, we just ask again next time */
    }
  },
};

// web fonts load without blocking the first paint
const gf = $<HTMLLinkElement>("gfonts");
if (gf) gf.media = "all";

/* ---------------------------------------------------------------- download button */
type OS = "mac" | "windows" | "linux" | "mobile" | null;
function detectOS(): OS {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string; mobile?: boolean } };
  const ua = navigator.userAgent || "";
  if (nav.userAgentData?.mobile || /Android|iPhone|iPad|iPod/i.test(ua)) return "mobile";
  const plat = (nav.userAgentData?.platform || navigator.platform || "").toLowerCase();
  if (/mac/.test(plat) || /Macintosh/.test(ua)) return navigator.maxTouchPoints > 1 ? "mobile" : "mac"; // iPadOS pretends to be a Mac
  if (/win/.test(plat) || /Windows/.test(ua)) return "windows";
  if (/linux|x11|cros/.test(plat) || /Linux|X11/.test(ua)) return "linux";
  return null;
}

function setupDownload() {
  if (!data) return;
  const btn = $<HTMLAnchorElement>("dl-main");
  const label = $("dl-label");
  const note = $("dl-note");
  if (!btn || !label || !note) return;
  const d = data.download;
  const os = detectOS();
  const names: Record<string, string> = { mac: d.mac, windows: d.windows, linux: d.linux };
  if (os === "mobile") {
    note.textContent = d.mobile;
    return;
  }
  if (!os) return;
  label.textContent = fill(d.button, { os: names[os] });
  const key = os === "linux" ? "linuxAppImage" : os;
  btn.href = data.assets[key] || data.releasesUrl;
  // the hero's main button does the same job as the one in the download section
  const heroBtn = $<HTMLAnchorElement>("hero-dl");
  const heroLabel = $("hero-dl-label");
  if (heroBtn && heroLabel) {
    heroBtn.href = btn.href;
    heroLabel.textContent = label.textContent;
  }
  note.textContent = d[`${os}Note`];
  document.querySelector(`.os-row[data-os="${os}"]`)?.classList.add("is-yours");
}

/* ---------------------------------------------------------------- language */
function setupLanguage() {
  if (!data) return;
  const menu = $<HTMLDetailsElement>("lang-menu");
  document.querySelectorAll<HTMLAnchorElement>("#lang-menu a[data-lang]").forEach((a) =>
    a.addEventListener("click", () => store.set(a.dataset.lang || "en")),
  );
  document.addEventListener("click", (e) => {
    document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((m) => {
      if (!m.contains(e.target as Node)) m.open = false;
    });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    document.querySelectorAll<HTMLDetailsElement>("details.menu[open]").forEach((m) => {
      m.open = false;
      m.querySelector("summary")?.focus();
    });
  });
  document.querySelectorAll(".menu-links a").forEach((a) => a.addEventListener("click", () => ((a.closest("details") as HTMLDetailsElement).open = false)));
  void menu;

  const saved = store.get();
  if (saved) return; // they already chose once: never nag
  const prefs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]).filter(Boolean);
  let want: string | null = null;
  for (const p of prefs) {
    const base = p.toLowerCase().split("-")[0];
    const hit = data.langs.find((l) => l.code === base || l.tag.toLowerCase() === p.toLowerCase() || l.tag.toLowerCase().split("-")[0] === base);
    if (hit) {
      want = hit.code;
      break;
    }
  }
  if (!want || want === data.lang) return;
  const target = data.langs.find((l) => l.code === want);
  const banner = $("lang-banner");
  if (!target || !target.banner || !banner) return;
  const b = target.banner;
  banner.setAttribute("lang", target.tag);
  banner.setAttribute("dir", target.dir || "ltr");
  banner.setAttribute("aria-label", target.name);
  banner.innerHTML = "";
  const wrap = document.createElement("div");
  wrap.className = "wrap";
  const text = document.createElement("span");
  text.textContent = fill(b.text, { language: target.name });
  const go = document.createElement("a");
  go.className = "btn btn-dark";
  go.href = target.url;
  go.textContent = fill(b.switch, { language: target.name });
  go.addEventListener("click", () => store.set(target.code));
  const no = document.createElement("button");
  no.type = "button";
  no.className = "mini";
  no.textContent = b.dismiss;
  no.setAttribute("aria-label", b.dismissAria);
  no.addEventListener("click", () => {
    store.set(data.lang); // stay on this language and remember it
    banner.hidden = true;
  });
  wrap.append(text, go, no);
  banner.append(wrap);
  banner.hidden = false;
}

/* ---------------------------------------------------------------- hero showcase */
// A real Lilo result, replayed: the picture, its outline, then the thread sewing in needle order.
// final.webp is the realistic render of the finished stitches; while "sewing" we reveal it through a
// mask that is painted segment by segment in the engine's own stitch order (see scripts/make-demo-data.mjs).
interface Demo {
  unit: number;
  width: number;
  height: number;
  view: { x0: number; y0: number; pxPerMm: number };
  pts: number[];
}
function setupDemo() {
  const canvas = $<HTMLCanvasElement>("demo");
  const box = $("showcase");
  if (!canvas || !box || !data) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const stagesEl = $("stages");
  const toggle = $<HTMLButtonElement>("demo-toggle");
  const h = data.hero;
  const v = canvas.dataset.v ?? "";
  const W = canvas.width;
  const H = canvas.height;

  const imgs: Record<string, HTMLImageElement> = {};
  let segs: { x0: number; y0: number; x1: number; y1: number }[] = [];
  let mask: HTMLCanvasElement | null = null;
  let tmp: HTMLCanvasElement | null = null;
  let maskDrawn = 0;
  let thick = 4;
  let loaded = false;
  let playing = false;
  let t0 = 0;
  let pausedAt = 0;
  let raf = 0;
  let visible = true;
  const D = { look: 1400, trace: 2200, sew: 6800, hold: 2600 };
  const TOTAL = D.look + D.trace + D.sew + D.hold;

  const layer = () => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    return c;
  };
  const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

  function prepare(d: Demo) {
    const { x0, y0, pxPerMm } = d.view;
    const k = (W / d.width) * pxPerMm;
    thick = Math.max(3, 0.85 * k); // wide enough to cover the thread, narrow enough not to reveal bare cloth around it
    segs = [];
    for (let i = 3; i < d.pts.length; i += 3) {
      // only between two real needle penetrations in a row
      if (d.pts[i + 2] === 0 && d.pts[i - 1] === 0) {
        segs.push({
          x0: (d.pts[i - 3] * d.unit - x0) * k,
          y0: (d.pts[i - 2] * d.unit - y0) * k,
          x1: (d.pts[i] * d.unit - x0) * k,
          y1: (d.pts[i + 1] * d.unit - y0) * k,
        });
      }
    }
    mask = layer();
    tmp = layer();
  }

  function paintMask(upto: number) {
    const g = mask!.getContext("2d")!;
    g.strokeStyle = "#000";
    g.lineWidth = thick;
    g.lineCap = "round";
    g.beginPath();
    for (let i = maskDrawn; i < upto; i++) {
      g.moveTo(segs[i].x0, segs[i].y0);
      g.lineTo(segs[i].x1, segs[i].y1);
    }
    g.stroke();
    maskDrawn = upto;
  }

  function sewn(upto: number) {
    if (upto > maskDrawn) paintMask(upto);
    const g = tmp!.getContext("2d")!;
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, W, H);
    g.drawImage(imgs.final, 0, 0, W, H);
    g.globalCompositeOperation = "destination-in";
    g.drawImage(mask!, 0, 0);
    ctx!.drawImage(tmp!, 0, 0);
  }

  function stage(n: number) {
    stagesEl?.querySelectorAll("li").forEach((li, i) => li.classList.toggle("on", i === n));
  }

  function frame(t: number) {
    ctx!.globalAlpha = 1;
    ctx!.drawImage(imgs.fabric, 0, 0, W, H);
    if (t < D.look) {
      stage(0);
      ctx!.globalAlpha = Math.min(1, t / 500);
      ctx!.drawImage(imgs.source, 0, 0, W, H);
      ctx!.globalAlpha = 1;
      maskDrawn = 0;
      mask!.getContext("2d")!.clearRect(0, 0, W, H);
    } else if (t < D.look + D.trace) {
      stage(1);
      const p = ease((t - D.look) / D.trace);
      ctx!.globalAlpha = 1 - 0.7 * p;
      ctx!.drawImage(imgs.source, 0, 0, W, H);
      ctx!.globalAlpha = 1;
      const x = p * W;
      ctx!.save();
      ctx!.beginPath();
      ctx!.rect(0, 0, x, H);
      ctx!.clip();
      ctx!.drawImage(imgs.trace, 0, 0, W, H);
      ctx!.restore();
      const grad = ctx!.createLinearGradient(x - 60, 0, x, 0);
      grad.addColorStop(0, "rgba(217,48,90,0)");
      grad.addColorStop(1, "rgba(217,48,90,0.35)");
      ctx!.fillStyle = grad;
      ctx!.fillRect(x - 60, 0, 60, H);
    } else {
      stage(2);
      const p = Math.min(1, (t - D.look - D.trace) / D.sew);
      ctx!.globalAlpha = 0.1;
      ctx!.drawImage(imgs.source, 0, 0, W, H);
      ctx!.globalAlpha = 1;
      sewn(Math.floor(segs.length * ease(p)));
    }
  }

  function final() {
    ctx!.drawImage(imgs.fabric, 0, 0, W, H);
    sewn(segs.length);
    stage(2);
  }

  function tick(now: number) {
    if (!playing) return;
    if (!visible) {
      t0 += 16; // hold the clock while the card is off screen
      raf = requestAnimationFrame(tick);
      return;
    }
    let t = now - t0;
    if (t >= TOTAL) {
      t0 = now;
      t = 0;
    }
    frame(t);
    raf = requestAnimationFrame(tick);
  }

  function setPlaying(on: boolean) {
    playing = on;
    if (toggle) {
      toggle.textContent = on ? h.pause : h.play;
      toggle.setAttribute("aria-pressed", String(!on));
    }
    cancelAnimationFrame(raf);
    if (on) {
      t0 = performance.now() - pausedAt;
      raf = requestAnimationFrame(tick);
    } else {
      pausedAt = performance.now() - t0;
    }
  }

  const loadImg = (name: string) =>
    new Promise<void>((res, rej) => {
      const i = new Image();
      i.onload = () => {
        imgs[name] = i;
        res();
      };
      i.onerror = rej;
      i.src = `/demo/${name}.webp?v=${v}`;
    });

  async function load() {
    const [d] = await Promise.all([fetch(`/demo/demo.json?v=${v}`).then((r) => r.json() as Promise<Demo>), ...["fabric", "final", "source", "trace"].map(loadImg)]);
    prepare(d);
    loaded = true;
    if (reduce) {
      final(); // reduced motion: just the finished piece, no loop
      if (toggle) toggle.hidden = true;
    } else {
      pausedAt = 0;
      setPlaying(true);
    }
  }

  toggle?.addEventListener("click", () => {
    if (loaded) setPlaying(!playing);
  });

  // lazy: nothing is fetched (~190 KB) until the card is near the screen
  // on any failure the canvas stays clear and its CSS background shows the finished piece
  const start = () => void load().catch(() => { if (toggle) toggle.hidden = true; });
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          visible = e.isIntersecting;
          if (e.isIntersecting && !loaded) {
            io.disconnect();
            new IntersectionObserver((x) => (visible = x[0].isIntersecting)).observe(canvas);
            start();
          }
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(canvas);
  } else start();
}

/* ---------------------------------------------------------------- manual search */
// Every guide card is already on the page with its words in data-search, so searching is just filtering.
function setupManualSearch() {
  const input = $<HTMLInputElement>("m-q");
  const list = $("m-list");
  if (!input || !list) return;
  const none = $("m-none");
  const status = $("m-status");
  $("m-form")?.addEventListener("submit", (e) => e.preventDefault());
  const cards = Array.from(list.querySelectorAll<HTMLElement>(".m-card"));
  const sections = Array.from(list.querySelectorAll<HTMLElement>("[data-section]"));
  function run() {
    const words = input!.value.toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const c of cards) {
      const hay = c.dataset.search || "";
      const hit = words.every((w) => hay.includes(w));
      c.hidden = !hit;
      if (hit) shown++;
    }
    for (const s of sections) s.hidden = !s.querySelector(".m-card:not([hidden])");
    if (none) none.hidden = shown > 0;
    if (status) status.textContent = words.length ? `${shown} ${shown === 1 ? "guide" : "guides"} found` : "";
  }
  input.addEventListener("input", run);
  const q = new URLSearchParams(location.search).get("q");
  if (q) {
    input.value = q;
    run();
  }
}

setupDownload();
setupLanguage();
setupDemo();
setupManualSearch();
