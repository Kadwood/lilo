// Composes the big card images from editor screenshots: real ones in site/real-shots (already cropped, committed) or
// raw captures in site/raw-shots (from scripts/capture.mjs, gitignored).
// Each shot is cropped, rounded and floated on a soft studio gradient, in a light and a dark variant.
// Output: site/public/img/<name>-<light|dark>-<w>.webp  (+ og.jpg). Run: pnpm --dir site images
import sharp from "sharp";
import { mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const RAW = join(here, "../raw-shots");
const REAL = join(here, "../real-shots"); // real Lilo screenshots (committed); they win over a raw capture of the same name
const OUT = join(here, "../public/img");
mkdirSync(OUT, { recursive: true });

const W = 1920;
const H = 1200;
const WIDTHS = [640, 1024, 1920];

// crop = [left, top, width, height] in the 2880x1800 raw shot; fit = share of the card the shot may fill
const CARDS = {
  digitize: { src: "digitized", crop: [0, 0, 2880, 1800], fit: 0.86, tone: "rose" },
  letters: { src: "monogram", crop: [0, 0, 2880, 1800], fit: 0.86, tone: "sand" },
  send: { src: "send", crop: [990, 170, 910, 1470], fit: 0.8, tone: "rose" },
  hoops: { src: "hoop", crop: [550, 40, 1780, 1740], fit: 0.8, tone: "sand" },
  pixel: { src: "pixel", crop: [0, 0, 2880, 1800], fit: 0.86, tone: "rose" },
  home: { src: "home", crop: [0, 0, 2880, 1800], fit: 0.86, tone: "sand" },
};

const TONES = {
  light: {
    rose: ["#f6e6e6", "#efe7df", "#f3dfe5"],
    sand: ["#f1ebe2", "#f7efe9", "#eadfe0"],
  },
  dark: {
    rose: ["#1b1114", "#261519", "#3a1621"],
    sand: ["#151210", "#201a17", "#2a1a20"],
  },
};

function bg(mode, tone) {
  const [a, b, c] = TONES[mode][tone];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
      <radialGradient id="r" cx="0.85" cy="0.9" r="0.6"><stop offset="0" stop-color="${c}" stop-opacity="0.95"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient>
      <radialGradient id="r2" cx="0.1" cy="0.05" r="0.5"><stop offset="0" stop-color="${mode === "dark" ? "#D9305A" : "#ffffff"}" stop-opacity="${mode === "dark" ? 0.18 : 0.8}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    </defs>
    <rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#r)"/><rect width="100%" height="100%" fill="url(#r2)"/>
  </svg>`;
  return Buffer.from(svg);
}

async function compose(name, spec, mode) {
  const real = join(REAL, `${spec.src}.png`);
  const useReal = existsSync(real);
  const file = useReal ? real : join(RAW, `${spec.src}.png`);
  if (!existsSync(file)) {
    console.log("missing", file);
    return;
  }
  // a real screenshot is already cropped to what the card shows
  let [l, t, w, h] = spec.crop;
  if (useReal) {
    const meta = await sharp(file).metadata();
    [l, t, w, h] = [0, 0, meta.width, meta.height];
  }
  const scale = Math.min((W * 0.86) / w, (H * 0.7) / h); // the lower ~25% stays empty for the card title
  const tw = Math.round(w * scale);
  const th = Math.round(h * scale);
  const r = 28;
  const shot = await sharp(file)
    .extract({ left: l, top: t, width: w, height: h })
    .resize(tw, th)
    .composite([
      {
        input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${th}"><rect width="${tw}" height="${th}" rx="${r}" fill="#fff"/></svg>`),
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();
  const shadow = await sharp({
    create: { width: tw, height: th, channels: 4, background: { r: 0, g: 0, b: 0, alpha: mode === "dark" ? 0.7 : 0.28 } },
  })
    .composite([
      {
        input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${tw}" height="${th}"><rect width="${tw}" height="${th}" rx="${r}" fill="#fff"/></svg>`),
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();
  const blurred = await sharp(shadow).extend({ top: 80, bottom: 80, left: 80, right: 80, background: { r: 0, g: 0, b: 0, alpha: 0 } }).blur(36).toBuffer();
  const x = Math.round((W - tw) / 2);
  const y = Math.round(H * 0.07);
  // the bottom of every card fades into the card's own colour (--card-bg in styles.css), so the
  // title area, and on phones the text block under the picture, join the image without a seam
  const cardBg = mode === "dark" ? "#17110f" : "#f3ece4";
  const fade = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0.68" stop-color="${cardBg}" stop-opacity="0"/><stop offset="1" stop-color="${cardBg}" stop-opacity="1"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#f)"/></svg>`,
  );
  const base = await sharp(bg(mode, spec.tone))
    .composite([
      { input: blurred, left: x - 80, top: y - 80 + 34 },
      { input: shot, left: x, top: y },
      { input: fade, left: 0, top: 0 },
    ])
    .png()
    .toBuffer();
  for (const width of WIDTHS) {
    await sharp(base).resize(width).webp({ quality: 80, effort: 5 }).toFile(join(OUT, `${name}-${mode}-${width}.webp`));
  }
  if (name === "home" && mode === "light") {
    await sharp(base).resize(1200, 630, { fit: "cover" }).jpeg({ quality: 82 }).toFile(join(OUT, "og.jpg"));
  }
  console.log("ok", name, mode);
}

for (const [name, spec] of Object.entries(CARDS)) for (const mode of ["light", "dark"]) await compose(name, spec, mode);
