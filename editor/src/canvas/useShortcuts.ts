import { useEffect } from "react";
import { useEditorActions } from "../state/store";
import { toolForKey } from "../tools/registry";
import type { CanvasController } from "./controller";

const isTyping = (t: EventTarget | null): boolean => t instanceof HTMLElement && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);

/**
 * Editor keyboard shortcuts: undo/redo, select all, duplicate, ⌘K, tool letters, map to path, and
 * the per-tool keys (Enter, Esc, Backspace, arrows) that the canvas controller handles.
 */
export function useShortcuts(controller: CanvasController): void {
  const { api, actions } = useEditorActions();
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const s = api.getState();
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === "k") {
        e.preventDefault();
        actions.setPaletteOpen(!s.paletteOpen);
        return;
      }
      if (s.paletteOpen || s.dialog || isTyping(e.target)) return;
      if (e.code === "Space") {
        // Space pans, except where it activates a focused button or tab
        if (e.target instanceof HTMLElement && e.target.closest("button, [role=button], [role=tab], summary, a")) return;
        controller.setSpace(true);
        e.preventDefault();
        return;
      }
      if (mod) {
        if (k === "z") {
          e.preventDefault();
          if (e.shiftKey) actions.redo();
          else actions.undo();
        } else if (k === "y") {
          e.preventDefault();
          actions.redo();
        } else if (k === "a") {
          e.preventDefault();
          actions.selectAll();
        } else if (k === "d") {
          e.preventDefault();
          actions.duplicateSelection();
        } else if (k === "0") {
          // Actual size: the canvas owns the view, so ask it by event (like "fit")
          e.preventDefault();
          window.dispatchEvent(new Event("lilo:actual-size"));
        }
        return;
      }
      if (e.altKey) return;
      if (controller.key({ key: e.key, shift: e.shiftKey, ctrl: e.ctrlKey, meta: e.metaKey, alt: e.altKey })) {
        e.preventDefault();
        return;
      }
      if (k === "p") {
        actions.openMapDraft();
        return;
      }
      const tool = toolForKey(e.key);
      if (tool) actions.setTool(tool);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") controller.setSpace(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [api, actions, controller]);
}
