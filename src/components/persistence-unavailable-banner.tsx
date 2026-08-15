"use client";

import { useId } from "react";
import { AlertTriangle, Download } from "lucide-react";
import { useLocalizedMessages } from "@/components/locale-provider";
import { workspaceEn, workspaceZhCN } from "@/lib/i18n/messages/workspace";

export interface PersistenceUnavailableBannerProps {
  onDownloadBackup: () => void;
}

export function PersistenceUnavailableBanner({
  onDownloadBackup,
}: PersistenceUnavailableBannerProps) {
  const messages = useLocalizedMessages(workspaceEn, workspaceZhCN);
  const titleId = useId();
  const descriptionId = useId();
  const warningId = useId();

  return (
    <>
      <span className="visually-hidden" role="status" aria-atomic="true">
        {messages.persistenceStatus}
      </span>
      <section
        className="storage-conflict-banner persistence-unavailable-banner"
        role="region"
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId} ${warningId}`}
      >
        <AlertTriangle aria-hidden="true" />
        <div className="storage-conflict-banner__copy">
          <h2 id={titleId}>{messages.persistenceTitle}</h2>
          <p id={descriptionId}>
            {messages.persistenceDescription}
          </p>
          <p className="storage-conflict-banner__warning" id={warningId}>
            {messages.persistenceWarning}
          </p>
        </div>
        <div className="storage-conflict-banner__actions">
          <button
            className="button button-primary"
            type="button"
            onClick={onDownloadBackup}
          >
            <Download aria-hidden="true" />
            {messages.downloadProjectBackup}
          </button>
        </div>
      </section>
    </>
  );
}
