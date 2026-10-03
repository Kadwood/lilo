export * from "./types";
export { parseFont, decodeCoords, fontHeightRange } from "./font";
export { railsToStrip, stripWidths } from "./satin";
export {
  customTypeface,
  loadCustomFont,
  listFaces,
  collectionSize,
  isCollection,
  extractCollectionFace,
  initLettering,
  outlineElements,
  partElements,
  CUSTOM_MIN_HEIGHT_MM,
  type CustomFont,
} from "./custom";
export {
  layoutText,
  builtinTypeface,
  type LayoutOptions,
  type LayoutResult,
  type LetteringWarning,
  type PathGuide,
  type PlacedElement,
  type PlacedGlyph,
  type ShapeContext,
  type TextAlign,
  type Typeface,
} from "./layout";
