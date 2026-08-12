"use client";

import { useId } from "react";
import { AlertTriangle, Download } from "lucide-react";

export interface PersistenceUnavailableBannerProps {
  onDownloadBackup: () => void;
}

export function PersistenceUnavailableBanner({
  onDownloadBackup,
}: PersistenceUnavailableBannerProps) {
  const titleId = useId();
  const descriptionId = useId();
  const warningId = useId();

  return (
    <>
      <span className="visually-hidden" role="status" aria-atomic="true">
        Browser saving is unavailable. Download a project backup before closing this tab.
      </span>
      <section
        className="storage-conflict-banner persistence-unavailable-banner"
        role="region"
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId} ${warningId}`}
      >
        <AlertTriangle aria-hidden="true" />
        <div className="storage-conflict-banner__copy">
          <h2 id={titleId}>Browser saving is unavailable</h2>
          <p id={descriptionId}>
            RubricTrail cannot safely write this project in this browser. New changes remain only in this tab.
          </p>
          <p className="storage-conflict-banner__warning" id={warningId}>
            Download a backup before refreshing or closing this tab. Keep the JSON file private because it can contain notes and short excerpts.
          </p>
        </div>
        <div className="storage-conflict-banner__actions">
          <button
            className="button button-primary"
            type="button"
            onClick={onDownloadBackup}
          >
            <Download aria-hidden="true" />
            Download project backup
          </button>
        </div>
      </section>
    </>
  );
}
