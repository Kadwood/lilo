/// <reference lib="webworker" />
import vtracerWasm from "vtracer-wasm/vtracer.wasm?url";
import { initVtracer } from "@lilo/engine";
import { buildPlan, extraOps, runDigitize, runExport, runShape } from "./ops";
import type { WorkerRequest, WorkerResponse } from "./client";

// Load the tracer once; every request waits for it (harmless for plan/export).
const ready = initVtracer(vtracerWasm);

const post = (msg: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(msg, transfer);

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const req = ev.data;
  try {
    if (req.type === "digitize") {
      await ready;
      const result = await runDigitize(req.source, req.options, (event) => {
        const transfer: Transferable[] = [];
        if ("image" in event && event.image) transfer.push(event.image.data.buffer as ArrayBuffer);
        post({ id: req.id, type: "progress", event }, transfer);
      });
      post({ id: req.id, type: "result", result });
    } else if (req.type === "plan") {
      post({ id: req.id, type: "result", result: buildPlan(req.design) });
    } else if (req.type === "shape") {
      post({ id: req.id, type: "result", result: runShape(req.req) });
    } else if (req.type === "op") {
      post({ id: req.id, type: "result", result: (extraOps[req.name] as (...a: unknown[]) => never)(...req.args) });
    } else {
      post({ id: req.id, type: "result", result: runExport(req.design, req.options) });
    }
  } catch (e) {
    post({ id: req.id, type: "error", message: e instanceof Error ? e.message : String(e) });
  }
};
