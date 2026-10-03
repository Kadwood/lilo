/**
 * A small JSON delta, used to keep the version history cheap: a snapshot is stored as what changed
 * since the one before it (a typical edit touches one object of hundreds), with a full copy every few
 * entries so rebuilding one never walks far.
 *
 * `diff(a, b)` returns `undefined` when the two are equal, else a `Delta`. `applyDelta(a, d)` gives `b`
 * back. Neither mutates its inputs; unchanged parts of `a` are shared with the result, not copied.
 *
 *   { s: value }                  replace the whole value
 *   { o: {key: Delta}, x?: [key] } object: change these keys, drop those
 *   { e: {index: Delta} }         array of the same length: change these elements
 *   { i?: [id], c: {id: Delta} }  array of objects that all have a unique string `id`: the new order (left out
 *                                 when it is unchanged), and what changed (a new id carries `{ s: element }`)
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

export type Delta =
  | { s: Json }
  | { o: Record<string, Delta>; x?: string[] }
  | { e: Record<string, Delta> }
  | { i?: string[]; c: Record<string, Delta> };

const isObj = (v: unknown): v is { [key: string]: Json } => typeof v === "object" && v !== null && !Array.isArray(v);

/** The ids of an array of objects, when every element has a distinct string `id`; else null. */
function idsOf(a: readonly Json[]): string[] | null {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const el of a) {
    if (!isObj(el) || typeof el.id !== "string" || seen.has(el.id)) return null;
    seen.add(el.id);
    ids.push(el.id);
  }
  return ids;
}

export function diff(a: Json, b: Json): Delta | undefined {
  if (a === b) return undefined;
  if (isObj(a) && isObj(b)) {
    if (Object.hasOwn(a, "__proto__") || Object.hasOwn(b, "__proto__")) return { s: b };
    const o: Record<string, Delta> = {};
    let changed = false;
    for (const k of Object.keys(b)) {
      if (!(k in a)) {
        o[k] = { s: b[k] };
        changed = true;
        continue;
      }
      const d = diff(a[k], b[k]);
      if (d) {
        o[k] = d;
        changed = true;
      }
    }
    const x = Object.keys(a).filter((k) => !(k in b));
    if (!changed && x.length === 0) return undefined;
    return x.length ? { o, x } : { o };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const ia = idsOf(a);
    const ib = ia ? idsOf(b) : null;
    if (ia && ib) {
      const at = new Map(ia.map((id, n) => [id, a[n]]));
      const c: Record<string, Delta> = {};
      const reordered = ia.length !== ib.length || ia.some((id, n) => id !== ib[n]);
      let changed = reordered;
      ib.forEach((id, n) => {
        const was = at.get(id);
        if (was === undefined) {
          c[id] = { s: b[n] };
          changed = true;
          return;
        }
        const d = diff(was, b[n]);
        if (d) {
          c[id] = d;
          changed = true;
        }
      });
      return changed ? (reordered ? { i: ib, c } : { c }) : undefined;
    }
    if (a.length === b.length) {
      const e: Record<string, Delta> = {};
      let changed = false;
      for (let n = 0; n < a.length; n++) {
        const d = diff(a[n], b[n]);
        if (d) {
          e[n] = d;
          changed = true;
        }
      }
      return changed ? { e } : undefined;
    }
  }
  return { s: b };
}

const bad = (): never => {
  throw new Error("The history delta is malformed.");
};
const safeKey = (k: string): string => (k === "__proto__" ? bad() : k);

export function applyDelta(a: Json | undefined, d: Delta): Json {
  if (!isObj(d)) return bad();
  if ("s" in d) return d.s as Json;
  if ("o" in d) {
    if (!isObj(a) || !isObj(d.o)) return bad();
    const out: { [key: string]: Json } = { ...a };
    for (const [k, sub] of Object.entries(d.o)) out[safeKey(k)] = applyDelta(a[k], sub);
    if (d.x !== undefined) {
      if (!Array.isArray(d.x)) return bad();
      for (const k of d.x) delete out[safeKey(String(k))];
    }
    return out;
  }
  if ("e" in d) {
    if (!Array.isArray(a) || !isObj(d.e)) return bad();
    const out = a.slice();
    for (const [n, sub] of Object.entries(d.e)) {
      const idx = Number(n);
      if (!Number.isInteger(idx) || idx < 0 || idx >= out.length) return bad();
      out[idx] = applyDelta(a[idx], sub);
    }
    return out;
  }
  if ("c" in d) {
    if (!Array.isArray(a) || (d.i !== undefined && !Array.isArray(d.i)) || !isObj(d.c)) return bad();
    const at = new Map<string, Json>();
    const order: string[] = [];
    for (const el of a) if (isObj(el) && typeof el.id === "string") (at.set(el.id, el), order.push(el.id));
    const out: Json[] = (d.i ?? order).map((id) => {
      if (typeof id !== "string") return bad();
      const sub = Object.hasOwn(d.c, id) ? d.c[id] : undefined;
      if (sub) return applyDelta(at.get(id), sub);
      const kept = at.get(id);
      return kept === undefined ? bad() : kept;
    });
    return out;
  }
  return bad();
}
