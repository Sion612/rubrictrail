"use client";

import { useEffect, useRef } from "react";
import { FileText, MapPin, Quote, X } from "lucide-react";
import { useLocalizedMessages } from "@/components/locale-provider";
import { workspaceEn, workspaceZhCN } from "@/lib/i18n/messages/workspace";
import type { UploadedProject } from "@/lib/ui-types";

interface UploadedEvidencePanelProps {
  project: UploadedProject;
  criterionId: string | null;
  onClose: () => void;
}

export function UploadedEvidencePanel({
  project,
  criterionId,
  onClose,
}: UploadedEvidencePanelProps) {
  const messages = useLocalizedMessages(workspaceEn, workspaceZhCN);
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!criterionId) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      previous?.focus({ preventScroll: true });
    };
  }, [criterionId]);

  if (!criterionId) return null;
  const criterion = project.criteria.find((item) => item.id === criterionId);
  const evidence = criterion?.evidence;
  const manualLocator = criterion?.manualSourceLocator ?? null;

  return (
    <div className="evidence-panel-shell">
      <button
        type="button"
        className="evidence-panel-shell__backdrop"
        aria-label={messages.closeEvidencePanel}
        onClick={onClose}
      />
      <aside
        ref={panelRef}
        className="evidence-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="uploaded-evidence-title"
      >
        <header className="evidence-panel__header">
          <div className="evidence-panel__heading-group">
            <span className="evidence-panel__eyebrow">{messages.sourceEvidence}</span>
            <h2 id="uploaded-evidence-title" className="evidence-panel__title">
              {criterion?.name ?? messages.evidenceUnavailable}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="evidence-panel__close"
            aria-label={messages.closeEvidencePanel}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="evidence-panel__body">
          <div className="evidence-panel__source-meta">
            <span className="evidence-panel__source-kind">
              <FileText aria-hidden="true" />
              {evidence
                ? (evidence.origin === "ocr"
                    ? messages.ocrRecordedSource
                    : messages.recordedSource
                  ).replace(
                    "{name}",
                    evidence.fileName ?? messages.sourceDocument,
                  )
                : messages.manuallyAdded}
            </span>
            {!evidence && manualLocator ? (
              <span className="evidence-panel__source-kind">
                <FileText aria-hidden="true" />
                {messages.recordedSource.replace("{name}", manualLocator.fileName)}
              </span>
            ) : null}
            <span className="evidence-panel__locator">
              <MapPin aria-hidden="true" />
              {evidence?.page ?? manualLocator?.page
                ? messages.recordedPage.replace(
                    "{number}",
                    String(evidence?.page ?? manualLocator?.page),
                  )
                : messages.pageUnavailable}
            </span>
          </div>

          <section className="evidence-panel__section" aria-labelledby="uploaded-excerpt-title">
            <div className="evidence-panel__section-heading">
              <Quote aria-hidden="true" />
              <h3 id="uploaded-excerpt-title">
                {evidence?.origin === "ocr"
                  ? messages.ocrRetainedExcerpt
                  : evidence
                    ? messages.retainedExcerpt
                    : messages.noRetainedExcerpt}
              </h3>
            </div>
            {evidence ? (
              <blockquote className="evidence-panel__quote">{evidence.excerpt}</blockquote>
            ) : (
              <p className="evidence-panel__explanation">
                {messages.manualCriterionDescription}
              </p>
            )}
          </section>

          <section className="evidence-panel__section" aria-labelledby="local-retention-title">
            <h3 id="local-retention-title">{messages.whatIsRetained}</h3>
            <p className="evidence-panel__explanation">
              {evidence
                ? messages.retentionDescription
                : messages.manualRetentionDescription}
            </p>
          </section>
        </div>
      </aside>
    </div>
  );
}
