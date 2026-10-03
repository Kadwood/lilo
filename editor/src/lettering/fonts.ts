import type { CustomFont, FontIndexEntry, LetteringWarning, LiloFont, PathGuide, TextAlign } from "@lilo/engine/lettering";
import type { DesignObject, Pt } from "@lilo/engine/light";

/**
 * Where fonts come from in the editor.
 *
 * - Built-in fonts live in `data/fonts/<id>/` (see scripts/import-fonts.mjs). Only `index.json` is
 *   loaded up front (when the Text panel opens); each `font.json` is a separate asset fetched when a
 *   font is first used, so none of the 100+ fonts are in the main bundle.
 * - Uploaded fonts (TTF/OTF/TTC) are kept in memory and mirrored to IndexedDB so they survive a
 *   reload. (Project files will take them over as assets later.)
 * - The engine's lettering code (opentype.js, skeleton WASM) is imported lazily on first layout.
 */

export type FontRef = { kind: "builtin"; id: string } | { kind: "custom"; key: string };

export interface CustomFontInfo {
  key: string;
  name: string;
  /** Number of faces in the file (TTC). */
  faces: number;
  faceIndex: number;
}

export interface LayoutRequest {
  text: string;
  font: FontRef;
  heightMm: number;
  letterSpacingMm: number;
  lineSpacing: number;
  align: TextAlign;
  threadId: string;
  idPrefix: string;
  onPath?: PathGuide;
  /** The design's quality and thread weight: custom-font columns and the small-letter warning follow them. */
  sewing?: { quality: "standard" | "premium"; threadWeight: 40 | 60 };
}

export interface LayoutResponse {
  objects: DesignObject[];
  warnings: LetteringWarning[];
  /** Centre of the text's bounding box, so callers can drop it where they like. */
  centre: Pt;
}

export interface LetteringServices {
  loadIndex(): Promise<FontIndexEntry[]>;
  previewUrl(id: string): string | undefined;
  listCustom(): Promise<CustomFontInfo[]>;
  addCustom(file: { name: string; bytes: ArrayBuffer }, faceIndex?: number): Promise<CustomFontInfo>;
  removeCustom(key: string): Promise<void>;
  layout(req: LayoutRequest): Promise<LayoutResponse>;
}

// ---------------------------------------------------------------------------------------------
// Built-in fonts (lazy assets)
// ---------------------------------------------------------------------------------------------

const fontAssets = import.meta.glob("../../../data/fonts/*/font.json", { query: "?url", import: "default" }) as Record<string, () => Promise<string>>;
// index.json is generated too (git-ignored); a glob keeps typecheck working before `pnpm fonts` has run.
const indexAsset = import.meta.glob("../../../data/fonts/index.json", { query: "?url", import: "default" }) as Record<string, () => Promise<string>>;
const previews = import.meta.glob("../../../data/fonts/*/preview.png", { query: "?url", import: "default", eager: true }) as Record<string, string>;

const idOfPath = (p: string): string => p.split("/").slice(-2, -1)[0];
const assetById = new Map(Object.entries(fontAssets).map(([p, load]) => [idOfPath(p), load]));
const previewById = new Map(Object.entries(previews).map(([p, url]) => [idOfPath(p), url]));

const engine = () => import("@lilo/engine/lettering");

const builtinCache = new Map<string, Promise<LiloFont>>();
function loadBuiltin(id: string): Promise<LiloFont> {
  let p = builtinCache.get(id);
  if (!p) {
    const load = assetById.get(id);
    if (!load) return Promise.reject(new Error(`Unknown font "${id}"`));
    p = (async () => {
      const [url, { parseFont }] = await Promise.all([load(), engine()]);
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Could not load font "${id}" (${res.status})`);
      return parseFont(await res.json());
    })();
    p.catch(() => builtinCache.delete(id));
    builtinCache.set(id, p);
  }
  return p;
}

// ---------------------------------------------------------------------------------------------
// Uploaded fonts (memory + IndexedDB)
// ---------------------------------------------------------------------------------------------

interface StoredFont {
  key: string;
  name: string;
  faces: number;
  faceIndex: number;
  bytes: ArrayBuffer;
}

const memory = new Map<string, StoredFont>();
const parsed = new Map<string, CustomFont>();
const DB = "lilo-fonts";
const STORE = "fonts";

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "key" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

async function dbPut(f: StoredFont): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(f);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
async function dbDelete(key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}
async function dbAll(): Promise<StoredFont[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as StoredFont[]);
    req.onerror = () => resolve([]);
  });
}

let hydrated = false;
async function hydrate(): Promise<void> {
  if (hydrated) return;
  hydrated = true;
  for (const f of await dbAll()) if (!memory.has(f.key)) memory.set(f.key, f);
}

const info = (f: StoredFont): CustomFontInfo => ({ key: f.key, name: f.name, faces: f.faces, faceIndex: f.faceIndex });

async function customFont(key: string): Promise<CustomFont> {
  await hydrate();
  let cf = parsed.get(key);
  if (!cf) {
    const f = memory.get(key);
    if (!f) throw new Error("That uploaded font is no longer available. Upload it again.");
    const { loadCustomFont, initLettering } = await engine();
    await initLettering();
    cf = loadCustomFont(f.bytes, { faceIndex: f.faceIndex, name: f.name });
    parsed.set(key, cf);
  }
  return cf;
}

// ---------------------------------------------------------------------------------------------
// Fonts inside a project file
// ---------------------------------------------------------------------------------------------

/** An uploaded font as it travels in a `.lilo`: `id` is the key text blocks refer to (`custom:<id>`). */
export interface EmbeddedFont {
  id: string;
  name: string;
  ext: string;
  bytes: Uint8Array;
}

/** The uploaded fonts behind these keys, ready to embed in a project. Keys with no font are skipped. */
export async function collectCustomFonts(keys: readonly string[]): Promise<EmbeddedFont[]> {
  await hydrate();
  const out: EmbeddedFont[] = [];
  for (const key of new Set(keys)) {
    const f = memory.get(key);
    if (f) out.push({ id: key, name: f.name, ext: /\.([A-Za-z0-9]+)(#\d+)?$/.exec(key)?.[1] ?? "ttf", bytes: new Uint8Array(f.bytes) });
  }
  return out;
}

/** Make fonts that came out of a project file usable here. A font the user already has under the same key is kept. */
export async function restoreCustomFonts(fonts: readonly { id: string; name: string; bytes: Uint8Array }[]): Promise<void> {
  if (fonts.length === 0) return;
  await hydrate();
  const { listFaces, initLettering } = await engine();
  await initLettering();
  for (const f of fonts) {
    if (memory.has(f.id)) continue;
    const buf = f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength) as ArrayBuffer;
    let faces = 1;
    try {
      faces = listFaces(buf).length || 1;
    } catch {
      // the layout will say so when someone uses it
    }
    const faceIndex = Number(f.id.split("#").pop()) || 0;
    const stored: StoredFont = { key: f.id, name: f.name, faces, faceIndex, bytes: buf };
    memory.set(f.id, stored);
    parsed.delete(f.id);
    await dbPut(stored);
  }
}

// ---------------------------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------------------------

export const defaultServices: LetteringServices = {
  async loadIndex() {
    const load = Object.values(indexAsset)[0];
    if (!load) throw new Error("The built-in fonts have not been generated. Run `pnpm fonts`.");
    const res = await fetch(await load());
    if (!res.ok) throw new Error(`Could not load the font list (${res.status})`);
    return ((await res.json()) as { fonts: FontIndexEntry[] }).fonts;
  },
  previewUrl: (id) => previewById.get(id),
  async listCustom() {
    await hydrate();
    return [...memory.values()].map(info);
  },
  async addCustom(file, faceIndex = 0) {
    const { listFaces, loadCustomFont, initLettering } = await engine();
    await initLettering();
    const faces = listFaces(file.bytes);
    // Validate by parsing (throws a readable message for non-fonts).
    const cf = loadCustomFont(file.bytes, { faceIndex });
    const key = `${file.name}#${faceIndex}`;
    const stored: StoredFont = { key, name: faces.length > 1 ? (faces[faceIndex]?.name ?? cf.name) : cf.name, faces: faces.length, faceIndex, bytes: file.bytes };
    memory.set(key, stored);
    parsed.delete(key);
    await dbPut(stored);
    return info(stored);
  },
  async removeCustom(key) {
    memory.delete(key);
    parsed.delete(key);
    await dbDelete(key);
  },
  async layout(req) {
    const { layoutText, builtinTypeface, customTypeface, initLettering } = await engine();
    await initLettering();
    const face = req.font.kind === "builtin" ? builtinTypeface(await loadBuiltin(req.font.id)) : customTypeface(await customFont(req.font.key));
    const r = layoutText(req.text, face, {
      heightMm: req.heightMm,
      letterSpacingMm: req.letterSpacingMm,
      lineSpacing: req.lineSpacing,
      align: req.align,
      threadId: req.threadId,
      idPrefix: req.idPrefix,
      onPath: req.onPath,
      sewing: req.sewing,
    });
    return { objects: r.objects, warnings: r.warnings, centre: r.bounds ? [(r.bounds.minX + r.bounds.maxX) / 2, (r.bounds.minY + r.bounds.maxY) / 2] : [0, 0] };
  },
};
