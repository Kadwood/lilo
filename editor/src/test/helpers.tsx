import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import {
  DEFAULT_FILL_PARAMS,
  DEFAULT_HOOP,
  DEFAULT_RUN_PARAMS,
  DEFAULT_SATIN_PARAMS,
  emptyDesign,
  getCatalogue,
  toDesignThread,
  type Design,
  type Pt,
} from "@lilo/engine/light";
import { createInlineEngine, type EngineClient } from "../engine/client";
import { EngineProvider } from "../engine/context";
import { AppContext, type AppApi } from "../app/AppContext";
import { ProjectProvider } from "../project/ProjectProvider";
import { EditorProvider, useEditor } from "../state/store";

const cat = getCatalogue().threads;
export const BLUE = toDesignThread(cat.find((t) => t.name === "Blue")!);
export const RED = toDesignThread(cat.find((t) => t.name === "Red")!);

const rect = (x: number, y: number, w: number, h: number): Pt[] => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];

/** A tiny design: blue fill with a hole, blue run, red satin bar (2 colour blocks, 3 objects). */
export function testDesign(): Design {
  const d = emptyDesign(DEFAULT_HOOP);
  d.threads = [BLUE, RED];
  d.objects = [
    { id: "f1", name: "Frame", kind: "fill", threadId: BLUE.id, geometry: { shell: rect(-15, -10, 30, 20), holes: [rect(-8, -4, 16, 8)] }, params: DEFAULT_FILL_PARAMS },
    { id: "r1", name: "Line", kind: "run", threadId: BLUE.id, geometry: { path: [[-14, 14], [14, 14]], closed: false }, params: DEFAULT_RUN_PARAMS },
    {
      id: "s1",
      name: "Bar",
      kind: "satin",
      threadId: RED.id,
      geometry: { strip: [[-12, 18], [-12, 21], [-4, 18], [-4, 21], [4, 18], [4, 21], [12, 18], [12, 21]] },
      params: { ...DEFAULT_SATIN_PARAMS, widthMm: 3 },
    },
  ];
  return d;
}

/** Exposes the editor store to a test. */
export let lastEditor: ReturnType<typeof useEditor> | null = null;
function Probe() {
  lastEditor = useEditor();
  return null;
}

/** Render `ui` inside the engine (in-thread) and editor providers, optionally preloaded with a design. */
export function renderEditor(ui: ReactElement, opts: { design?: Design; engine?: EngineClient; app?: AppApi } = {}) {
  const tree = (
    <EngineProvider engine={opts.engine ?? createInlineEngine()}>
      <EditorProvider initialDesign={opts.design}>
        <ProjectProvider>
          <Probe />
          {ui}
        </ProjectProvider>
      </EditorProvider>
    </EngineProvider>
  );
  return render(opts.app ? <AppContext.Provider value={opts.app}>{tree}</AppContext.Provider> : tree);
}
