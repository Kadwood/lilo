import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";
import { createInlineEngine, createWorkerEngine, type EngineClient } from "./client";

const EngineContext = createContext<EngineClient | null>(null);

/** Provides the engine. Pass `engine` to inject one (tests); otherwise a Web Worker is created. */
export function EngineProvider({ engine, children }: { engine?: EngineClient; children: ReactNode }) {
  const client = useMemo(
    () => engine ?? (typeof Worker !== "undefined" ? createWorkerEngine() : createInlineEngine()),
    [engine],
  );
  // The worker engine re-creates its Worker on demand, so disposing in cleanup is StrictMode-safe.
  useEffect(() => () => (engine ? undefined : client.dispose()), [client, engine]);
  return <EngineContext.Provider value={client}>{children}</EngineContext.Provider>;
}

export function useEngine(): EngineClient {
  const c = useContext(EngineContext);
  if (!c) throw new Error("useEngine must be used inside <EngineProvider>");
  return c;
}
