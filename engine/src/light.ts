/**
 * The parts of the engine that are cheap to load: the design model, colour maths, thread catalogues
 * and the stitch-plan types/helpers. No stitchjs, no WASM. The editor's main thread imports this;
 * the heavy engine (`@lilo/engine`) only runs inside the Web Worker.
 */
export * from "./model";
export * from "./color";
export * from "./threads";
export * from "./stitch/plan";
export { PEC_PALETTE, nearestPecIndex, pecColor, type PecColor } from "./pes/pec-palette";
export type { Origin } from "./pes/write";
export * from "./threads/shelf";
export * from "./threads/label";
export * from "./pixelart/grid";
export * from "./pixelart/import";
export * from "./clickstitch";
export * from "./project/types";
export {
  createProject,
  addHistorySnapshot,
  historyDoc,
  restoreHistory,
  addImage,
  addFont,
  MAX_FONT_BYTES,
  removeImage,
  saveProject,
  loadProject,
  readProjectInfo,
  recoverHistory,
  contentHash,
  hashString,
  type NewProjectOptions,
  type ProjectInfo,
} from "./project/file";
export { migrateProjectDoc } from "./project/migrate";
export { encodePngRgba, planThumbnailPng, type ThumbnailOptions } from "./project/png";
export * from "./formats/types";
