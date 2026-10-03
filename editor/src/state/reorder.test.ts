import { describe, expect, it } from "vitest";
import { testDesign, BLUE, RED } from "../test/helpers";
import { groupObjects, moveGroup, moveObject, setGroupVisible, setObjectVisible } from "./reorder";

const ids = (d: ReturnType<typeof testDesign>) => d.objects.map((o) => o.id);

describe("groupObjects", () => {
  it("groups consecutive objects by thread", () => {
    expect(groupObjects(testDesign().objects).map((g) => [g.threadId, g.indices])).toEqual([
      [BLUE.id, [0, 1]],
      [RED.id, [2]],
    ]);
  });

  it("starts a new group when a colour comes back (A, B, A is three blocks)", () => {
    const d = testDesign();
    d.objects = [d.objects[0], d.objects[2], d.objects[1]];
    expect(groupObjects(d.objects).map((g) => g.indices)).toEqual([[0], [1], [2]]);
  });
});

describe("moveObject", () => {
  it("moves an object before another", () => {
    const d = testDesign();
    expect(ids(moveObject(d, 2, 0))).toEqual(["s1", "f1", "r1"]);
    expect(ids(moveObject(d, 0, 2))).toEqual(["r1", "f1", "s1"]);
  });

  it("moves to the end with before = length", () => {
    expect(ids(moveObject(testDesign(), 0, 3))).toEqual(["r1", "s1", "f1"]);
  });

  it("returns the same design for no-op and invalid moves", () => {
    const d = testDesign();
    expect(moveObject(d, 1, 1)).toBe(d);
    expect(moveObject(d, 1, 2)).toBe(d); // "before the next one" is where it already is
    expect(moveObject(d, -1, 0)).toBe(d);
    expect(moveObject(d, 0, 9)).toBe(d);
  });
});

describe("moveGroup", () => {
  it("moves a whole colour block", () => {
    const d = testDesign();
    expect(ids(moveGroup(d, 1, 0))).toEqual(["s1", "f1", "r1"]);
    expect(ids(moveGroup(d, 0, 2))).toEqual(["s1", "f1", "r1"]);
    expect(moveGroup(d, 0, 1)).toBe(d);
  });
});

describe("visibility", () => {
  it("toggles one object or a whole group without touching the rest", () => {
    const d = testDesign();
    const one = setObjectVisible(d, "r1", false);
    expect(one.objects.map((o) => o.visible)).toEqual([undefined, false, undefined]);
    const grp = setGroupVisible(d, 0, false);
    expect(grp.objects.map((o) => o.visible)).toEqual([false, false, undefined]);
    expect(d.objects[0].visible).toBeUndefined(); // immutable
  });
});
