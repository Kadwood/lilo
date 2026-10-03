// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { createInlineEngine, type EngineClient } from "../engine/client";
import { createMockPlatform, type MockState } from "../platform/mock";
import { setPlatform } from "../platform";
import { lastEditor, renderEditor, testDesign } from "../test/helpers";
import { SendDialog } from "./SendDialog";

const T = { timeout: 20_000 };
let mock: MockState;
beforeEach(() => {
  const m = createMockPlatform({ machines: [{ ip: "10.0.0.5", name: "Brother NV2700", manufacturer: "Brother", serial: "1", model: "NV2700", saved: true }] });
  mock = m.state;
  setPlatform(m.platform);
});
afterEach(() => {
  cleanup();
  setPlatform(null);
});

/** The inline engine with a count of how many files it was asked to make. */
function countingEngine(): { engine: EngineClient; exports: () => number } {
  const inner = createInlineEngine();
  let n = 0;
  const engine: EngineClient = {
    ...inner,
    call: ((name: string, ...args: unknown[]) => {
      if (name === "exportFormat") n++;
      return (inner.call as (n: string, ...a: unknown[]) => Promise<unknown>)(name, ...args);
    }) as EngineClient["call"],
  };
  return { engine, exports: () => n };
}

describe("Send dialog", () => {
  it("makes the PES once, not again on every render (the origin object was new each time)", async () => {
    const { engine, exports } = countingEngine();
    renderEditor(<SendDialog onClose={() => {}} />, { design: testDesign(), engine });
    await waitFor(() => expect(lastEditor?.state.planResult).not.toBeNull(), T);
    const dlg = screen.getByRole("dialog", { name: "Send to machine" });
    await waitFor(() => expect((within(dlg).getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false), T);
    const first = exports();
    // renders caused by anything else (machines listed, a sweep) must not start another export
    fireEvent.click(within(dlg).getByRole("button", { name: "Search network" }));
    await waitFor(() => expect(within(dlg).getByRole("button", { name: "Search network" })).toBeTruthy());
    await new Promise((r) => setTimeout(r, 600));
    expect(exports()).toBe(first);
    expect(first).toBeLessThanOrEqual(2); // one per design/plan change at most
    expect((within(dlg).getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("sends the design to the chosen machine", async () => {
    renderEditor(<SendDialog onClose={() => {}} />, { design: testDesign() });
    await waitFor(() => expect(lastEditor?.state.planResult).not.toBeNull(), T);
    const dlg = screen.getByRole("dialog", { name: "Send to machine" });
    await waitFor(() => expect((within(dlg).getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false), T);
    fireEvent.click(within(dlg).getByRole("button", { name: "Send" }));
    await waitFor(() => expect(mock.sends).toHaveLength(1), T);
    expect(mock.sends[0].ip).toBe("10.0.0.5");
    expect(mock.sends[0].filename).toMatch(/\.pes$/);
    await waitFor(() => expect(within(dlg).getByRole("status").textContent).toMatch(/Sent/), T);
  });
});
