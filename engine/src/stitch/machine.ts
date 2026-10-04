import type { Hoop } from "../model";
import { hoopQuarterTurns, hoopTurned, machineHoop } from "../hoops";
import type { StitchPlan } from "./plan";
import { validatePlan, type ValidationOptions, type ValidationResult } from "./validate";

/**
 * The plan in the machine's own frame. The physical hoop never turns, so when the hoop is turned in
 * Lilo every stitch is turned back (+y down). `rotateHoop` moves the clamp clockwise (top > right >
 * bottom > left), so one quarter back is (x, y) -> (y, -x): the on-screen clamp side lands on the real
 * one (bottom > right, left > bottom, top > left, right > top). Two turns back is (-x, -y), three is
 * (-y, x). Returns `plan` itself when not turned.
 */
export function toMachineFrame(plan: StitchPlan, hoop: Hoop): StitchPlan {
  const q = hoopQuarterTurns(hoop);
  if (q === 0) return plan;
  const map = q === 1 ? (x: number, y: number) => [y, -x] : q === 2 ? (x: number, y: number) => [-x, -y] : (x: number, y: number) => [-y, x];
  return { ...plan, stitches: plan.stitches.map((s) => { const [x, y] = map(s.x, s.y); return { ...s, x, y }; }) };
}

/**
 * Everything a machine file needs before the origin: plan (on-screen frame) -> machine frame -> validate
 * against the real hoop. Adds an info warning when the hoop is turned. Every writer goes through this.
 */
export function validateForMachine(plan: StitchPlan, hoop: Hoop, options: ValidationOptions = {}): ValidationResult {
  const turned = hoopTurned(hoop);
  const r = validatePlan(toMachineFrame(plan, hoop), machineHoop(hoop), options);
  if (!turned) return r;
  const warning = {
    code: "hoop-turned" as const,
    message: "Hoop is turned in Lilo. Lilo turns the design back so it sews where you placed it — on the machine screen it will appear turned.",
  };
  r.warnings.push(warning);
  r.plan.warnings = r.warnings;
  return r;
}
