import { describe, expect, it } from "vitest";
import { DEFAULT_SATIN_PARAMS, DEFAULT_FILL_PARAMS, type Design, type DesignObject, type Thread } from "../model";
import { recommendedSpeed } from "./apply";
import { MACHINE_MAX_SPM, recommendedMachineSpeed, SPEED_CAPS } from "./speed";

const plain: Thread = { id: "t", brand: "Brother", code: "1", name: "Blue", hex: "#0000ff" };
const gold: Thread = { id: "g", brand: "Madeira", line: "Metallic", code: "9", name: "Metallic Gold", hex: "#d4af37" };
const satin = (w: number, threadId = "t"): DesignObject => ({ id: `s${w}${threadId}`, name: "s", kind: "satin", threadId, geometry: { strip: [[0, 0], [0, w], [3, 0], [3, w], [6, 0], [6, w]] }, params: { ...DEFAULT_SATIN_PARAMS, widthMm: w } });
const fill = (): DesignObject => ({ id: "f", name: "f", kind: "fill", threadId: "t", geometry: { shell: [[0, 0], [20, 0], [20, 20], [0, 20]], holes: [] }, params: DEFAULT_FILL_PARAMS });
const d = (objects: DesignObject[], threads: Thread[] = [plain], textBlocks?: Design["textBlocks"]) => ({ objects, threads, textBlocks });
const noWarn = { warnings: [] };

describe("recommendedMachineSpeed", () => {
  it("starts from the middle of the fabric's range when nothing slows it down", () => {
    const r = recommendedMachineSpeed(d([fill(), satin(3)]), { fabric: "suiting", threadWeight: 40 }, noWarn);
    expect(r.spm).toBe(recommendedSpeed("suiting", 40).estimateSpm);
    expect(r.reasons).toEqual(["a good speed for suiting cloth"]);
  });
  it("thin satin (under 2 mm) caps at 450", () => {
    const r = recommendedMachineSpeed(d([satin(1.5)]), { fabric: "twill", threadWeight: 40 }, noWarn);
    expect(r.spm).toBe(SPEED_CAPS.thinSatin);
    expect(r.spm).toBe(450);
    expect(r.reasons).toEqual(["thin lines in this design"]);
    expect(recommendedMachineSpeed(d([satin(2)]), { fabric: "twill", threadWeight: 40 }, noWarn).spm).toBeGreaterThan(450);
  });
  it("lettering under 5 mm tall caps at 450", () => {
    const tb = [{ id: "b", text: "Hi", fontId: "x", heightMm: 4, letterSpacingMm: 0, lineSpacing: 1, align: "left" as const, origin: [0, 0] as [number, number] }];
    const r = recommendedMachineSpeed(d([fill()], [plain], tb), { fabric: "twill", threadWeight: 40 }, noWarn);
    expect(r.spm).toBe(450);
    expect(r.reasons).toEqual(["small letters"]);
    expect(recommendedMachineSpeed(d([fill()], [plain], [{ ...tb[0], heightMm: 5 }]), { fabric: "twill", threadWeight: 40 }, noWarn).spm).toBeGreaterThan(450);
  });
  it("metallic thread caps at 400, only when it is used by a visible object", () => {
    const used = recommendedMachineSpeed(d([satin(3, "g")], [plain, gold]), { fabric: "twill", threadWeight: 40 }, noWarn);
    expect(used).toEqual({ spm: 400, reasons: ["metallic thread"] });
    const unused = recommendedMachineSpeed(d([satin(3)], [plain, gold]), { fabric: "twill", threadWeight: 40 }, noWarn);
    expect(unused.spm).toBeGreaterThan(400);
  });
  it("a density warning caps at 550", () => {
    const r = recommendedMachineSpeed(d([fill()]), { fabric: "twill", threadWeight: 40 }, { warnings: [{ code: "density" }] });
    expect(r).toEqual({ spm: 550, reasons: ["very dense stitching"] });
  });
  it("the lowest cap wins and only binding reasons are listed", () => {
    const r = recommendedMachineSpeed(d([satin(1.5, "g")], [plain, gold]), { fabric: "twill", threadWeight: 40 }, { warnings: [{ code: "density" }] });
    expect(r.spm).toBe(400);
    expect(r.reasons).toEqual(["metallic thread"]);
  });
  it("thick fabrics keep their own slower range (leather, towel, denim)", () => {
    for (const fabric of ["leather", "towel", "denim"] as const) {
      const r = recommendedMachineSpeed(d([fill()]), { fabric, threadWeight: 40 }, noWarn);
      expect(r.spm).toBe(recommendedSpeed(fabric, 40).estimateSpm);
      expect(r.spm).toBeLessThan(MACHINE_MAX_SPM);
    }
  });
  it("never goes above the machine's top speed", () => {
    expect(recommendedMachineSpeed(d([fill()]), { fabric: "twill", threadWeight: 40 }, noWarn, 600).spm).toBe(600);
    expect(recommendedMachineSpeed(d([fill()]), { fabric: "twill", threadWeight: 40 }, noWarn).spm).toBeLessThanOrEqual(850);
  });
  it("ignores hidden objects", () => {
    expect(recommendedMachineSpeed(d([{ ...satin(1), visible: false }]), { fabric: "twill", threadWeight: 40 }, noWarn).spm).toBeGreaterThan(450);
  });
});
