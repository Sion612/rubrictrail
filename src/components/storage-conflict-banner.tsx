"use client";

import { useId } from "react";
import { AlertTriangle, Check, Download, RotateCcw } from "lucide-react";

export interface StorageConflictBannerProps {
  onDownloadThisTab: () => void;
  onLoadSavedVersion: () => void;
  onKeepThisTab: () => void;
  context?: "project" | "intake";
}

export function StorageConflictBanner({
  onDownloadThisTab,
  onLoadSavedVersion,
  onKeepThisTab,
  context = "project",
}: StorageConflictBannerProps) {
  const titleId = useId();
  const descriptionId = useId();
  const warningId = useId();
  const isIntake = context === "intake";

  return (
    <>
      <span className="visually-hidden" role="alert" aria-atomic="true">
        Autosave paused: another tab saved changes.
      </span>
      <section
        className="storage-conflict-banner"
        role="region"
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId} ${warningId}`}
      >
        <AlertTriangle aria-hidden="true" />
        <div className="storage-conflict-banner__copy">
          <h2 id={titleId}>Autosave paused: another tab saved changes</h2>
          <p id={descriptionId}>
            {isIntake
              ? "A project saved in this browser changed while this intake was open. Automatic project writes are paused."
              : "Your edits in this tab are still here, but they are not being saved while you choose which browser version to use."}
          </p>
          <p className="storage-conflict-banner__warning" id={warningId}>
            {isIntake
              ? "File or pasted-text intake is not part of a saved project yet. Finish creating it below, or discard the intake and load the saved version."
              : "Loading the saved version replaces changes kept only in this tab. Download this tab backup first if you may need both versions."}
          </p>
        </div>
        <div className="storage-conflict-banner__actions">
          {!isIntake ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={onDownloadThisTab}
            >
              <Download aria-hidden="true" />
              Download this tab backup
            </button>
          ) : null}
          <button
            className="button button-primary"
            type="button"
            onClick={onLoadSavedVersion}
            aria-describedby={warningId}
          >
            <RotateCcw aria-hidden="true" />
            {isIntake ? "Discard intake and load saved version" : "Load saved version"}
          </button>
          {!isIntake ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={onKeepThisTab}
              aria-describedby={warningId}
            >
              <Check aria-hidden="true" />
              Replace saved version with this tab
            </button>
          ) : null}
        </div>
      </section>
    </>
  );
}
