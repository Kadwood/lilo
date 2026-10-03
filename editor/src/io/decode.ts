import type { ImageDataLike } from "@lilo/engine";

/** The longest side (px) we hand to the engine; matches the engine's own downscale target. */
export const MAX_IMAGE_SIDE = 1200;

export type ImportKind = "raster" | "svg";

export interface DecodedRaster {
  kind: "raster";
  image: ImageDataLike;
  /** The (downscaled) pixels as a canvas, for the reference layer. */
  reference: HTMLCanvasElement;
}
export interface DecodedSvg {
  kind: "svg";
  text: string;
  reference: HTMLImageElement | null;
}
export type DecodedImport = DecodedRaster | DecodedSvg;

export const IMPORT_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "svg"];

/** Decide what a file is from its name or MIME type; null if we can't import it. */
export function classifyFile(name: string, type?: string): ImportKind | null {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "svg" || type === "image/svg+xml") return "svg";
  if (["png", "jpg", "jpeg", "webp", "gif", "bmp"].includes(ext)) return "raster";
  if (type && /^image\/(png|jpeg|webp|gif|bmp)$/.test(type)) return "raster";
  return null;
}

const mimeFor = (name: string, fallback = "image/png"): string => {
  const ext = name.toLowerCase().split(".").pop();
  return ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : ext === "png" ? "image/png" : fallback;
};

function loadImage(url: string, timeoutMs = 4000): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = setTimeout(() => reject(new Error("Timed out decoding the image.")), timeoutMs);
    img.onload = () => {
      clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      clearTimeout(timer);
      reject(new Error("The browser could not decode this image."));
    };
    img.src = url;
  });
}

/** Decode a raster to pixels, shrunk so the longest side is at most MAX_IMAGE_SIDE. */
async function decodeRaster(bytes: Uint8Array, mime: string): Promise<DecodedRaster> {
  const blob = new Blob([bytes as BlobPart], { type: mime });
  let source: CanvasImageSource;
  let w: number;
  let h: number;
  if (typeof createImageBitmap === "function") {
    const bmp = await createImageBitmap(blob);
    source = bmp;
    w = bmp.width;
    h = bmp.height;
  } else {
    const url = URL.createObjectURL(blob);
    try {
      const img = await loadImage(url);
      source = img;
      w = img.naturalWidth;
      h = img.naturalHeight;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const f = Math.min(1, MAX_IMAGE_SIDE / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * f));
  const ch = Math.max(1, Math.round(h * f));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not read image pixels (no 2D canvas).");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, cw, ch);
  const px = ctx.getImageData(0, 0, cw, ch);
  return { kind: "raster", image: { width: cw, height: ch, data: px.data }, reference: canvas };
}

export async function decodeFile(file: { name: string; bytes: Uint8Array; type?: string }): Promise<DecodedImport> {
  const kind = classifyFile(file.name, file.type);
  if (!kind) throw new Error(`Can't open "${file.name}". Lilo imports PNG, JPG, WEBP and SVG.`);
  if (kind === "svg") {
    const text = new TextDecoder().decode(file.bytes);
    let reference: HTMLImageElement | null = null;
    try {
      const url = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
      try {
        reference = await loadImage(url);
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch {
      reference = null; // the reference layer is optional
    }
    return { kind: "svg", text, reference };
  }
  return decodeRaster(file.bytes, file.type || mimeFor(file.name));
}
