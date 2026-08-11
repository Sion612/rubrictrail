"use client";

import { useEffect, useRef } from "react";
import { FileText, MapPin, Quote, X } from "lucide-react";
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

  return (
    <div className="evidence-panel-shell">
      <button
        type="button"
        className="evidence-panel-shell__backdrop"
        aria-label="Close evidence panel"
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
            <span className="evidence-panel__eyebrow">Source evidence</span>
            <h2 id="uploaded-evidence-title" className="evidence-panel__title">
              {criterion?.name ?? "Evidence unavailable"}
            </h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="evidence-panel__close"
            aria-label="Close evidence panel"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        <div className="evidence-panel__body">
          <div className="evidence-panel__source-meta">
            <span className="evidence-panel__source-kind">
              <FileText aria-hidden="true" />{evidence?.fileName ?? "Manually added"}
            </span>
            <span className="evidence-panel__locator">
              <MapPin aria-hidden="true" />
              {evidence?.page ? `Page ${evidence.page}` : "Page not available"}
            </span>
          </div>

          <section className="evidence-panel__section" aria-labelledby="uploaded-excerpt-title">
            <div className="evidence-panel__section-heading">
              <Quote aria-hidden="true" />
              <h3 id="uploaded-excerpt-title">Exact retained excerpt</h3>
            </div>
            {evidence ? (
              <blockquote className="evidence-panel__quote">{evidence.excerpt}</blockquote>
            ) : (
              <p className="evidence-panel__explanation">
                This criterion was entered manually, so it has no source excerpt. Check it against
                the original rubric before relying on the plan.
              </p>
            )}
          </section>

          <section className="evidence-panel__section" aria-labelledby="local-retention-title">
            <h3 id="local-retention-title">What is retained</h3>
            <p className="evidence-panel__explanation">
              RubricTrail stores this short excerpt and the confirmed criterion locally. It does not
          keep the authoritative source because full source text is not retained.
            </p>
          </section>
        </div>
      </aside>
    </div>
  );
}
