import { useCallback, useEffect, useMemo, useState } from "react";
import { usePreparedPes, WarningList } from "./ExportDialog";
import { BeforeYouSew } from "../sewing/BeforeYouSew";
import { safetyNotes } from "../panels/safety";
import { Hint } from "../guide/Hint";
import { markExported } from "../guide/guideStore";
import { useEditor } from "../state/store";
import { getPlatform, type PlatformMachine, type SendProgress } from "../platform";
import type { Origin } from "@lilo/engine/light";

type Phase =
  | { kind: "idle" }
  | { kind: "sending"; progress: SendProgress | null }
  | { kind: "done"; storedAs: string | null }
  | { kind: "error"; message: string };

/** One object for good: a new `{ h, v }` on every render would make the PES be made again after each render, forever. */
const CENTRE: Origin = { h: "center", v: "center" };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Pick a saved machine and send the current design (as PES, centred) to it. */
export function SendDialog({ onClose }: { onClose: () => void }) {
  const { state } = useEditor();
  const notes = useMemo(() => safetyNotes(state.design), [state.design]);
  const label = (state.projectName.trim() || "design").replace(/[\\/:*?"<>|]+/g, "_").replace(/\.pes$/i, "");
  const { prepared, error: prepError } = usePreparedPes(CENTRE, label);
  const [machines, setMachines] = useState<PlatformMachine[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [scanning, setScanning] = useState(false);

  const show = useCallback((list: PlatformMachine[]) => {
    setMachines(list);
    setSelected((cur) => (list.some((m) => m.ip === cur) ? cur : (list[0]?.ip ?? "")));
  }, []);

  useEffect(() => {
    let alive = true;
    getPlatform()
      .savedMachines()
      .then((list) => alive && show(list))
      .catch((e) => alive && setLoadError(message(e)));
    return () => {
      alive = false;
    };
  }, [show]);

  const scan = async () => {
    setScanning(true);
    setLoadError(null);
    try {
      show(await getPlatform().discoverMachines());
    } catch (e) {
      setLoadError(message(e));
    } finally {
      setScanning(false);
    }
  };

  const send = async () => {
    if (!prepared) return;
    setPhase({ kind: "sending", progress: null });
    try {
      const result = await getPlatform().sendToMachine(selected, `${label}.pes`, prepared.pes, {
        onProgress: (progress) => setPhase({ kind: "sending", progress }),
      });
      if (result.state === "done") markExported();
      setPhase(
        result.state === "done"
          ? { kind: "done", storedAs: result.storedAs }
          : { kind: "error", message: result.error ?? `Send ended as "${result.state}"` },
      );
    } catch (e) {
      setPhase({ kind: "error", message: message(e) });
    }
  };

  const busy = phase.kind === "sending";

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="send-title">
        <h2 id="send-title">Send to machine</h2>
        <p className="muted">Sends {label}.pes{prepared ? ` (${prepared.stats.stitchCount.toLocaleString()} stitches, ${prepared.stats.colorChanges} colour changes)` : ""}. Pair and save machines under Lilo Link.</p>
        {prepError && <p className="error">{prepError}</p>}
        {prepared && <WarningList warnings={prepared.warnings} extra={notes} />}
        <BeforeYouSew />

        {loadError && <p className="error">{loadError}</p>}
        {machines && machines.length === 0 && (
          <p>No saved machines yet. Search the network, or add one under Lilo Link.</p>
        )}
        {machines && machines.length > 0 && (
          <label className="field">
            <span className="field-row">
              Machine <Hint id="send.machine" />
            </span>
            <select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={busy}>
              {machines.map((m) => (
                <option key={m.ip} value={m.ip}>
                  {m.name} ({m.ip}){m.saved ? "" : " - not saved"}
                </option>
              ))}
            </select>
          </label>
        )}

        {phase.kind === "sending" && (
          <p role="status">
            {phase.progress
              ? `${phase.progress.state}: ${phase.progress.sentBytes} / ${phase.progress.totalBytes} bytes`
              : "Starting…"}
          </p>
        )}
        {phase.kind === "done" && <p role="status">Sent{phase.storedAs ? ` as ${phase.storedAs}` : ""}.</p>}
        {phase.kind === "error" && <p className="error">{phase.message}</p>}

        <div className="dialog-actions">
          <Hint id="send.search-network" />
          <button onClick={scan} disabled={busy || scanning}>
            {scanning ? "Searching…" : "Search network"}
          </button>
          <span className="spacer" />
          <button onClick={onClose}>Close</button>
          <Hint id="send.send" />
          <button className="primary" onClick={send} disabled={busy || !selected || !prepared}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
