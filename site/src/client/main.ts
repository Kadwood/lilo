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

/* ---------------------------------------------------------------- demo + drop zone */
interface Demo {
  unit: number;
  threads: string[];
  pts: number[];
}
function setupDemo() {
  const canvas = $<HTMLCanvasElement>("demo");
  const drop = $("drop");
  if (!canvas || !drop || !data) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const stagesEl = $("stages");
  const toggle = $<HTMLButtonElement>("demo-toggle");
  const W = canvas.width;
  const H = canvas.height;
  const h = data.hero;

  let demo: Demo | null = null;
  let src: HTMLImageElement | null = null;
  let segs: { x0: number; y0: number; x1: number; y1: number; t: number }[] = [];
  let scale = 1;
  let ox = 0;
  let oy = 0;
  let ghost: HTMLCanvasElement | null = null;
  let sew: HTMLCanvasElement | null = null;
  let sewDrawn = 0;
  let playing = !reduce;
  let t0 = 0;
  let pausedAt = 0;
  let raf = 0;
  let visible = true;
  const FABRIC = "#f4eee4";
  const D = { look: 1500, trace: 2400, sew: 7200, hold: 2000 };
  const TOTAL = D.look + D.trace + D.sew + D.hold;

  const layer = () => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    return c;
  };

  function prepare(d: Demo) {
    const u = d.unit;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < d.pts.length; i += 4) {
      minX = Math.min(minX, d.pts[i]);
      maxX = Math.max(maxX, d.pts[i]);
      minY = Math.min(minY, d.pts[i + 1]);
      maxY = Math.max(maxY, d.pts[i + 1]);
    }
    const bw = (maxX - minX) * u;
    const bh = (maxY - minY) * u;
    scale = (Math.min(W, H) * 0.8) / Math.max(bw, bh);
    ox = W / 2 - ((minX + maxX) / 2) * u * scale;
    oy = H / 2 - ((minY + maxY) / 2) * u * scale;
    segs = [];
    for (let i = 4; i < d.pts.length; i += 4) {
      // a line is only stitched between two real needle penetrations in a row
      if (d.pts[i + 2] === 0 && d.pts[i - 2] === 0) {
        segs.push({
          x0: d.pts[i - 4] * u * scale + ox,
          y0: d.pts[i - 3] * u * scale + oy,
          x1: d.pts[i] * u * scale + ox,
          y1: d.pts[i + 1] * u * scale + oy,
          t: d.pts[i + 3],
        });
      }
    }
    ghost = layer();
    const g = ghost.getContext("2d")!;
    g.strokeStyle = "rgba(60,50,45,0.2)";
    g.lineWidth = 0.8;
    g.beginPath();
    for (const s of segs) {
      g.moveTo(s.x0, s.y0);
      g.lineTo(s.x1, s.y1);
    }
    g.stroke();
    sew = layer();
  }

  const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
  const hex = (i: number) => (demo ? demo.threads[i] || "#111" : "#111");

  function drawSegs(g: CanvasRenderingContext2D, from: number, to: number) {
    g.lineCap = "round";
    g.lineWidth = 1.7;
    let cur = -1;
    for (let i = from; i < to; i++) {
      const s = segs[i];
      if (s.t !== cur) {
        cur = s.t;
        g.strokeStyle = hex(cur);
      }
      g.beginPath();
      g.moveTo(s.x0, s.y0);
      g.lineTo(s.x1, s.y1);
      g.stroke();
    }
  }

  function drawImage(alpha: number) {
    if (!src || !demo) return;
    const size = (Math.max(W, H) * 0.8) / 0.703;
    ctx!.globalAlpha = alpha;
    ctx!.drawImage(src, W / 2 - size / 2, H / 2 - size / 2, size, size);
    ctx!.globalAlpha = 1;
  }

  function stage(n: number) {
    if (!stagesEl) return;
    stagesEl.querySelectorAll("li").forEach((li, i) => li.classList.toggle("on", i === n));
  }

  function frame(t: number) {
    if (!demo || !sew || !ghost) return;
    ctx!.fillStyle = FABRIC;
    ctx!.fillRect(0, 0, W, H);
    if (t < D.look) {
      stage(0);
      drawImage(Math.min(1, t / 600));
      sewDrawn = 0;
      sew.getContext("2d")!.clearRect(0, 0, W, H);
    } else if (t < D.look + D.trace) {
      stage(1);
      const p = (t - D.look) / D.trace;
      drawImage(1 - 0.65 * ease(p));
      const y = p * H;
      ctx!.save();
      ctx!.beginPath();
      ctx!.rect(0, 0, W, y);
      ctx!.clip();
      ctx!.drawImage(ghost, 0, 0);
      ctx!.restore();
      ctx!.fillStyle = "rgba(217,48,90,0.85)";
      ctx!.fillRect(0, y - 1.5, W, 3);
    } else {
      stage(2);
      const p = Math.min(1, (t - D.look - D.trace) / D.sew);
      const upto = Math.floor(segs.length * ease(p));
      drawImage(0.12);
      if (upto > sewDrawn) {
        drawSegs(sew.getContext("2d")!, sewDrawn, upto);
        sewDrawn = upto;
      }
      ctx!.drawImage(sew, 0, 0);
      if (p < 1 && upto > 0) {
        const s = segs[Math.min(upto, segs.length - 1)];
        ctx!.fillStyle = "#d9305a";
        ctx!.beginPath();
        ctx!.arc(s.x1, s.y1, 5, 0, Math.PI * 2);
        ctx!.fill();
      }
    }
  }

  function final() {
    if (!demo || !sew) return;
    sew.getContext("2d")!.clearRect(0, 0, W, H);
    sewDrawn = 0;
    ctx!.fillStyle = FABRIC;
    ctx!.fillRect(0, 0, W, H);
    drawImage(0.12);
    drawSegs(sew.getContext("2d")!, 0, segs.length);
    sewDrawn = segs.length;
    ctx!.drawImage(sew, 0, 0);
    stage(2);
  }

  function tick(now: number) {
    if (!playing) return;
    if (!visible) {
      raf = requestAnimationFrame(tick);
      t0 += 16; // keep the clock still while off screen
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

  async function load() {
    const [r, img] = await Promise.all([
      fetch("/demo/demo.json").then((x) => x.json() as Promise<Demo>),
      new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = "/demo/source.webp";
      }),
    ]);
    demo = r;
    src = img;
    prepare(r);
    if (reduce) {
      final();
      setPlaying(false);
    } else {
      pausedAt = 0;
      setPlaying(true);
    }
  }

  toggle?.addEventListener("click", () => {
    if (!demo) return;
    if (!playing && reduce) pausedAt = 0;
    setPlaying(!playing);
  });
  if (reduce && toggle) toggle.textContent = h.play;

  // lazy: only fetch the (130 KB) stitch data once the drop zone is near the screen
  const start = () => void load().catch(() => undefined);
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(
      (es) => {
        for (const e of es) {
          visible = e.isIntersecting;
          if (e.isIntersecting && !demo) {
            io.disconnect();
            const watch = new IntersectionObserver((x) => (visible = x[0].isIntersecting));
            watch.observe(canvas);
            start();
          }
        }
      },
      { rootMargin: "200px" },
    );
    io.observe(canvas);
  } else start();

  /* ---- drop zone: shows the picture; Lilo itself runs in the desktop app ---- */
  const input = $<HTMLInputElement>("file");
  const img = $<HTMLImageElement>("drop-img");
  const idle = $("drop-idle");
  const done = $("drop-done");
  const err = $("drop-err");
  const reset = $("drop-reset");
  let url: string | null = null;

  function accept(f: File | undefined) {
    if (!f || !img || !idle || !done || !err) return;
    if (!/^image\/(png|jpe?g|webp|svg\+xml)$/.test(f.type)) {
      err.hidden = false;
      return;
    }
    err.hidden = true;
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(f);
    img.src = url;
    img.hidden = false;
    canvas!.hidden = true;
    idle.hidden = true;
    done.hidden = false;
    if (playing) setPlaying(false);
  }
  input?.addEventListener("change", () => accept(input.files?.[0]));
  reset?.addEventListener("click", () => {
    if (!img || !idle || !done) return;
    img.hidden = true;
    img.removeAttribute("src");
    canvas!.hidden = false;
    idle.hidden = false;
    done.hidden = true;
    if (input) input.value = "";
    if (url) URL.revokeObjectURL(url);
    url = null;
    if (demo && !reduce) setPlaying(true);
  });
  let depth = 0;
  drop.addEventListener("dragenter", (e) => {
    e.preventDefault();
    depth++;
    drop.classList.add("is-over");
  });
  drop.addEventListener("dragover", (e) => e.preventDefault());
  drop.addEventListener("dragleave", () => {
    depth = Math.max(0, depth - 1);
    if (!depth) drop.classList.remove("is-over");
  });
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    drop.classList.remove("is-over");
    accept(e.dataTransfer?.files?.[0]);
  });
  // a picture dropped beside the box should not navigate the tab away
  window.addEventListener("dragover", (e) => e.preventDefault());
  window.addEventListener("drop", (e) => e.preventDefault());
}

setupDownload();
setupLanguage();
setupDemo();
