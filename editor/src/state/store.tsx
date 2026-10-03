import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { useStore } from "zustand";
import type { Design } from "@lilo/engine";
import { useEngine } from "../engine/context";
import { PlayerController } from "./player";
import { createEditorStore, type EditorActions, type EditorState, type EditorStore } from "./editorStore";

export {
  DEFAULT_UI_OPTIONS,
  initialState,
  toEngineOptions,
  type DigitizeUiOptions,
  type EditorActions,
  type EditorState,
  type MapDraft,
  type RefImage,
  type SeqTab,
  type ShapeMode,
  type SourceInfo,
  type Stages,
  type Status,
  type ViewToggles,
} from "./editorStore";

interface Store {
  state: EditorState;
  actions: EditorActions;
  /** Stitch-player clock and position; one per editor, fed from the current plan. */
  player: PlayerController;
  /** The underlying Zustand store, for code that reads state outside React (the canvas controller). */
  api: EditorStore["store"];
}

const StoreContext = createContext<{ core: EditorStore; player: PlayerController } | null>(null);

function useCore() {
  const c = useContext(StoreContext);
  if (!c) throw new Error("useEditor must be used inside <EditorProvider>");
  return c;
}

/** The whole editor state and its actions. Re-renders on every state change; use `useEditorSelector` for hot components. */
export function useEditor(): Store {
  const { core, player } = useCore();
  const state = useStore(core.store);
  return useMemo(() => ({ state, actions: core.actions, player, api: core.store }), [state, core, player]);
}

/** Subscribe to a slice of the state. */
export function useEditorSelector<T>(select: (s: EditorState) => T): T {
  return useStore(useCore().core.store, select);
}

/** Actions and the raw store, without subscribing to any state. */
export function useEditorActions(): { actions: EditorActions; api: EditorStore["store"]; player: PlayerController } {
  const { core, player } = useCore();
  return { actions: core.actions, api: core.store, player };
}

export function EditorProvider({ children, initialDesign }: { children: ReactNode; initialDesign?: Design }) {
  const engine = useEngine();
  const core = useMemo(() => createEditorStore(engine), [engine]);
  const player = useMemo(() => new PlayerController(), []);

  useEffect(() => () => core.dispose(), [core]);

  // Seed (tests, opening a project).
  useEffect(() => {
    if (initialDesign) void core.actions.loadDesign(initialDesign);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [core]);

  const planResult = useStore(core.store, (s) => s.planResult);
  useEffect(() => {
    player.setPlan(planResult?.plan ?? null);
  }, [player, planResult]);

  const value = useMemo(() => ({ core, player }), [core, player]);
  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}
