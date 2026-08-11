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
    <section
      className="storage-conflict-banner"
      role="alert"
      aria-labelledby={titleId}
      aria-describedby={`${descriptionId} ${warningId}`}
    >
      <AlertTriangle aria-hidden="true" />
      <div className="storage-conflict-banner__copy">
        <h2 id={titleId}>Project changed in another tab</h2>
        <p id={descriptionId}>
          {isIntake
            ? "A project saved in this browser changed in another tab. Automatic project writes are paused."
            : "Autosave is paused because this project changed in another tab. Choose which version to keep."}
        </p>
        <p className="storage-conflict-banner__warning" id={warningId}>
          {isIntake
            ? "File or pasted-text intake is not part of a saved project yet. Finish creating it below, or discard the intake and load the saved version."
            : "Keep this tab makes its contents the active saved project. Download this tab first if you may need either version."}
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
            Download this tab
          </button>
        ) : null}
        <button
          className="button button-primary"
          type="button"
          onClick={onLoadSavedVersion}
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
            Keep this tab
          </button>
        ) : null}
      </div>
    </section>
  );
}
