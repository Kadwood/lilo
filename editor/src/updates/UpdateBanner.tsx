import "./updates.css";
import { getPlatform } from "../platform";
import { useOptionalUpdates, useUpdateState, type Updates } from "./updates";

export const RELEASES_URL = "https://github.com/Kadwood/lilo/releases";
export const releaseUrl = (version: string): string => `${RELEASES_URL}/tag/v${version}`;

/**
 * "Lilo 1.0.1 is available — What's new · Install and restart". A thin bar under the nav, never a
 * modal: the user keeps working until they choose to install.
 */
export function UpdateBanner() {
  const updates = useOptionalUpdates();
  return updates ? <Banner updates={updates} /> : null;
}

function Banner({ updates }: { updates: Updates }) {
  const update = useUpdateState(updates, (s) => s.update);
  const dismissed = useUpdateState(updates, (s) => s.dismissedVersion);
  const installing = useUpdateState(updates, (s) => s.installing);
  const progress = useUpdateState(updates, (s) => s.progress);
  const error = useUpdateState(updates, (s) => s.error);

  if (!update || (dismissed === update.version && !installing && !error)) return null;
  const name = `Lilo ${update.version}`;

  if (installing) {
    return (
      <div className="update-banner" role="status">
        <span>
          {progress === null ? `Downloading ${name}…` : progress >= 1 ? `Installing ${name}…` : `Downloading ${name}… ${Math.round(progress * 100)}%`}
        </span>
      </div>
    );
  }

  return (
    <div className="update-banner" role="status">
      {error ? (
        <span className="update-banner-error">{error}</span>
      ) : (
        <span>
          <strong>{name}</strong> is available
        </span>
      )}
      <span className="update-banner-sep" aria-hidden="true">
        —
      </span>
      <button type="button" className="link" onClick={() => void getPlatform().openUrl(releaseUrl(update.version))}>
        What&apos;s new
      </button>
      <span className="update-banner-sep" aria-hidden="true">
        ·
      </span>
      <button type="button" className="primary" onClick={() => void updates.install()}>
        {error ? "Try again" : "Install and restart"}
      </button>
      <span className="spacer" />
      <button type="button" className="update-banner-close" aria-label="Dismiss" title="Dismiss" onClick={() => updates.dismiss()}>
        ×
      </button>
    </div>
  );
}
