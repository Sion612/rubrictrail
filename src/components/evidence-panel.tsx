"use client";

import { useEffect, useRef } from "react";
import { FileText, MapPin, Quote, X } from "lucide-react";

import { useLocalizedMessages } from "@/components/locale-provider";
import type { AssignmentAnalysis } from "@/lib/domain";
import { workspaceEn, workspaceZhCN } from "@/lib/i18n/messages/workspace";

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

type WorkspaceMessages = Record<keyof typeof workspaceEn, string>;

function withValue(template: string, key: "name" | "number", value: string | number) {
  return template.replace(`{${key}}`, String(value));
}

function formatLocator(
  locator: AssignmentAnalysis["evidence"][number]["locator"],
  messages: WorkspaceMessages,
): string {
  const parts: string[] = [];

  if (locator.page) parts.push(withValue(messages.page, "number", locator.page));
  if (locator.section) parts.push(locator.section);
  if (locator.paragraph) {
    parts.push(withValue(messages.paragraph, "number", locator.paragraph));
  }

  return parts.length > 0 ? parts.join(" · ") : messages.locationUnspecified;
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
  const messages = useLocalizedMessages(workspaceEn, workspaceZhCN);
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
  const sourceKind = sourceDocument
    ? {
        brief: messages.sourceKindBrief,
        rubric: messages.sourceKindRubric,
        case: messages.sourceKindCase,
        student_draft: messages.sourceKindStudentDraft,
      }[sourceDocument.kind]
    : messages.sourceDocument;

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
        aria-labelledby="evidence-panel-title"
      >
        <header className="evidence-panel__header">
          <div className="evidence-panel__heading-group">
            <span className="evidence-panel__eyebrow">{messages.sourceEvidence}</span>
            <h2 id="evidence-panel-title" className="evidence-panel__title">
              {sourceDocument?.name ?? messages.evidenceUnavailable}
            </h2>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            className="evidence-panel__close"
            aria-label={messages.closeEvidencePanel}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>

        {!evidence ? (
          <div className="evidence-panel__empty" role="status">
            <FileText aria-hidden="true" />
            <h3>{messages.evidenceLinkMissing}</h3>
            <p>{messages.evidenceLinkMissingDescription}</p>
          </div>
        ) : (
          <div className="evidence-panel__body">
            <div className="evidence-panel__source-meta">
              <span className="evidence-panel__source-kind">
                <FileText aria-hidden="true" />
                {sourceKind}
              </span>
              <span className="evidence-panel__locator">
                <MapPin aria-hidden="true" />
                {formatLocator(evidence.locator, messages)}
              </span>
            </div>

            <section className="evidence-panel__section" aria-labelledby="evidence-excerpt-title">
              <div className="evidence-panel__section-heading">
                <Quote aria-hidden="true" />
                <h3 id="evidence-excerpt-title">{messages.exactExcerpt}</h3>
              </div>
              <blockquote className="evidence-panel__quote">{evidence.excerpt}</blockquote>
              <p className="evidence-panel__explanation">
                {messages.exactExcerptDescription}
              </p>
            </section>

            {context ? (
              <section className="evidence-panel__section" aria-labelledby="evidence-context-title">
                <h3 id="evidence-context-title">{messages.inSourceContext}</h3>
                <p className="evidence-panel__context">
                  {context.before}
                  <mark>{context.match}</mark>
                  {context.after}
                </p>
              </section>
            ) : null}

            <footer className="evidence-panel__footer">
              <span>{messages.evidenceId}</span>
              <code>{evidence.id}</code>
            </footer>
          </div>
        )}
      </aside>
    </div>
  );
}
