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

/** One picture to draw (see `Scene.setRefImages`). */
export interface RefSprite {
  src: HTMLCanvasElement | HTMLImageElement;
  x: number;
  y: number;
  widthMm: number;
  heightMm: number;
  alpha: number;
  /** How many stitch bands are under it. Default 0: behind all the stitches. */
  band?: number;
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
  /**
   * Pictures and stitches in layer order: picture group 0, stitch band 0, picture group 1, band 1, ... A picture
   * layer above a stitch layer draws over it. With no picture between, there is one band, as before.
   */
  private stack = new Container();
  private bands: StitchLayer[] = [new StitchLayer()];
  private picGroups: Container[] = [new Container(), new Container()];
  /** Plan index where each band starts / ends. */
  private bandRanges: [number, number][] = [[0, 0]];
  private refList: RefSprite[] = [];
  private stitchAlpha = 1;
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
    this.layoutStack();
    this.world.addChild(this.grid, this.hoopG, this.reference, this.quant, this.stack, this.highlightG, this.needleG);
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
    for (const b of this.bands) b.setViewRect(visibleRect(view, this.width, this.height), view.zoom); // off-screen chunks are not drawn
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

  /** Picture groups and stitch bands, bottom to top. */
  private layoutStack(): void {
    this.stack.removeChildren();
    this.bands.forEach((b, k) => this.stack.addChild(this.picGroups[k], b.container));
    this.stack.addChild(this.picGroups[this.bands.length]);
  }

  /** Make exactly `n` stitch bands (and `n + 1` picture groups around them). */
  private ensureBands(n: number): void {
    const count = Math.max(1, n);
    while (this.bands.length < count) this.bands.push(new StitchLayer());
    while (this.bands.length > count) {
      const b = this.bands.pop()!;
      b.clear();
      b.container.destroy();
    }
    while (this.picGroups.length < count + 1) this.picGroups.push(new Container());
    while (this.picGroups.length > count + 1) this.picGroups.pop()!.destroy({ children: true });
    this.layoutStack();
  }

  /**
   * Pictures, bottom first. `band` is how many stitch bands sit under a picture (0 = behind all the stitches); a
   * picture groups with the others of its band. Sprites are reused while the list keeps its shape.
   */
  setRefImages(list: RefSprite[]): void {
    this.refList = list;
    const groups = this.picGroups;
    groups.forEach((g, k) => {
      const mine = list.filter((r) => Math.min(r.band ?? 0, groups.length - 1) === k);
      while (g.children.length > mine.length) g.removeChildAt(g.children.length - 1).destroy();
      mine.forEach((r, i) => {
        let sp = g.children[i] as Sprite | undefined;
        if (!sp) {
          sp = new Sprite();
          g.addChild(sp);
        }
        const tex = this.texture(r.src);
        if (sp.texture !== tex) sp.texture = tex;
        sp.width = r.widthMm;
        sp.height = r.heightMm;
        sp.position.set(r.x, r.y);
        sp.alpha = r.alpha;
      });
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

  /** `splits`: plan indices where stitch band 1, 2, ... start (a picture layer sits between two bands). */
  setPlan(plan: StitchPlan | null, style: StitchStyle, splits: readonly number[] = []): void {
    this.plan = plan;
    const total = plan?.stitches.length ?? 0;
    const starts = [0, ...splits.map((x) => Math.min(Math.max(0, x), total))];
    this.ensureBands(starts.length);
    this.bandRanges = starts.map((a, k) => [a, k + 1 < starts.length ? Math.max(a, starts[k + 1]) : total]);
    const rect = visibleRect(this.view, this.width, this.height);
    this.bands.forEach((b, k) => {
      const [a, e] = this.bandRanges[k];
      b.setViewRect(rect, this.view.zoom);
      b.setPlan(plan ? { ...plan, stitches: starts.length === 1 ? plan.stitches : plan.stitches.slice(a, e) } : null, style);
      b.container.alpha = this.stitchAlpha;
    });
    this.setRefImages(this.refList); // the number of bands may have changed
  }

  setStitchAlpha(a: number): void {
    this.stitchAlpha = a;
    for (const b of this.bands) b.container.alpha = a;
  }

  /** Reveal the first `count` stitches and put the needle at the last one. */
  setProgress(count: number, showNeedle: boolean): void {
    this.bands.forEach((b, k) => b.setProgress(Math.max(0, Math.min(count - this.bandRanges[k][0], this.bandRanges[k][1] - this.bandRanges[k][0]))));
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
    for (const b of this.bands) b.clear();
    this.app.destroy({ removeView: true }, { children: true });
  }
}
