import type { AutoDigitizeOptions, Design, DesignObject, ExportOptions, ShapeOpRequest, StageEvent } from "@lilo/engine";
import type { DigitizeResponse, DigitizeSource, ExportResponse, PlanResult } from "./ops";

export type { DigitizeResponse, DigitizeSource, ExportResponse, PlanResult } from "./ops";

// `ops` pulls in stitchjs and the WASM; keep it out of the main bundle (the Worker owns it).
const ops = () => import("./ops");

/** Everything the UI asks of the engine. Implementations: Web Worker (default) or in-thread. */
export interface EngineClient {
  digitize(source: DigitizeSource, options: Partial<AutoDigitizeOptions>, onProgress?: (e: StageEvent) => void): Promise<DigitizeResponse>;
  plan(design: Design): Promise<PlanResult>;
  exportPes(design: Design, options: ExportOptions): Promise<ExportResponse>;
  /** Knife / cut-hole: the pieces that replace the object. */
  shapeOp(req: ShapeOpRequest): Promise<DesignObject[]>;
  dispose(): void;
}

/**
 * Runs the engine on the calling thread. Used by tests and as a fallback when Workers are
 * unavailable. `init` loads the vtracer WASM (a no-op for designs that skip tracing).
 */
export function createInlineEngine(init: () => Promise<void> = async () => {}): EngineClient {
  const ready = () => init();
  return {
    async digitize(source, options, onProgress) {
      await ready();
      return (await ops()).runDigitize(source, options, onProgress);
    },
    async plan(design) {
      return (await ops()).buildPlan(design);
    },
    async exportPes(design, options) {
      return (await ops()).runExport(design, options);
    },
    async shapeOp(req) {
      return (await ops()).runShape(req);
    },
    dispose() {},
  };
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

/** Message shapes between the page and `worker.ts`. */
export type WorkerRequest =
  | { id: number; type: "digitize"; source: DigitizeSource; options: Partial<AutoDigitizeOptions> }
  | { id: number; type: "plan"; design: Design }
  | { id: number; type: "export"; design: Design; options: ExportOptions }
  | { id: number; type: "shape"; req: ShapeOpRequest };

export type WorkerResponse =
  | { id: number; type: "progress"; event: StageEvent }
  | { id: number; type: "result"; result: DigitizeResponse | PlanResult | ExportResponse | DesignObject[] }
  | { id: number; type: "error"; message: string };

/**
 * Engine in a module Web Worker, so tracing and stitch generation never block the UI. The worker
 * is created on first use and re-created after `dispose()` (React StrictMode mounts effects twice).
 */
export function createWorkerEngine(): EngineClient {
  let worker: Worker | null = null;
  let next = 1;
  const pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void; onProgress?: (e: StageEvent) => void }>();

  const failAll = (err: Error) => {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
  };

  const get = (): Worker => {
    if (worker) return worker;
    const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      const p = pending.get(msg.id);
      if (!p) return;
      if (msg.type === "progress") p.onProgress?.(msg.event);
      else {
        pending.delete(msg.id);
        if (msg.type === "result") p.resolve(msg.result as never);
        else p.reject(new Error(msg.message));
      }
    };
    w.onerror = (ev) => {
      failAll(new Error(ev.message || "The engine worker crashed"));
      w.terminate();
      if (worker === w) worker = null;
    };
    worker = w;
    return w;
  };

  const call = <T,>(req: DistributiveOmit<WorkerRequest, "id">, onProgress?: (e: StageEvent) => void, transfer: Transferable[] = []): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = next++;
      pending.set(id, { resolve: resolve as (v: never) => void, reject, onProgress });
      get().postMessage({ ...req, id }, transfer);
    });

  return {
    digitize(source, options, onProgress) {
      const transfer = source.kind === "raster" ? [source.image.data.buffer as ArrayBuffer] : [];
      return call<DigitizeResponse>({ type: "digitize", source, options }, onProgress, transfer);
    },
    plan: (design) => call<PlanResult>({ type: "plan", design }),
    exportPes: (design, options) => call<ExportResponse>({ type: "export", design, options }),
    shapeOp: (req) => call<DesignObject[]>({ type: "shape", req }),
    dispose() {
      worker?.terminate();
      worker = null;
      failAll(new Error("Engine disposed"));
    },
  };
}
