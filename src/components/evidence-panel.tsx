"use client";

import { useEffect, useRef } from "react";
import { FileText, MapPin, Quote, X } from "lucide-react";

import type { AssignmentAnalysis } from "@/lib/domain";

interface EvidencePanelProps {
  analysis: AssignmentAnalysis;
  evidenceId: string | null;
  onClose(): void;
}

interface SourceContext {
  before: string;
  match: string;
  after: string;
}

function formatLocator(locator: AssignmentAnalysis["evidence"][number]["locator"]): string {
  const parts: string[] = [];

  if (locator.page) parts.push(`Page ${locator.page}`);
  if (locator.section) parts.push(locator.section);
  if (locator.paragraph) parts.push(`Paragraph ${locator.paragraph}`);

  return parts.length > 0 ? parts.join(" · ") : "Location not specified";
}

function findSourceContext(content: string, excerpt: string): SourceContext | null {
  const matchIndex = content.indexOf(excerpt);
  if (matchIndex < 0) return null;

  const contextRadius = 220;
  const start = Math.max(0, matchIndex - contextRadius);
  const end = Math.min(content.length, matchIndex + excerpt.length + contextRadius);

  return {
    before: `${start > 0 ? "…" : ""}${content.slice(start, matchIndex)}`,
    match: excerpt,
    after: `${content.slice(matchIndex + excerpt.length, end)}${
      end < content.length ? "…" : ""
    }`,
  };
}

export function EvidencePanel({ analysis, evidenceId, onClose }: EvidencePanelProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!evidenceId) return;

    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButtonRef.current?.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus({ preventScroll: true });
    };
  }, [evidenceId]);

  if (!evidenceId) return null;

  const evidence = analysis.evidence.find((item) => item.id === evidenceId);
  const sourceDocument = evidence
    ? analysis.sourceDocuments.find((item) => item.id === evidence.documentId)
    : undefined;
  const context = evidence && sourceDocument
    ? findSourceContext(sourceDocument.content, evidence.excerpt)
    : null;

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
        aria-labelledby="evidence-panel-title"
      >
        <header className="evidence-panel__header">
          <div className="evidence-panel__heading-group">
            <span className="evidence-panel__eyebrow">Source evidence</span>
            <h2 id="evidence-panel-title" className="evidence-panel__title">
              {sourceDocument?.name ?? "Evidence unavailable"}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="evidence-panel__close"
            aria-label="Close evidence panel"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        {!evidence ? (
          <div className="evidence-panel__empty" role="status">
            <FileText aria-hidden="true" />
            <h3>Evidence link not found</h3>
            <p>This finding no longer matches an evidence item in the assignment analysis.</p>
          </div>
        ) : (
          <div className="evidence-panel__body">
            <div className="evidence-panel__source-meta">
              <span className="evidence-panel__source-kind">
                <FileText aria-hidden="true" />
                {sourceDocument?.kind.replaceAll("_", " ") ?? "source document"}
              </span>
              <span className="evidence-panel__locator">
                <MapPin aria-hidden="true" />
                {formatLocator(evidence.locator)}
              </span>
            </div>

            <section className="evidence-panel__section" aria-labelledby="evidence-excerpt-title">
              <div className="evidence-panel__section-heading">
                <Quote aria-hidden="true" />
                <h3 id="evidence-excerpt-title">Exact excerpt</h3>
              </div>
              <blockquote className="evidence-panel__quote">{evidence.excerpt}</blockquote>
              <p className="evidence-panel__explanation">
                This is the original passage used to support the linked requirement or finding.
              </p>
            </section>

            {context ? (
              <section className="evidence-panel__section" aria-labelledby="evidence-context-title">
                <h3 id="evidence-context-title">In source context</h3>
                <p className="evidence-panel__context">
                  {context.before}
                  <mark>{context.match}</mark>
                  {context.after}
                </p>
              </section>
            ) : null}

            <footer className="evidence-panel__footer">
              <span>Evidence ID</span>
              <code>{evidence.id}</code>
            </footer>
          </div>
        )}
      </aside>
    </div>
  );
}
