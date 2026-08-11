"use client";

import {
  AlertTriangle,
  RefreshCw,
  Route,
  ShieldCheck,
  Trash2,
} from "lucide-react";

const LOCAL_PROJECT_KEYS = [
  "rubrictrail.project.v2",
  "proofline.project.v1",
] as const;

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ reset }: ErrorPageProps) {
  function handleResetLocalProject() {
    if (
      !window.confirm(
        "Permanently reset this browser’s RubricTrail project? This removes saved draft excerpts, self-checks and task progress and cannot be undone.",
      )
    ) {
      return;
    }

    for (const key of LOCAL_PROJECT_KEYS) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Reload still offers recovery when browser storage is unavailable.
      }
    }

    window.location.reload();
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

          <div className="summary-actions">
            <button
              className="button button-secondary button-large"
              type="button"
              onClick={handleResetLocalProject}
            >
              <Trash2 aria-hidden="true" />
              Reset local project
            </button>
            <button
              className="button button-primary button-large"
              type="button"
              onClick={reset}
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
