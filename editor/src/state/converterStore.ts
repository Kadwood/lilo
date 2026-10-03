import { useStore } from "zustand";
import { createStore } from "zustand/vanilla";
import type { AutoDigitizeOptions } from "@lilo/engine";
import type { EngineClient } from "../engine/client";
import { classifyInput, convertInput, uniqueNames, type ConvKind, type ConvOutput, type ConvTarget } from "./converter";

export interface ConvItem {
  id: string;
  name: string;
  bytes: Uint8Array;
  kind: ConvKind;
  status: "ready" | "working" | "done" | "error";
  error?: string;
  outputs: ConvOutput[];
}

export interface ConverterState {
  items: ConvItem[];
  targets: ConvTarget[];
  running: boolean;
}

export const converterStore = createStore<ConverterState>(() => ({ items: [], targets: ["pes"], running: false }));

let seq = 0;

export const converter = {
  /** Add dropped or picked files. Unreadable kinds are listed with a message rather than ignored. */
  add(files: { name: string; bytes: Uint8Array }[]) {
    const items = files.map<ConvItem>((f) => {
      const kind = classifyInput(f.name);
      return {
        id: `c${++seq}`,
        name: f.name,
        bytes: f.bytes,
        kind,
        status: kind === "unknown" ? "error" : "ready",
        error: kind === "unknown" ? "Lilo can't read this kind of file." : undefined,
        outputs: [],
      };
    });
    converterStore.setState((s) => ({ items: [...s.items, ...items] }));
  },
  remove(id: string) {
    converterStore.setState((s) => ({ items: s.items.filter((i) => i.id !== id) }));
  },
  clear() {
    converterStore.setState({ items: [] });
  },
  toggleTarget(t: ConvTarget) {
    converterStore.setState((s) => ({ targets: s.targets.includes(t) ? s.targets.filter((x) => x !== t) : [...s.targets, t] }));
  },
  /** Convert every ready item to the chosen targets, one after another. */
  async run(engine: EngineClient, options: Partial<AutoDigitizeOptions>) {
    if (converterStore.getState().running) return;
    converterStore.setState({ running: true });
    const patch = (id: string, p: Partial<ConvItem>) => converterStore.setState((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...p } : i)) }));
    try {
      for (const item of converterStore.getState().items) {
        if (item.kind === "unknown") continue;
        const targets = converterStore.getState().targets;
        patch(item.id, { status: "working", error: undefined, outputs: [] });
        try {
          const outputs = await convertInput(engine, item, targets, options);
          patch(item.id, { status: "done", outputs });
        } catch (e) {
          patch(item.id, { status: "error", error: e instanceof Error ? e.message : String(e) });
        }
      }
      // two inputs can share a stem: keep the saved names apart
      const all = converterStore.getState().items.flatMap((i) => i.outputs);
      const renamed = new Map(uniqueNames(all).map((o, k) => [all[k], o.name]));
      converterStore.setState((s) => ({ items: s.items.map((i) => ({ ...i, outputs: i.outputs.map((o) => ({ ...o, name: renamed.get(o) ?? o.name })) })) }));
    } finally {
      converterStore.setState({ running: false });
    }
  },
  reset() {
    converterStore.setState({ items: [], targets: ["pes"], running: false });
  },
};

export function useConverter(): ConverterState {
  return useStore(converterStore);
}
