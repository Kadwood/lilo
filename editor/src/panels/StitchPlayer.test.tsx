// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { lastEditor, renderEditor, testDesign } from "../test/helpers";
import { StitchPlayer } from "./StitchPlayer";

afterEach(cleanup);
const T = { timeout: 20_000 };
const loaded = () => waitFor(() => expect(lastEditor?.state.planResult).not.toBeNull(), T);

describe("StitchPlayer", () => {
  it("shows totals: stitches, colour changes, size and time at 850 spm", async () => {
    renderEditor(<StitchPlayer />, { design: testDesign() });
    await loaded();
    const stats = screen.getByLabelText("Design totals");
    const n = lastEditor!.state.planResult!.stats.stitchCount;
    expect(stats.textContent).toContain(`${n.toLocaleString()} stitches`);
    expect(stats.textContent).toMatch(/1 colour change/);
    expect(stats.textContent).toMatch(/\d+\.\d × \d+\.\d mm/);
    expect(stats.textContent).toMatch(/≈ \d+ min/);
  });

  it("pauses at the colour change with a swap card, and Continue resumes", async () => {
    renderEditor(<StitchPlayer />, { design: testDesign() });
    await loaded();
    const player = lastEditor!.player;
    const plan = lastEditor!.state.planResult!.plan;
    const ccIndex = plan.stitches.findIndex((s) => s.type === "colorChange");

    act(() => {
      player.seek(ccIndex - 3);
      player.setSpeed(50);
      player.play();
      player.tick(1);
    });
    const card = await screen.findByRole("alertdialog", { name: "Colour change" });
    expect(card.textContent).toContain("Swap to Brother 800 — Red");
    expect(card.textContent).toContain("Colour change 1 of 1");
    expect(screen.getByLabelText("Play")).toBeTruthy(); // paused

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(player.snapshot().index).toBe(ccIndex + 1);
    expect(player.snapshot().playing).toBe(true);
  });

  it("scrub bar seeks and the speed slider changes speed", async () => {
    renderEditor(<StitchPlayer />, { design: testDesign() });
    await loaded();
    const player = lastEditor!.player;
    fireEvent.change(screen.getByLabelText("Scrub stitches"), { target: { value: "40" } });
    expect(player.snapshot().index).toBe(40);
    fireEvent.change(screen.getByLabelText("Playback speed"), { target: { value: "30" } });
    expect(player.snapshot().speed).toBe(30);
    expect(screen.getByText("30×")).toBeTruthy();
    fireEvent.click(screen.getAllByLabelText("Auto-continue")[0]);
    expect(player.snapshot().autoContinue).toBe(true);
  });

  it("play button toggles playback", async () => {
    renderEditor(<StitchPlayer />, { design: testDesign() });
    await loaded();
    fireEvent.click(screen.getByLabelText("Play"));
    expect(lastEditor!.player.snapshot().playing).toBe(true);
    fireEvent.click(screen.getByLabelText("Pause"));
    expect(lastEditor!.player.snapshot().playing).toBe(false);
  });

  it("explains itself when empty", () => {
    renderEditor(<StitchPlayer />);
    expect(screen.getByText(/digitize an image/i)).toBeTruthy();
  });
});
