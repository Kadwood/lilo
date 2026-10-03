import { describe, expect, it } from "vitest";
import { getCatalogue, toDesignThread, type Thread } from "@lilo/engine/light";
import { lineCells, rectCells } from "./pixelShapes";
import { createPixelStore, isBlank } from "./pixelStore";

const cat = getCatalogue().threads;
const RED = toDesignThread(cat.find((t) => t.name === "Red")!);
const BLUE = toDesignThread(cat.find((t) => t.name === "Blue")!);
const setup = () => {
  const p = createPixelStore();
  return { ...p, get: p.store.getState, cell: (x: number, y: number) => p.store.getState().art.cells[y * p.store.getState().art.width + x] };
};
const pick = (p: ReturnType<typeof setup>, t: Thread) => p.actions.setThread(t);

describe("shapes", () => {
  it("lines include both ends, step diagonally and run backwards", () => {
    expect(lineCells(0, 0, 3, 0)).toEqual([[0, 0], [1, 0], [2, 0], [3, 0]]);
    expect(lineCells(0, 0, 3, 3)).toEqual([[0, 0], [1, 1], [2, 2], [3, 3]]);
    expect(lineCells(3, 0, 0, 0)).toEqual([[3, 0], [2, 0], [1, 0], [0, 0]]);
    expect(lineCells(2, 2, 2, 2)).toEqual([[2, 2]]);
    const shallow = lineCells(0, 0, 6, 2);
    expect(shallow).toHaveLength(7);
    expect(shallow[shallow.length - 1]).toEqual([6, 2]);
  });
  it("rectangles are an edge or filled, from any two corners", () => {
    expect(rectCells(1, 1, 3, 3, true)).toHaveLength(9);
    expect(rectCells(1, 1, 3, 3, false)).toHaveLength(8);
    expect(rectCells(3, 3, 1, 1, false)).toHaveLength(8);
    expect(rectCells(2, 2, 2, 2, false)).toEqual([[2, 2]]);
  });
});

describe("the pixel grid store", () => {
  it("starts as a blank 32 x 32 grid of 2.5 mm tatami cells", () => {
    const p = setup();
    expect(p.get().art).toMatchObject({ width: 32, height: 32, cellMm: 2.5, style: "tatami" });
    expect(isBlank(p.get().art)).toBe(true);
  });

  it("pencil strokes paint with the chosen thread; a whole drag is one undo step", () => {
    const p = setup();
    pick(p, RED);
    p.actions.beginStroke("Draw");
    p.actions.paintCells([[1, 1]], false);
    p.actions.paintCells([[2, 1], [3, 1]], false);
    p.actions.endStroke();
    expect([p.cell(1, 1), p.cell(2, 1), p.cell(3, 1)]).toEqual([RED.id, RED.id, RED.id]);
    expect(p.get().undoDepth).toBe(1);
    p.actions.undo();
    expect(isBlank(p.get().art)).toBe(true);
    p.actions.redo();
    expect(p.cell(2, 1)).toBe(RED.id);
  });

  it("erase clears cells; a stroke that changes nothing makes no undo step", () => {
    const p = setup();
    pick(p, RED);
    p.actions.beginStroke("Draw");
    p.actions.paintCells([[1, 1]], false);
    p.actions.endStroke();
    p.actions.beginStroke("Erase");
    p.actions.paintCells([[1, 1]], true);
    p.actions.endStroke();
    expect(p.cell(1, 1)).toBeNull();
    p.actions.beginStroke("Erase");
    p.actions.paintCells([[5, 5]], true); // already empty
    p.actions.endStroke();
    expect(p.get().undoDepth).toBe(2);
  });

  it("without a colour chosen the pencil paints nothing", () => {
    const p = setup();
    p.actions.beginStroke("Draw");
    p.actions.paintCells([[1, 1]], false);
    p.actions.endStroke();
    expect(isBlank(p.get().art)).toBe(true);
    expect(p.get().undoDepth).toBe(0);
  });

  it("fill floods the connected cells of one colour (and stops at other colours)", () => {
    const p = setup();
    pick(p, RED);
    p.actions.line([0, 5], [31, 5]);
    pick(p, BLUE);
    p.actions.fill(3, 2);
    expect(p.cell(3, 2)).toBe(BLUE.id);
    expect(p.cell(0, 0)).toBe(BLUE.id);
    expect(p.cell(10, 5)).toBe(RED.id); // the line stayed
    expect(p.cell(3, 9)).toBeNull(); // the other side of the line
    expect(p.get().undoLabel).toBe("Fill");
  });

  it("eyedropper takes the colour of a cell", () => {
    const p = setup();
    pick(p, RED);
    p.actions.rect([2, 2], [4, 4]);
    pick(p, BLUE);
    expect(p.actions.eyedrop(2, 2)).toBe(true);
    expect(p.get().threadId).toBe(RED.id);
    expect(p.actions.eyedrop(20, 20)).toBe(false);
    expect(p.get().threadId).toBe(RED.id);
  });

  it("line and rectangle are single undo steps; rectangles can be filled", () => {
    const p = setup();
    pick(p, RED);
    p.actions.line([0, 0], [4, 0]);
    expect(p.get().undoDepth).toBe(1);
    p.actions.setRectFilled(true);
    p.actions.rect([0, 2], [3, 4]);
    expect(p.get().art.cells.filter(Boolean)).toHaveLength(5 + 12);
    p.actions.undo();
    expect(p.get().art.cells.filter(Boolean)).toHaveLength(5);
  });

  it("resize keeps the top-left, cell size and style are undoable, clear empties", () => {
    const p = setup();
    pick(p, RED);
    p.actions.line([0, 0], [20, 0]);
    p.actions.resize(10, 8);
    expect(p.get().art).toMatchObject({ width: 10, height: 8 });
    expect(p.get().art.cells.filter(Boolean)).toHaveLength(10);
    p.actions.setCellMm(4);
    p.actions.setStyle("cross");
    expect(p.get().art).toMatchObject({ cellMm: 4, style: "cross" });
    p.actions.undo();
    p.actions.undo();
    expect(p.get().art).toMatchObject({ cellMm: 2.5, style: "tatami" });
    p.actions.clear();
    expect(isBlank(p.get().art)).toBe(true);
    p.actions.undo();
    expect(isBlank(p.get().art)).toBe(false);
  });

  it("replacing the grid keeps the colour if the new grid has it, else picks one of its own", () => {
    const p = setup();
    pick(p, RED);
    p.actions.line([0, 0], [2, 0]);
    pick(p, BLUE);
    const withRed = p.get().art; // palette: RED and BLUE
    p.actions.replace({ ...withRed, cells: withRed.cells.map(() => null) }, "Reset");
    expect(p.get().threadId).toBe(BLUE.id); // BLUE is in the palette of the replacement too
    p.actions.replace({ ...withRed, threads: [RED], cells: withRed.cells.map(() => null) }, "Reset 2");
    expect(p.get().threadId).toBe(RED.id);
    p.actions.replace({ ...withRed, threads: [], cells: withRed.cells.map(() => null) }, "Reset 3");
    expect(p.get().threadId).toBeNull();
    p.actions.paintCells([[1, 1]], false); // no colour, nothing happens, nothing throws
    expect(isBlank(p.get().art)).toBe(true);
    pick(p, RED);
    p.actions.paintCells([[1, 1]], false);
    expect(p.cell(1, 1)).toBe(RED.id);
  });

  it("load opens a grid (or a fresh one) and clears the history", () => {
    const p = setup();
    pick(p, RED);
    p.actions.line([0, 0], [2, 0]);
    const art = p.get().art;
    p.actions.load(null);
    expect(isBlank(p.get().art)).toBe(true);
    expect(p.get().undoDepth).toBe(0);
    p.actions.load(art);
    expect(p.get().art).toBe(art);
    expect(p.get().threadId).toBe(RED.id);
  });
});
