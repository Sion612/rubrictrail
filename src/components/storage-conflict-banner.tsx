"use client";

import { useId } from "react";
import { AlertTriangle, Check, Download, RotateCcw } from "lucide-react";
import { useLocalizedMessages } from "@/components/locale-provider";
import { workspaceEn, workspaceZhCN } from "@/lib/i18n/messages/workspace";

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
  const messages = useLocalizedMessages(workspaceEn, workspaceZhCN);
  const titleId = useId();
  const descriptionId = useId();
  const warningId = useId();
  const isIntake = context === "intake";

  return (
    <>
      <span className="visually-hidden" role="alert" aria-atomic="true">
        {messages.conflictAlert}
      </span>
      <section
        className="storage-conflict-banner"
        role="region"
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId} ${warningId}`}
      >
        <AlertTriangle aria-hidden="true" />
        <div className="storage-conflict-banner__copy">
          <h2 id={titleId}>{messages.conflictTitle}</h2>
          <p id={descriptionId}>
            {isIntake
              ? messages.conflictIntakeDescription
              : messages.conflictProjectDescription}
          </p>
          <p className="storage-conflict-banner__warning" id={warningId}>
            {isIntake
              ? messages.conflictIntakeWarning
              : messages.conflictProjectWarning}
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
              {messages.downloadThisTab}
            </button>
          ) : null}
          <button
            className="button button-primary"
            type="button"
            onClick={onLoadSavedVersion}
            aria-describedby={warningId}
          >
            <RotateCcw aria-hidden="true" />
            {isIntake ? messages.discardIntake : messages.loadSaved}
          </button>
          {!isIntake ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={onKeepThisTab}
              aria-describedby={warningId}
            >
              <Check aria-hidden="true" />
              {messages.replaceSaved}
            </button>
          ) : null}
        </div>
      </section>
    </>
  );
}
