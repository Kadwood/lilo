// @vitest-environment jsdom
import { StrictMode } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { translation } from "@lilo/engine/light";
import { createInlineEngine } from "../engine/client";
import { EngineProvider } from "../engine/context";
import { testDesign } from "../test/helpers";
import { EditorProvider, useEditor } from "./store";

afterEach(cleanup);

let editor: ReturnType<typeof useEditor> | null = null;
function Probe() {
  editor = useEditor();
  return null;
}

describe("React StrictMode", () => {
  it("still re-stitches after the effects mount twice (dispose must be reversible)", async () => {
    render(
      <StrictMode>
        <EngineProvider engine={createInlineEngine()}>
          <EditorProvider initialDesign={testDesign()}>
            <Probe />
          </EditorProvider>
        </EngineProvider>
      </StrictMode>,
    );
    await waitFor(() => expect(editor?.state.planResult).not.toBeNull(), { timeout: 20_000 });
    const before = editor!.state.planResult!.stats.stitchCount;
    editor!.actions.setSelection(["f1"]);
    editor!.actions.transformSelection(translation(30, 0), "Move");
    const live = () => editor!.api.getState();
    await waitFor(() => expect(Math.max(...live().planResult!.plan.stitches.map((s) => s.x))).toBeGreaterThan(40), { timeout: 20_000 });
    expect(live().planning).toBe(false);
    expect(before).toBeGreaterThan(0);
  });
});
