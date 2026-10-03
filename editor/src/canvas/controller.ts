import type { StoreApi } from "zustand/vanilla";
import {
  DEFAULT_RUN_PARAMS,
  deleteNode,
  distToPolyline,
  editRings,
  ellipseNodes,
  flattenNodes,
  hitObject,
  insertNodeNear,
  makeFill,
  makeRun,
  makeSatin,
  makeIdGen,
  objectBox,
  objectTouchesBox,
  patternInfo,
  rectNodes,
  smoothStroke,
  transformObject,
  withRingNodes,
  type Affine,
  type Box,
  type DesignObject,
  type PathNode,
  type Pt,
  type RunObject,
} from "@lilo/engine/light";
import { defaultThread, selectionBox, type EditorActions, type EditorState } from "../state/editorStore";
import { DRAWING_TOOLS } from "../tools/registry";
import { boxFromDrag, handlePoint, HANDLE_NAMES, moveTransform, resizeTransform, rotateHandlePoint, rotateTransform, snapAngle, type HandleName } from "./geometry";
import { screenToWorld, type View } from "./viewport";

/** A pointer event reduced to what the tools need. Coordinates are CSS px relative to the canvas. */
export interface PointerInput {
  x: number;
  y: number;
  button: number;
  shift: boolean;
  /** Ctrl: constrain / 15 degree snap / square / invert the aspect lock. */
  ctrl: boolean;
  alt: boolean;
  /** 1 for a single click, 2 for the second click of a double-click. */
  detail: number;
}

export interface KeyInput {
  key: string;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
}

export type Drag =
  | { kind: "pan"; last: [number, number] }
  | { kind: "marquee"; a: Pt; b: Pt; additive: boolean }
  | { kind: "move"; from: Pt; to: Pt; ids: string[]; hit: string; moved: boolean; shift: boolean; constrain: boolean }
  | { kind: "resize"; handle: HandleName; box: Box; to: Pt; lock: boolean }
  | { kind: "rotate"; centre: Pt; start: Pt; to: Pt; snap: boolean }
  | { kind: "node"; id: string; ring: number; index: number; nodes: PathNode[]; moved: boolean }
  | { kind: "marker"; id: string; which: "start" | "end" | "center"; at: Pt }
  | { kind: "shapeBox"; shape: "rect" | "circle"; a: Pt; b: Pt; square: boolean }
  | { kind: "pen"; pts: Pt[] }
  | { kind: "measure"; a: Pt; b: Pt }
  | { kind: "knife"; a: Pt; b: Pt }
  | { kind: "dial" }
  | { kind: "image"; id: string; from: Pt; orig: Pt };

export interface Draft {
  kind: "path" | "satin" | "manual";
  closed: boolean;
  nodes: PathNode[];
  /** What happens when the draft finishes. */
  purpose: "shape" | "hole" | "mapPath" | "guide";
}

/** What the overlay draws. A fresh object on every change so React can compare by identity. */
export interface OverlayModel {
  drag: Drag | null;
  draft: Draft | null;
  cursor: Pt | null;
  measure: { a: Pt; b: Pt } | null;
  nodeSel: { ring: number; index: number } | null;
  spaceDown: boolean;
}

const HANDLE_PX = 7;
const ROTATE_OFFSET_PX = 26;
const PICK_PX = 5;
const NODE_PX = 7;
const CLOSE_PX = 9;
const MIN_DRAG_MM = 0.4;

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export interface ControllerDeps {
  api: StoreApi<EditorState>;
  actions: EditorActions;
  getView(): View;
  setView(v: View): void;
  /** Double-click on empty canvas. */
  fit(): void;
}

/**
 * Turns pointer and key events into edits, per tool. It owns everything transient (a drag in
 * progress, a half-drawn shape, the cursor) so none of it touches React state or the undo history;
 * only a finished gesture commits to the store. The overlay re-renders from `model`.
 */
export class CanvasController {
  private drag: Drag | null = null;
  private draft: Draft | null = null;
  private cursor: Pt | null = null;
  private measureLine: { a: Pt; b: Pt } | null = null;
  private nodeSel: { ring: number; index: number } | null = null;
  private space = false;
  private listeners = new Set<() => void>();
  private snap: OverlayModel;

  constructor(private deps: ControllerDeps) {
    this.snap = this.build();
  }

  // ---- subscription ---------------------------------------------------------------------------
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getSnapshot = (): OverlayModel => this.snap;
  private build(): OverlayModel {
    return { drag: this.drag, draft: this.draft, cursor: this.cursor, measure: this.measureLine, nodeSel: this.nodeSel, spaceDown: this.space };
  }
  private changed() {
    this.snap = this.build();
    for (const l of this.listeners) l();
  }

  private get s(): EditorState {
    return this.deps.api.getState();
  }
  private get a(): EditorActions {
    return this.deps.actions;
  }
  private mm(i: { x: number; y: number }): Pt {
    return screenToWorld(this.deps.getView(), i.x, i.y);
  }
  private px(n: number): number {
    return n / this.deps.getView().zoom;
  }
  private selected(): DesignObject[] {
    const s = this.s;
    const set = new Set(s.selectedIds);
    return s.design?.objects.filter((o) => set.has(o.id)) ?? [];
  }

  setSpace(on: boolean) {
    if (this.space === on) return;
    this.space = on;
    this.changed();
  }

  /** The transform a move/resize/rotate drag would apply right now, for the ghost outline. */
  previewAffine(): Affine | null {
    const d = this.drag;
    if (!d) return null;
    if (d.kind === "move" && d.moved) return moveTransform(d.from, d.to, d.constrain);
    if (d.kind === "resize") return resizeTransform(d.box, d.handle, d.to, d.lock);
    if (d.kind === "rotate") return rotateTransform(d.centre, d.start, d.to, d.snap ? 15 : undefined).m;
    return null;
  }

  /** Handle under the pointer, if the select tool is showing handles. */
  hitHandle(i: { x: number; y: number }): { kind: "resize"; handle: HandleName } | { kind: "rotate" } | null {
    const s = this.s;
    if (s.tool !== "select" || s.mode !== "none") return null;
    const box = selectionBox(s.design, s.selectedIds);
    if (!box || this.selected().every((o) => o.locked)) return null;
    const p = this.mm(i);
    const r = this.px(HANDLE_PX + 2);
    const rot = rotateHandlePoint(box, this.px(ROTATE_OFFSET_PX));
    if (dist(p, rot) <= r) return { kind: "rotate" };
    for (const h of HANDLE_NAMES) if (dist(p, handlePoint(box, h)) <= r) return { kind: "resize", handle: h };
    return null;
  }

  // ---- pointer --------------------------------------------------------------------------------
  pointerDown(i: PointerInput): void {
    const s = this.s;
    const p = this.mm(i);
    this.cursor = p;

    if (i.button === 1 || this.space || s.tool === "pan") {
      this.drag = { kind: "pan", last: [i.x, i.y] };
      this.changed();
      return;
    }

    // modes of the shape actions take over the pointer
    if (s.mode === "knife" && i.button === 0) {
      this.drag = { kind: "knife", a: p, b: p };
      this.changed();
      return;
    }
    if (s.mode === "setStart" || s.mode === "setEnd") {
      const o = this.selected()[0];
      if (o && i.button === 0) {
        const key = s.mode === "setStart" ? "startPoint" : "endPoint";
        this.a.updateObjects([o.id], s.mode === "setStart" ? "Set start point" : "Set end point", (x) => void (x[key] = p));
      }
      this.a.setMode("none");
      return;
    }
    if (s.mode === "angle") {
      this.drag = { kind: "dial" };
      this.setAngleFromPointer(p, i.ctrl);
      this.changed();
      return;
    }
    if ((s.mode === "hole" || s.mode === "pickPath" || s.mode === "guide") && !this.draft) {
      this.draft = { kind: "path", closed: s.mode === "hole", nodes: [], purpose: s.mode === "hole" ? "hole" : s.mode === "guide" ? "guide" : "mapPath" };
    }
    if (this.draft) {
      this.draftPointer(i, p);
      return;
    }

    switch (s.tool) {
      case "select":
        this.selectDown(i, p);
        return;
      case "measure":
        this.drag = { kind: "measure", a: p, b: p };
        this.measureLine = null;
        this.changed();
        return;
      case "rect":
      case "circle":
        if (i.button === 0) {
          this.drag = { kind: "shapeBox", shape: s.tool, a: p, b: p, square: i.ctrl };
          this.changed();
        }
        return;
      case "pen":
        if (i.button === 0) {
          this.drag = { kind: "pen", pts: [p] };
          this.changed();
        }
        return;
      case "open":
      case "closed":
        this.draft = { kind: "path", closed: s.tool === "closed", nodes: [], purpose: "shape" };
        this.draftPointer(i, p);
        return;
      case "satin":
        this.draft = { kind: "satin", closed: false, nodes: [], purpose: "shape" };
        this.draftPointer(i, p);
        return;
      case "manual":
        this.draft = { kind: "manual", closed: false, nodes: [], purpose: "shape" };
        this.draftPointer(i, p);
        return;
      case "text": {
        // Text tool: clicking a word selects it (the panel then edits it); clicking elsewhere sets
        // where new text will be placed.
        if (i.button !== 0) return;
        const d = s.design;
        const hit = d ? [...d.objects].reverse().find((o) => o.sourceText && hitObject(o, p, this.px(PICK_PX))) : undefined;
        if (hit) this.a.setSelection([hit.id]);
        else {
          this.a.setSelection([]);
          this.a.setTextAnchor(p);
        }
        this.changed();
        return;
      }
      default:
        return;
    }
  }

  private selectDown(i: PointerInput, p: Pt): void {
    const s = this.s;
    const design = s.design;
    // handles and markers of the current selection come first
    const sel = this.selected();

    if (s.mode === "reshape" && sel.length === 1) {
      this.reshapeDown(i, p, sel[0]);
      return;
    }

    const h = this.hitHandle(i);
    if (h && i.button === 0) {
      const box = selectionBox(design, s.selectedIds)!;
      if (h.kind === "rotate") {
        this.drag = { kind: "rotate", centre: [(box.minX + box.maxX) / 2, (box.minY + box.maxY) / 2], start: p, to: p, snap: i.ctrl };
      } else {
        this.drag = { kind: "resize", handle: h.handle, box, to: handlePoint(box, h.handle), lock: s.aspectLock !== i.ctrl };
      }
      this.changed();
      return;
    }

    // start / end markers of a single selection
    if (sel.length === 1 && i.button === 0) {
      const o = sel[0];
      for (const which of ["start", "end"] as const) {
        const at = which === "start" ? o.startPoint : o.endPoint;
        if (at && dist(p, at) <= this.px(NODE_PX + 2) && !o.locked) {
          this.drag = { kind: "marker", id: o.id, which, at };
          this.changed();
          return;
        }
      }
    }

    // the movable centre of a centred pattern
    if (sel.length === 1 && sel[0].kind === "fill" && !sel[0].locked && i.button === 0) {
      const c = this.patternCentre(sel[0]);
      if (c && dist(p, c) <= this.px(NODE_PX + 3)) {
        this.drag = { kind: "marker", id: sel[0].id, which: "center", at: c };
        this.changed();
        return;
      }
    }

    // objects, topmost first
    const tol = this.px(PICK_PX);
    const hit = design ? [...design.objects].reverse().find((o) => hitObject(o, p, tol)) : undefined;
    if (hit) {
      if (i.detail >= 2 && i.button === 0) {
        this.a.setSelection([hit.id]);
        this.a.setMode("reshape");
        return;
      }
      if (i.shift) {
        const have = s.selectedIds.includes(hit.id);
        this.a.setSelection(have ? s.selectedIds.filter((x) => x !== hit.id) : [...s.selectedIds, hit.id]);
        return;
      }
      const ids = s.selectedIds.includes(hit.id) ? s.selectedIds : [hit.id];
      if (!s.selectedIds.includes(hit.id)) this.a.setSelection([hit.id]);
      this.a.selectRefImage(null);
      this.drag = { kind: "move", from: p, to: p, ids, hit: hit.id, moved: false, shift: false, constrain: i.ctrl };
      this.changed();
      return;
    }

    // reference images behind the shapes
    const img = [...s.refImages].reverse().find((r) => r.visible && !r.locked && s.view.reference && this.inImage(r, p));
    if (img) {
      this.a.selectRefImage(img.id);
      this.drag = { kind: "image", id: img.id, from: p, orig: [img.x, img.y] };
      this.changed();
      return;
    }

    if (i.detail >= 2) {
      this.deps.fit();
      return;
    }
    this.drag = { kind: "marquee", a: p, b: p, additive: i.shift };
    this.changed();
  }

  private inImage(r: EditorState["refImages"][number], p: Pt): boolean {
    const h = (r.widthMm * r.h) / Math.max(1, r.w);
    return p[0] >= r.x && p[0] <= r.x + r.widthMm && p[1] >= r.y && p[1] <= r.y + h;
  }

  pointerMove(i: { x: number; y: number; ctrl: boolean; shift: boolean }): void {
    const p = this.mm(i);
    this.cursor = p;
    const d = this.drag;
    if (!d) {
      if (this.draft || this.s.mode !== "none") this.changed();
      return;
    }
    switch (d.kind) {
      case "pan":
        this.deps.setView({ ...this.deps.getView(), x: this.deps.getView().x + i.x - d.last[0], y: this.deps.getView().y + i.y - d.last[1] });
        d.last = [i.x, i.y];
        return;
      case "marquee":
        d.b = p;
        break;
      case "move":
        d.to = p;
        d.constrain = i.ctrl;
        if (dist(d.from, p) > this.px(3)) d.moved = true;
        break;
      case "resize": {
        d.to = p;
        d.lock = this.s.aspectLock !== i.ctrl;
        break;
      }
      case "rotate":
        d.to = p;
        d.snap = i.ctrl;
        break;
      case "node": {
        const o = this.s.design?.objects.find((x) => x.id === d.id);
        const ring = o && editRings(o)[d.ring];
        if (ring) {
          d.nodes = d.nodes.map((n, k) => (k === d.index ? { ...n, p: i.ctrl && ring.nodes[k] ? snapAngle(ring.nodes[k].p, p, 15) : p } : n));
          d.moved = true;
        }
        break;
      }
      case "marker":
        d.at = p;
        break;
      case "shapeBox":
        d.b = p;
        d.square = i.ctrl;
        break;
      case "pen":
        if (dist(d.pts[d.pts.length - 1], p) >= 0.3) d.pts.push(p);
        break;
      case "measure":
        d.b = i.ctrl ? snapAngle(d.a, p, 15) : p;
        break;
      case "knife":
        d.b = i.ctrl ? snapAngle(d.a, p, 15) : p;
        break;
      case "dial":
        this.setAngleFromPointer(p, i.ctrl);
        break;
      case "image": {
        const dx = p[0] - d.from[0];
        const dy = p[1] - d.from[1];
        this.a.updateRefImage(d.id, { x: d.orig[0] + dx, y: d.orig[1] + dy });
        break;
      }
    }
    this.changed();
  }

  pointerUp(i: { x: number; y: number; ctrl: boolean; shift: boolean }): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    const p = this.mm(i);
    const s = this.s;
    switch (d.kind) {
      case "marquee": {
        const box: Box = { minX: Math.min(d.a[0], p[0]), minY: Math.min(d.a[1], p[1]), maxX: Math.max(d.a[0], p[0]), maxY: Math.max(d.a[1], p[1]) };
        const tiny = box.maxX - box.minX < this.px(3) && box.maxY - box.minY < this.px(3);
        if (tiny) {
          if (!d.additive) this.a.setSelection([]);
          this.a.selectRefImage(null);
        } else {
          const ids = (s.design?.objects ?? []).filter((o) => o.visible !== false && objectTouchesBox(o, box)).map((o) => o.id);
          this.a.setSelection(d.additive ? [...new Set([...s.selectedIds, ...ids])] : ids);
        }
        break;
      }
      case "move": {
        if (d.moved) {
          this.a.transformObjects(d.ids, moveTransform(d.from, p, i.ctrl), "Move");
        } else if (!d.shift && d.ids.length > 1 && s.selectedIds.includes(d.hit)) {
          // a plain click on one of several selected objects narrows the selection to it
          this.a.setSelection([d.hit]);
        }
        break;
      }
      case "resize": {
        const m = resizeTransform(d.box, d.handle, p, s.aspectLock !== i.ctrl);
        this.a.transformSelection(m, "Resize");
        break;
      }
      case "rotate": {
        const { m } = rotateTransform(d.centre, d.start, p, i.ctrl ? 15 : undefined);
        this.a.transformSelection(m, "Rotate");
        break;
      }
      case "node":
        if (d.moved) {
          const o = s.design?.objects.find((x) => x.id === d.id);
          if (o) this.a.updateObjects([d.id], "Reshape", (draft) => void Object.assign(draft, withRingNodes(o, d.ring, d.nodes)));
        }
        break;
      case "marker": {
        if (d.which === "center") {
          this.a.updateObjects([d.id], "Move pattern centre", (o) => {
            if (o.kind === "fill") o.params.center = p;
          });
          break;
        }
        const key = d.which === "start" ? "startPoint" : "endPoint";
        this.a.updateObjects([d.id], d.which === "start" ? "Move start point" : "Move end point", (o) => void (o[key] = p));
        break;
      }
      case "shapeBox":
        this.finishShapeBox(d, p);
        break;
      case "pen":
        this.finishPen(d);
        break;
      case "measure":
        this.measureLine = dist(d.a, d.b) > 0.05 ? { a: d.a, b: d.b } : null;
        break;
      case "knife":
        if (dist(d.a, d.b) > this.px(4)) {
          this.a.setMode("none");
          void this.a.knife(d.a, d.b);
        }
        break;
      case "dial":
        this.a.endGroup();
        break;
      case "image":
        break;
      case "pan":
        break;
    }
    this.changed();
  }

  // ---- drawing --------------------------------------------------------------------------------
  private constrainedPoint(p: Pt, ctrl: boolean): Pt {
    const last = this.draft?.nodes[this.draft.nodes.length - 1];
    return ctrl && last ? snapAngle(last.p, p, 15) : p;
  }

  private draftPointer(i: PointerInput, raw: Pt): void {
    const d = this.draft;
    if (!d) return;
    const p = this.constrainedPoint(raw, i.ctrl);
    const curveClick = i.button === 2 || (i.button === 0 && i.detail >= 2);
    if (i.button !== 0 && i.button !== 2) return;

    if (d.kind === "path") {
      // the second click of a double-click lands on the point the first one made: make it a curve
      const last = d.nodes[d.nodes.length - 1];
      if (i.button === 0 && i.detail >= 2 && last && dist(last.p, p) < this.px(6)) {
        d.nodes[d.nodes.length - 1] = { ...last, curve: true };
        this.changed();
        return;
      }
      if (d.closed && d.nodes.length >= 3 && i.button === 0 && dist(d.nodes[0].p, p) < this.px(CLOSE_PX)) {
        this.finishDraft();
        return;
      }
      d.nodes.push(curveClick ? { p, curve: true } : { p });
    } else {
      d.nodes.push({ p });
    }
    this.changed();
  }

  private nextName(base: string): string {
    const n = (this.s.design?.objects ?? []).filter((o) => o.name.startsWith(base)).length;
    return `${base} ${n + 1}`;
  }
  private threadId(): string {
    const s = this.s;
    return s.threadId ?? s.design?.threads[0]?.id ?? defaultThread().id;
  }
  private newId(): string {
    return makeIdGen(this.s.design ?? { version: 1, unitsMm: 1, hoop: { name: "", widthMm: 0, heightMm: 0 }, threads: [], objects: [] })();
  }
  /** A finished shape returns to the Select tool, so its handles and shape actions are right there. */
  private created(): void {
    this.a.setTool("select");
  }
  private ensureDefaultThread() {
    // a brand-new design starts with no threads; the active thread is added by addObjects
    if (!this.s.threadId) this.a.setThread(this.threadId());
  }

  /** Finish the shape being drawn (Enter, closing click). */
  finishDraft(): void {
    const d = this.draft;
    if (!d) return;
    const flat = (nodes: PathNode[], closed: boolean) => flattenNodes(nodes, closed);
    this.draft = null;
    this.changed();
    if (d.purpose === "mapPath") {
      if (d.nodes.length >= 2) this.a.setMapPath(flat(d.nodes, false));
      return;
    }
    if (d.purpose === "guide") {
      const o = this.selected().find((x) => x.kind === "fill");
      if (o && d.nodes.length >= 2) {
        const guide = flat(d.nodes, false);
        this.a.updateObjects([o.id], "Add guide curve", (x) => {
          if (x.kind === "fill") x.params.guides = [...(x.params.guides ?? []), guide];
        });
      }
      this.a.setMode("none");
      return;
    }
    if (d.purpose === "hole") {
      if (d.nodes.length >= 3) {
        this.a.setMode("none");
        void this.a.cutHole(flat(d.nodes, true));
      }
      return;
    }
    this.ensureDefaultThread();
    const id = this.newId();
    const t = this.threadId();
    if (d.kind === "satin") {
      const pts = d.nodes.map((n) => n.p);
      const even = pts.length - (pts.length % 2);
      if (even >= 4) {
        this.a.addObjects([makeSatin(id, this.nextName("Satin"), t, pts.slice(0, even))], "Draw satin");
        this.created();
      }
    } else if (d.kind === "manual") {
      if (d.nodes.length >= 2) {
        const o = makeRun(id, this.nextName("Stitches"), t, d.nodes, false, { ...DEFAULT_RUN_PARAMS, type: "manual" });
        this.a.addObjects([o], "Place stitches");
        this.created();
      }
    } else if (d.closed) {
      if (d.nodes.length >= 3) {
        this.a.addObjects([makeFill(id, this.nextName("Shape"), t, d.nodes)], "Draw shape");
        this.created();
      }
    } else if (d.nodes.length >= 2) {
      this.a.addObjects([makeRun(id, this.nextName("Path"), t, d.nodes, false)], "Draw path");
      this.created();
    }
  }

  private finishShapeBox(d: Extract<Drag, { kind: "shapeBox" }>, p: Pt): void {
    const b = boxFromDrag(d.a, p, d.square);
    if (b.maxX - b.minX < MIN_DRAG_MM || b.maxY - b.minY < MIN_DRAG_MM) return;
    this.ensureDefaultThread();
    const id = this.newId();
    const t = this.threadId();
    if (d.shape === "rect") {
      this.a.addObjects([makeFill(id, this.nextName("Rectangle"), t, rectNodes(b.minX, b.minY, b.maxX, b.maxY))], "Draw rectangle");
      this.created();
    } else {
      const nodes = ellipseNodes((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.maxX - b.minX) / 2, (b.maxY - b.minY) / 2);
      this.a.addObjects([makeFill(id, this.nextName("Circle"), t, nodes)], "Draw circle");
      this.created();
    }
  }

  private finishPen(d: Extract<Drag, { kind: "pen" }>): void {
    if (d.pts.length < 3) return;
    let pathLen = 0;
    for (let k = 1; k < d.pts.length; k++) pathLen += dist(d.pts[k], d.pts[k - 1]);
    if (pathLen < 2) return;
    this.ensureDefaultThread();
    const id = this.newId();
    const t = this.threadId();
    const closed = d.pts.length >= 8 && dist(d.pts[0], d.pts[d.pts.length - 1]) < Math.max(3, pathLen * 0.08);
    if (closed) {
      const nodes = smoothStroke(d.pts.slice(0, -1), 0.3).map((n) => ({ ...n, curve: true }));
      if (nodes.length >= 3) {
        this.a.addObjects([makeFill(id, this.nextName("Freehand"), t, nodes)], "Draw freehand shape");
        this.created();
      }
    } else {
      this.a.addObjects([makeRun(id, this.nextName("Freehand"), t, smoothStroke(d.pts, 0.3), false)], "Draw freehand line");
      this.created();
    }
  }

  // ---- reshape --------------------------------------------------------------------------------
  private reshapeDown(i: PointerInput, p: Pt, o: DesignObject): void {
    if (o.locked) return;
    const rings = editRings(o);
    const r = this.px(NODE_PX + 2);
    // nodes first
    for (let ri = 0; ri < rings.length; ri++) {
      for (let k = 0; k < rings[ri].nodes.length; k++) {
        if (dist(rings[ri].nodes[k].p, p) <= r) {
          if (i.detail >= 2 && rings[ri].structural) {
            this.toggleCurve(o, ri, k);
            return;
          }
          this.nodeSel = { ring: ri, index: k };
          this.drag = { kind: "node", id: o.id, ring: ri, index: k, nodes: rings[ri].nodes, moved: false };
          this.changed();
          return;
        }
      }
    }
    // a click on an edge inserts a node and starts dragging it
    const tol = this.px(PICK_PX);
    for (let ri = 0; ri < rings.length; ri++) {
      const ring = rings[ri];
      if (!ring.structural) continue;
      const pts = ring.closed || o.kind !== "run" ? flattenNodes(ring.nodes, ring.closed) : flattenNodes(ring.nodes, false);
      if (distToPolyline(p, pts, ring.closed) <= tol) {
        const { nodes, index } = insertNodeNear(ring.nodes, ring.closed, p);
        this.a.updateObjects([o.id], "Add point", (draft) => void Object.assign(draft, withRingNodes(o, ri, nodes)));
        this.nodeSel = { ring: ri, index };
        this.drag = { kind: "node", id: o.id, ring: ri, index, nodes, moved: false };
        this.changed();
        return;
      }
    }
    // empty space: leave reshape mode and treat as a normal click
    this.nodeSel = null;
    this.a.setMode("none");
    this.selectDown(i, p);
  }

  private toggleCurve(o: DesignObject, ring: number, index: number): void {
    const nodes = editRings(o)[ring].nodes.map((n, k) => (k === index ? { ...n, curve: !n.curve } : n));
    this.a.updateObjects([o.id], "Toggle curve", (draft) => void Object.assign(draft, withRingNodes(o, ring, nodes)));
  }

  // ---- angle dial -----------------------------------------------------------------------------
  /** Where a centred pattern (Circular, Spiral, Tornado, Sunburst) is centred; null for other patterns. */
  patternCentre(o: DesignObject): Pt | null {
    if (o.kind !== "fill" || !patternInfo(o.params.pattern).centred) return null;
    if (o.params.center) return o.params.center;
    const b = objectBox(o);
    return b ? [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2] : null;
  }

  /** Centre of the object the dial belongs to. */
  dialCentre(): Pt | null {
    const o = this.selected().find((x) => x.kind === "fill");
    const b = o ? objectBox(o) : null;
    return b ? [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2] : null;
  }
  private setAngleFromPointer(p: Pt, snap: boolean): void {
    const c = this.dialCentre();
    const o = this.selected().find((x) => x.kind === "fill");
    if (!c || !o || o.locked) return;
    let deg = (Math.atan2(p[1] - c[1], p[0] - c[0]) * 180) / Math.PI;
    if (snap) deg = Math.round(deg / 15) * 15;
    deg = Math.round(deg * 10) / 10;
    this.a.updateObjects([o.id], "Stitch angle", (draft) => {
      if (draft.kind === "fill") draft.params.angleDeg = deg;
    }, { merge: "angle" });
  }

  // ---- keyboard -------------------------------------------------------------------------------
  /** Returns true when the key was used. Tool-specific keys only; global shortcuts live in `shortcuts.ts`. */
  key(k: KeyInput): boolean {
    const s = this.s;
    const mod = k.ctrl || k.meta;
    if (k.key === "Escape") {
      if (this.draft) {
        this.draft = null;
        if (s.mode === "hole" || s.mode === "pickPath" || s.mode === "guide") this.a.setMode("none");
        this.changed();
        return true;
      }
      if (this.drag) {
        this.drag = null;
        this.changed();
        return true;
      }
      if (s.mode !== "none") {
        this.a.setMode("none");
        this.nodeSel = null;
        this.changed();
        return true;
      }
      if (s.mapDraft) {
        this.a.closeMapDraft();
        return true;
      }
      if (s.selectedIds.length) {
        this.a.setSelection([]);
        return true;
      }
      return false;
    }
    if (k.key === "Enter") {
      if (this.draft) {
        this.finishDraft();
        return true;
      }
      return false;
    }
    if (k.key === "Backspace" || k.key === "Delete") {
      if (this.draft) {
        this.draft.nodes.pop();
        if (this.draft.nodes.length === 0) this.draft = null;
        this.changed();
        return true;
      }
      const sel = this.selected();
      if (s.mode === "reshape" && sel.length === 1 && this.nodeSel) {
        const o = sel[0];
        const ring = editRings(o)[this.nodeSel.ring];
        if (ring?.structural) {
          const nodes = deleteNode(ring.nodes, ring.closed, this.nodeSel.index);
          const ri = this.nodeSel.ring;
          this.nodeSel = null;
          this.a.updateObjects([o.id], "Delete point", (draft) => void Object.assign(draft, withRingNodes(o, ri, nodes)));
          this.changed();
          return true;
        }
      }
      if (s.selectedIds.length) {
        this.a.deleteSelection();
        return true;
      }
      return false;
    }
    if (!mod && k.key.toLowerCase() === "c" && s.mode === "reshape" && this.nodeSel) {
      const o = this.selected()[0];
      if (o) this.toggleCurve(o, this.nodeSel.ring, this.nodeSel.index);
      return true;
    }
    if (k.key.startsWith("Arrow") && !mod && s.selectedIds.length && !this.draft && s.tool === "select") {
      const step = k.shift ? 1 : 0.1;
      const dx = k.key === "ArrowLeft" ? -step : k.key === "ArrowRight" ? step : 0;
      const dy = k.key === "ArrowUp" ? -step : k.key === "ArrowDown" ? step : 0;
      this.a.nudgeSelection(dx, dy);
      return true;
    }
    return false;
  }

  /** Leave any half-finished gesture (tool switch, selection change). */
  reset(): void {
    this.draft = null;
    this.drag = null;
    this.nodeSel = null;
    this.measureLine = null;
    this.changed();
  }

  /** Currently drawing something with a drawing tool? */
  get isDrawing(): boolean {
    return this.draft !== null || (this.drag !== null && DRAWING_TOOLS.includes(this.s.tool));
  }

  clearMeasure(): void {
    this.measureLine = null;
    this.changed();
  }

  /** Ghost of the selection under a move/resize/rotate drag, for tests and the overlay. */
  previewObjects(): DesignObject[] {
    const m = this.previewAffine();
    if (!m) return [];
    const ids = this.drag?.kind === "move" ? new Set(this.drag.ids) : new Set(this.s.selectedIds);
    return (this.s.design?.objects ?? []).filter((o) => ids.has(o.id)).map((o) => transformObject(o, m));
  }

  /** An open run chosen as the path, for tools that need one. */
  static isOpenRun(o: DesignObject): o is RunObject {
    return o.kind === "run" && !o.geometry.closed;
  }
}
