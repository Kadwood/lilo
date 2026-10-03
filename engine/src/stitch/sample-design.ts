import {
  DEFAULT_FILL_PARAMS,
  DEFAULT_HOOP,
  DEFAULT_RUN_PARAMS,
  DEFAULT_SATIN_PARAMS,
  emptyDesign,
  type Design,
  type Pt,
} from "../model";
import { getCatalogue, toDesignThread } from "../threads";

/** A small three-object design (holed fill, satin bar, run line) used by several test files. */
const cat = getCatalogue().threads;
const blue = toDesignThread(cat.find((t) => t.name === "Blue")!);
const red = toDesignThread(cat.find((t) => t.name === "Red")!);

const rect = (x: number, y: number, w: number, h: number): Pt[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

export function sampleDesign(): Design {
  const d = emptyDesign(DEFAULT_HOOP);
  d.threads = [blue, red];
  d.objects = [
    {
      id: "f1",
      name: "Frame",
      kind: "fill",
      threadId: blue.id,
      geometry: { shell: rect(-15, -10, 30, 20), holes: [rect(-8, -4, 16, 8)] },
      params: DEFAULT_FILL_PARAMS,
    },
    {
      id: "s1",
      name: "Bar",
      kind: "satin",
      threadId: red.id,
      geometry: {
        strip: [
          [-12, 14],
          [-12, 17],
          [-4, 14],
          [-4, 17],
          [4, 14],
          [4, 17],
          [12, 14],
          [12, 17],
        ],
      },
      params: { ...DEFAULT_SATIN_PARAMS, widthMm: 3 },
    },
    {
      id: "r1",
      name: "Line",
      kind: "run",
      threadId: red.id,
      geometry: { path: [[-12, 20], [12, 20]], closed: false },
      params: DEFAULT_RUN_PARAMS,
    },
  ];
  return d;
}

