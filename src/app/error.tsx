"use client";

import {
  AlertTriangle,
  RefreshCw,
  Route,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";
import {
  purgeProjectState,
  readProjectStateWithStatus,
  type ProjectStatePurgeResult,
} from "@/lib/local-state";

type ClearFailureReason = Extract<
  ProjectStatePurgeResult,
  { ok: false }
>["reason"];

const CLEAR_FAILURE_MESSAGES: Record<ClearFailureReason, string> = {
  unavailable:
    "Browser storage is unavailable, so RubricTrail could not reset the local project.",
  "coordination-unavailable":
    "This browser cannot coordinate a safe reset across tabs, so RubricTrail did not delete the project. Try again in a current browser with Web Locks support.",
  "invalid-record":
    "The local project record cannot accept another safe revision, so RubricTrail refused to delete it.",
  "storage-error":
    "Browser storage failed during reset, so RubricTrail could not confirm complete deletion. Some browser data may remain; reload before trying again.",
  "intent-changed":
    "The reset request changed before deletion began, so RubricTrail kept the saved project. Reload before trying again.",
  conflict:
    "The saved project changed after this recovery page opened, so RubricTrail could not confirm complete deletion. Reload before deciding whether to reset the current saved version.",
};

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
  reloadPage?: () => void;
}

export default function ErrorPage({
  reset,
  reloadPage = () => window.location.reload(),
}: ErrorPageProps) {
  const [observedBaseline] = useState(
    () => readProjectStateWithStatus().baseline,
  );
  const [isResetting, setIsResetting] = useState(false);
  const resetActive = useRef(false);

  async function handleResetLocalProject() {
    if (resetActive.current) return;
    if (
      !window.confirm(
        "Permanently reset this browser’s RubricTrail project? This removes saved draft excerpts, self-checks and task progress and cannot be undone.",
      )
    ) {
      return;
    }

    resetActive.current = true;
    setIsResetting(true);
    let shouldReload = false;
    try {
      const result = await purgeProjectState(observedBaseline);
      if (result.ok) {
        shouldReload = true;
      } else {
        window.alert(CLEAR_FAILURE_MESSAGES[result.reason]);
      }
    } catch {
      window.alert(CLEAR_FAILURE_MESSAGES["storage-error"]);
    } finally {
      resetActive.current = false;
      setIsResetting(false);
    }

    if (shouldReload) reloadPage();
  }

  return (
    <main className="welcome-shell" id="main-content">
      <header className="welcome-header">
        <a className="brand-lockup" href="#main-content" aria-label="RubricTrail recovery">
          <span className="brand-mark" aria-hidden="true"><Route /></span>
          <span>RubricTrail</span>
        </a>
        <div className="mode-indicator">
          <span aria-hidden="true" />
          Recovery
        </div>
      </header>

      <section className="welcome-grid" aria-labelledby="error-title">
        <div className="welcome-copy">
          <p className="eyebrow">Local recovery</p>
          <h1 id="error-title">RubricTrail couldn’t load this page.</h1>
          <p className="welcome-lede">
            Try the page again first. If the error returns, you can reset the
            project saved in this browser and start from a clean local state.
          </p>
        </div>

        <div className="welcome-workbench">
          <div className="workbench-heading">
            <div>
              <p className="eyebrow">What happened</p>
              <h2>This view needs recovery</h2>
            </div>
            <AlertTriangle aria-hidden="true" />
          </div>

          <div className="inline-alert warning" role="alert">
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong>Saved data may be damaged.</strong>
              <span>
                The local project state or page data for this view may be
                incomplete or corrupted.
              </span>
            </div>
          </div>

          <div className="integrity-note compact privacy-row">
            <ShieldCheck aria-hidden="true" />
            <p>
              <strong>This recovery page does not delete data automatically.</strong>{" "}
              “Try again” keeps the local project. Reset only if the error
              continues; resetting removes this browser’s saved RubricTrail
              project.
            </p>
          </div>

          <div className="summary-actions" aria-busy={isResetting}>
            <button
              className="button button-secondary button-large"
              type="button"
              onClick={handleResetLocalProject}
              disabled={isResetting}
              aria-busy={isResetting}
            >
              <Trash2 aria-hidden="true" />
              {isResetting ? "Resetting local project…" : "Reset local project"}
            </button>
            <button
              className="button button-primary button-large"
              type="button"
              onClick={reset}
              disabled={isResetting}
            >
              <RefreshCw aria-hidden="true" />
              Try again
            </button>
          </div>
        </div>
      </section>

      <footer className="welcome-footer">
        <span>Local-first recovery</span>
        <span>No automatic deletion from this recovery page</span>
      </footer>
    </main>
  );
}
