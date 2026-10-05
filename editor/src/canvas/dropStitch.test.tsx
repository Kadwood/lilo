// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { designToEmbroidery } from "@lilo/engine";
import { sampleDesign } from "../../../engine/src/stitch/sample-design";
import { lastEditor, renderEditor, testDesign } from "../test/helpers";
import { CanvasView } from "./CanvasView";

afterEach(cleanup);
const T = { timeout: 20_000 };
const pes = () => new File([designToEmbroidery(sampleDesign(), "pes", { label: "rooster" }).bytes as BlobPart], "rooster.pes");
const drop = (file: File) =>
  act(async () => {
    fireEvent.drop(document.querySelector(".canvas-stage")!, { dataTransfer: { files: [file] } });
  });

describe("a stitch file dropped on the canvas", () => {
  it("joins the open design as a new layer on top, in one undo step, without touching the design", async () => {
    renderEditor(<CanvasView onOpen={() => {}} />, { design: testDesign() });
    await waitFor(() => expect(lastEditor?.state.planResult).not.toBeNull(), T);
    const before = lastEditor!.state.design!;
    const nameBefore = lastEditor!.state.projectName;
    await drop(pes());
    await waitFor(() => expect(lastEditor!.state.design!.layers?.at(-1)?.name).toBe("rooster"), T);
    const d = lastEditor!.state.design!;
    expect(d.objects.slice(0, before.objects.length).map((o) => o.id)).toEqual(before.objects.map((o) => o.id));
    expect(d.objects.length).toBeGreaterThan(before.objects.length);
    expect(lastEditor!.state.projectName).toBe(nameBefore); // the project keeps its name
    expect(lastEditor!.state.undoLabel).toBe("Import rooster");
    act(() => lastEditor!.actions.undo());
    expect(lastEditor!.state.design!.objects.map((o) => o.id)).toEqual(before.objects.map((o) => o.id));
    expect(lastEditor!.state.canUndo).toBe(false);
  });

  it("on an empty canvas it opens as the design (a new project named after the file)", async () => {
    renderEditor(<CanvasView onOpen={() => {}} />);
    await drop(pes());
    await waitFor(() => expect(lastEditor!.state.projectName).toBe("rooster"), T);
    expect(lastEditor!.state.design!.objects.length).toBeGreaterThan(0);
  });
});
