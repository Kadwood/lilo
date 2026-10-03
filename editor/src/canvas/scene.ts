// The webview's CSP forbids `unsafe-eval`; this swaps Pixi's generated uniform-sync code for static code.
import "pixi.js/unsafe-eval";
import { Application, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { DesignObject, Hoop, PlanStitch, StitchPlan } from "@lilo/engine";
import { drawHoop, type HoopDrawOptions } from "./hoopArt";
import { StitchLayer, type StitchStyle } from "./stitchLayer";
import { visibleRect, type Rect, type View } from "./viewport";

export interface Theme {
  grid: number;
  gridMajor: number;
  hoop: number;
  accent: number;
  needle: number;
  /** The hoop's frame ring and its edge/clamp (optional: older callers omit them). */
  frame?: number;
  frameEdge?: number;
}

export interface Placement {
  /** mm per source pixel. */
  scale: number;
  /** Design-space (mm) position of the source image's top-left corner. */
  x: number;
  y: number;
}

/**
 * The PixiJS scene: grid, hoop, reference image, stitches, selection outline and needle, all in
 * millimetres inside one `world` container that the pan/zoom view transforms. Imperative on
 * purpose: React tells it what changed, it never re-renders per frame.
 */
export class Scene {
  readonly app: Application;
  readonly world = new Container();
  private grid = new Graphics();
  private hoopG = new Graphics();
  private reference = new Sprite();
  private quant = new Sprite();
  /** Reference images the user placed behind the shapes (Sequencer > Images). */
  private refLayer = new Container();
  readonly stitches = new StitchLayer();
  private highlightG = new Graphics();
  private needleG = new Graphics();
  private view: View = { x: 0, y: 0, zoom: 8 };
  private hoop: Hoop | null = null;
  private gridOn = true;
  private hoopOpts: HoopDrawOptions = { frame: true, safeArea: true, safeMarginMm: 5 };
  private theme: Theme;
  private highlighted: DesignObject | null = null;
  private plan: StitchPlan | null = null;
  private destroyed = false;

  private constructor(app: Application, theme: Theme) {
    this.app = app;
    this.theme = theme;
    this.reference.visible = false;
    this.quant.visible = false;
    this.needleG.visible = false;
    this.world.addChild(this.grid, this.hoopG, this.refLayer, this.reference, this.quant, this.stitches.container, this.highlightG, this.needleG);
    app.stage.addChild(this.world);
  }

  /** Create the renderer inside `host`. Rejects when WebGL is unavailable. */
  static async create(host: HTMLElement, theme: Theme): Promise<Scene> {
    const app = new Application();
    await app.init({
      resizeTo: host,
      antialias: true,
      backgroundAlpha: 0,
      resolution: window.devicePixelRatio || 1,
      autoDensity: true,
      preference: "webgl",
    });
    host.appendChild(app.canvas);
    const scene = new Scene(app, theme);
    app.renderer.on("resize", () => scene.redrawBackdrop());
    return scene;
  }

  get width(): number {
    return this.app.screen.width;
  }
  get height(): number {
    return this.app.screen.height;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.redrawBackdrop();
    this.drawHighlight();
    this.drawNeedle();
  }

  setView(view: View): void {
    this.view = view;
    this.world.position.set(view.x, view.y);
    this.world.scale.set(view.zoom);
    this.redrawBackdrop();
    this.drawHighlight();
    this.needleG.scale.set(1 / view.zoom);
  }

  setHoop(hoop: Hoop | null): void {
    this.hoop = hoop;
    this.redrawBackdrop();
  }

  /** What to draw of the hoop: the frame ring and clamp, the dashed safe margin. */
  setHoopOptions(o: HoopDrawOptions): void {
    this.hoopOpts = o;
    this.redrawBackdrop();
  }

  setGridVisible(on: boolean): void {
    this.gridOn = on;
    this.redrawBackdrop();
  }

  /** Grid + hoop, redrawn on every view change (cheap: a few dozen lines). */
  private redrawBackdrop(): void {
    if (this.destroyed) return;
    const z = this.view.zoom;
    const r: Rect = visibleRect(this.view, this.width, this.height);
    const g = this.grid;
    g.clear();
    if (this.gridOn) {
      const line = (x0: number, y0: number, x1: number, y1: number) => g.moveTo(x0, y0).lineTo(x1, y1);
      const draw = (step: number, color: number, alpha: number) => {
        for (let x = Math.ceil(r.minX / step) * step; x <= r.maxX; x += step) line(x, r.minY, x, r.maxY);
        for (let y = Math.ceil(r.minY / step) * step; y <= r.maxY; y += step) line(r.minX, y, r.maxX, y);
        g.stroke({ width: 1 / z, color, alpha });
      };
      if (z >= 14) draw(1, this.theme.grid, 0.35);
      if (z >= 1.2) draw(10, this.theme.gridMajor, 0.7);
      // axes through the origin (the machine's reference point)
      line(0, r.minY, 0, r.maxY);
      line(r.minX, 0, r.maxX, 0);
      g.stroke({ width: 1 / z, color: this.theme.gridMajor, alpha: 1 });
    }
    const h = this.hoopG;
    if (this.hoop) {
      drawHoop(h, this.hoop, z, { hoop: this.theme.hoop, frame: this.theme.frame ?? 0xcdbb9a, frameEdge: this.theme.frameEdge ?? 0x9c8a68 }, this.hoopOpts);
    } else {
      h.clear();
    }
  }

  private texture(src: HTMLCanvasElement | HTMLImageElement): Texture {
    return Texture.from(src);
  }

  /** The user's original artwork, drawn behind the stitches. */
  setReference(src: HTMLCanvasElement | HTMLImageElement | null, p: Placement | null, srcWidth: number, srcHeight: number): void {
    if (!src || !p) {
      this.reference.visible = false;
      return;
    }
    const tex = this.texture(src);
    this.reference.texture = tex;
    // SVG images may report a natural size unlike their viewBox; fit to the stated size.
    this.reference.width = srcWidth * p.scale;
    this.reference.height = srcHeight * p.scale;
    this.reference.position.set(p.x, p.y);
    this.reference.visible = true;
  }

  setReferenceAlpha(a: number): void {
    this.reference.alpha = a;
  }

  /** Reference images, bottom first. Sprites are reused when the list keeps its size. */
  setRefImages(list: { src: HTMLCanvasElement | HTMLImageElement; x: number; y: number; widthMm: number; heightMm: number; alpha: number }[]): void {
    while (this.refLayer.children.length > list.length) this.refLayer.removeChildAt(this.refLayer.children.length - 1).destroy();
    list.forEach((r, i) => {
      let sp = this.refLayer.children[i] as Sprite | undefined;
      if (!sp) {
        sp = new Sprite();
        this.refLayer.addChild(sp);
      }
      const tex = this.texture(r.src);
      if (sp.texture !== tex) sp.texture = tex;
      sp.width = r.widthMm;
      sp.height = r.heightMm;
      sp.position.set(r.x, r.y);
      sp.alpha = r.alpha;
    });
  }

  /** The quantised image shown during the tracing animation. */
  setQuantized(img: { width: number; height: number; data: Uint8ClampedArray | Uint8Array } | null, p: Placement | null): void {
    if (!img || !p) {
      this.quant.visible = false;
      return;
    }
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
    this.quant.texture = this.texture(canvas);
    this.quant.width = img.width * p.scale;
    this.quant.height = img.height * p.scale;
    this.quant.position.set(p.x, p.y);
    this.quant.visible = true;
  }

  setQuantizedAlpha(a: number): void {
    this.quant.alpha = a;
    this.quant.visible = a > 0.001 && this.quant.texture !== Texture.EMPTY;
  }

  setPlan(plan: StitchPlan | null, style: StitchStyle): void {
    this.plan = plan;
    this.stitches.setPlan(plan, style);
  }

  setStitchAlpha(a: number): void {
    this.stitches.container.alpha = a;
  }

  /** Reveal the first `count` stitches and put the needle at the last one. */
  setProgress(count: number, showNeedle: boolean): void {
    this.stitches.setProgress(count);
    const list = this.plan?.stitches;
    if (!list || !showNeedle || count <= 0) {
      this.needleG.visible = false;
      return;
    }
    let i = Math.min(list.length, Math.floor(count)) - 1;
    while (i > 0 && list[i].type === "colorChange") i--;
    const s: PlanStitch | undefined = list[i];
    if (!s) return;
    this.needleG.position.set(s.x, s.y);
    this.needleG.visible = true;
  }

  private drawNeedle(): void {
    this.needleG.clear();
    this.needleG.circle(0, 0, 5).fill({ color: this.theme.needle }).stroke({ width: 1.5, color: 0xffffff });
  }

  setHighlight(obj: DesignObject | null): void {
    this.highlighted = obj;
    this.drawHighlight();
  }

  private drawHighlight(): void {
    const g = this.highlightG;
    g.clear();
    const o = this.highlighted;
    if (!o || o.visible === false) return;
    const w = 2 / this.view.zoom;
    const ring = (pts: readonly (readonly [number, number])[], close: boolean) => {
      pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
      if (close) g.closePath();
    };
    if (o.kind === "fill") {
      ring(o.geometry.shell, true);
      g.fill({ color: this.theme.accent, alpha: 0.12 });
      ring(o.geometry.shell, true);
      for (const h of o.geometry.holes) ring(h, true);
    } else if (o.kind === "satin") {
      const left: [number, number][] = [];
      const right: [number, number][] = [];
      for (let i = 0; i + 1 < o.geometry.strip.length; i += 2) {
        left.push([...o.geometry.strip[i]] as [number, number]);
        right.push([...o.geometry.strip[i + 1]] as [number, number]);
      }
      const outline = [...left, ...right.reverse()];
      ring(outline, true);
      g.fill({ color: this.theme.accent, alpha: 0.12 });
      ring(outline, true);
    } else {
      ring(o.geometry.path, o.geometry.closed);
    }
    g.stroke({ width: w, color: this.theme.accent, alpha: 1, join: "round" });
  }

  destroy(): void {
    this.destroyed = true;
    this.stitches.clear();
    this.app.destroy({ removeView: true }, { children: true });
  }
}
