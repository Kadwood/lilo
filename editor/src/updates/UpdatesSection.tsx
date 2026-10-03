import "./updates.css";
import { Section } from "../link/components/ui";
import { useOptionalUpdates, useUpdateState, type Updates } from "./updates";

/** Settings > Updates: the automatic-check switch and "Check for updates now". */
export function UpdatesSection({ version }: { version?: string }) {
  const updates = useOptionalUpdates();
  return updates ? <Inner updates={updates} version={version} /> : null;
}

function Inner({ updates, version }: { updates: Updates; version?: string }) {
  const status = useUpdateState(updates, (s) => s.status);
  const update = useUpdateState(updates, (s) => s.update);
  const error = useUpdateState(updates, (s) => s.error);
  const unavailable = useUpdateState(updates, (s) => s.unavailable);
  const auto = useUpdateState(updates, (s) => s.autoCheck);
  const installing = useUpdateState(updates, (s) => s.installing);

  let message: string | null = null;
  if (status === "checking") message = "Checking for updates…";
  else if (status === "error") message = `Couldn't check for updates: ${error ?? "unknown error"}`;
  else if (status === "unavailable") message = unavailable;
  else if (update) message = `Lilo ${update.version} is available.`;
  else if (status === "up-to-date") message = "Lilo is up to date.";

  return (
    <Section title="Updates">
      {version && <p className="dim">You have Lilo {version}.</p>}
      <label className="update-auto">
        <input type="checkbox" checked={auto} onChange={(e) => updates.setAutoCheck(e.target.checked)} />
        Automatically check for updates
      </label>
      <div className="update-check-row">
        <button type="button" onClick={() => void updates.checkNow()} disabled={status === "checking" || installing}>
          Check for updates now
        </button>
        {update && (
          <button type="button" className="primary" onClick={() => void updates.install()} disabled={installing}>
            Install and restart
          </button>
        )}
        {message && (
          <span className={status === "error" ? "update-check-msg update-banner-error" : "update-check-msg"} role="status">
            {message}
          </span>
        )}
      </div>
    </Section>
  );
}
