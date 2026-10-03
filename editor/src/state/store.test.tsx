// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, waitFor } from "@testing-library/react";
import { initVtracerNode } from "@lilo/engine/node";
import { kLogo } from "../../../engine/test/fixtures/fixtures";
import { createInlineEngine } from "../engine/client";
import { lastEditor, renderEditor } from "../test/helpers";

// jsdom can't decode PNGs; hand the store pixels directly.
vi.mock("../io/decode", async (orig) => {
  const real = await orig<typeof import("../io/decode")>();
  return {
    ...real,
    decodeFile: vi.fn(async () => ({ kind: "raster", image: kLogo(), reference: null })),
  };
});

afterEach(cleanup);
const T = { timeout: 60_000 };

describe("import -> digitize flow", () => {
  it("decodes, digitizes through the engine and publishes design, plan and palette", async () => {
    renderEditor(<div />, { engine: createInlineEngine(initVtracerNode) });
    const stages: string[] = [];
    await act(async () => {
      void lastEditor!.actions.importFile({ name: "k-logo.png", bytes: new Uint8Array(4), type: "image/png" });
    });
    // status flips through the pipeline stages
    await waitFor(() => {
      const s = lastEditor!.state.status;
      if (s.kind === "working") stages.push(s.stage);
      expect(lastEditor!.state.design).not.toBeNull();
    }, T);

    const st = lastEditor!.state;
    expect(st.status).toEqual({ kind: "idle" });
    expect(st.projectName).toBe("k-logo");
    expect(st.source).toMatchObject({ name: "k-logo.png", kind: "raster", width: 300, height: 300 });
    expect(st.design!.threads.map((t) => t.name)).toEqual(["Ultramarine", "Red"]);
    expect(st.planResult!.stats.colorChanges).toBe(1);
    expect(st.palette.map((p) => p.thread.name).sort()).toEqual(["Red", "Ultramarine"]);
    expect(st.placement?.imageToMm.scale).toBeGreaterThan(0);
    expect(st.animationKey).toBe(1);
    expect(st.stages.quantized).not.toBeNull();
  });

  it("re-digitizes when an option changes (live result) and bumps the animation key", async () => {
    renderEditor(<div />, { engine: createInlineEngine(initVtracerNode) });
    await act(async () => {
      void lastEditor!.actions.importFile({ name: "k-logo.png", bytes: new Uint8Array(4), type: "image/png" });
    });
    await waitFor(() => expect(lastEditor!.state.animationKey).toBe(1), T);
    act(() => lastEditor!.actions.setOptions({ widthMm: 30, heightMm: 30 }));
    await waitFor(() => expect(lastEditor!.state.animationKey).toBe(2), T);
    const ys = lastEditor!.state.planResult!.stats;
    expect(Math.max(ys.widthMm, ys.heightMm)).toBeLessThan(31);
  });

  it("surfaces engine errors as a status, not a crash", async () => {
    const engine = createInlineEngine(async () => {
      throw new Error("no wasm");
    });
    renderEditor(<div />, { engine });
    await act(async () => {
      void lastEditor!.actions.importFile({ name: "k-logo.png", bytes: new Uint8Array(4), type: "image/png" });
    });
    await waitFor(() => expect(lastEditor!.state.status).toEqual({ kind: "error", message: "no wasm" }), T);
  });
});
