"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FileText, MapPin, Quote, X } from "lucide-react";
import { useLocalizedMessages } from "@/components/locale-provider";
import { workspaceEn, workspaceZhCN } from "@/lib/i18n/messages/workspace";
import { locatorEn, locatorZhCN } from "@/lib/i18n/messages/locator";
import { parseOptionalPdfPage, sourceOptionLabel } from "@/lib/source-labels";
import { manualSourceLocatorsEqual, resolveUploadedProjectSource } from "@/lib/uploaded-project";
import type { ManualSourceLocator, UploadedProject } from "@/lib/ui-types";
import styles from "./uploaded-evidence-panel.module.css";

export type ManualSourceLocatorSaveOutcome = "saved" | "tab-only" | "failed";

interface UploadedEvidencePanelProps {
  project: UploadedProject;
  criterionId: string | null;
  onClose: () => void;
  onSaveManualSourceLocator?: (
    criterionId: string,
    locator: ManualSourceLocator | null,
  ) => Promise<ManualSourceLocatorSaveOutcome>;
}

export function UploadedEvidencePanel({
  project,
  criterionId,
  onClose,
  onSaveManualSourceLocator,
}: UploadedEvidencePanelProps) {
  const workspace = useLocalizedMessages(workspaceEn, workspaceZhCN);
  const locator = useLocalizedMessages(locatorEn, locatorZhCN);
  const messages = { ...workspace, ...locator };
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const editRef = useRef<HTMLButtonElement>(null);
  const selectorRef = useRef<HTMLSelectElement>(null);
  const onCloseRef = useRef(onClose);
  const sourceSelectId = useId();
  const pageInputId = useId();
  const [editorCriterionId, setEditorCriterionId] = useState<string | null>(null);
  const editing = editorCriterionId === criterionId;
  const [sourceId, setSourceId] = useState("");
  const [pageValue, setPageValue] = useState("");
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focusTarget, setFocusTarget] = useState<"add" | "edit" | null>(null);
  const editingRef = useRef(false);
  const savingRef = useRef(false);
  const criterion = project.criteria.find((item) => item.id === criterionId);
  const evidence = criterion?.evidence ?? null;
  const manualLocator = criterion?.manualSourceLocator ?? null;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  useEffect(() => {
    if (!criterionId) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        if (editingRef.current) {
          event.preventDefault();
          event.stopPropagation();
          if (savingRef.current) return;
          setEditorCriterionId(null);
          setSourceError(null);
          setPageError(null);
          setSaveError(null);
          setFocusTarget(manualLocator ? "edit" : "add");
          return;
        }
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
  }, [criterionId, manualLocator]);

  useEffect(() => {
    if (editing) {
      selectorRef.current?.focus({ preventScroll: true });
    }
  }, [editing]);

  useEffect(() => {
    if (!focusTarget) return;
    const node = focusTarget === "add" ? addRef.current : editRef.current;
    node?.focus({ preventScroll: true });
  }, [focusTarget, editing]);

  if (!criterionId) return null;
  const evidenceSource = resolveUploadedProjectSource(project, evidence?.sourceId);
  const manualSource = resolveUploadedProjectSource(project, manualLocator?.sourceId);
  const canEditLocator = Boolean(onSaveManualSourceLocator) && evidence === null;
  const selectedSource = project.sources?.find((source) => source.id === sourceId) ?? null;
  const sourcePageDescription = (
    source: typeof evidenceSource,
    page: number | null | undefined,
    manual: boolean,
  ) => {
    if (source?.kind === "pdf") {
      if (!page) return manual ? messages.pageNotEntered : messages.pageUnavailable;
      return (manual ? messages.manuallyRecordedPage : messages.recordedPage).replace(
        "{number}",
        String(page),
      );
    }
    if (source?.intakeMethod === "paste") return messages.pastedHasNoPage;
    if (source && ["png", "jpeg", "webp"].includes(source.kind)) {
      return messages.imageHasNoPdfPage;
    }
    if (source?.kind === "txt") return messages.textHasNoPage;
    if (source?.kind === "docx") return messages.docxHasNoStablePage;
    if (page) {
      return (manual ? messages.manuallyRecordedPage : messages.recordedPage).replace(
        "{number}",
        String(page),
      );
    }
    return messages.pageUnavailable;
  };

  function startEditing() {
    setSourceId(manualLocator?.sourceId ?? "");
    setPageValue(manualLocator?.page == null ? "" : String(manualLocator.page));
    setSourceError(null);
    setPageError(null);
    setSaveError(null);
    setEditorCriterionId(criterionId);
  }

  function cancelEditing() {
    if (saving) return;
    setEditorCriterionId(null);
    setSourceError(null);
    setPageError(null);
    setSaveError(null);
    setFocusTarget(manualLocator ? "edit" : "add");
  }

  function changeSource(nextSourceId: string) {
    setSourceId(nextSourceId);
    setPageValue("");
    setSourceError(null);
    setPageError(null);
    setSaveError(null);
  }

  async function saveLocator() {
    if (!onSaveManualSourceLocator || !criterionId || saving) return;
    setSourceError(null);
    setPageError(null);
    setSaveError(null);
    if (!sourceId) {
      setSourceError(messages.locatorSourceRequired);
      selectorRef.current?.focus({ preventScroll: true });
      return;
    }
    const source = project.sources?.find((item) => item.id === sourceId);
    if (!source) {
      setSourceError(messages.locatorSourceRequired);
      selectorRef.current?.focus({ preventScroll: true });
      return;
    }
    let page: number | null = null;
    if (source.kind === "pdf") {
      const parsed = parseOptionalPdfPage(pageValue, source.pageCount);
      if (!parsed.ok) {
        setPageError(
          messages.locatorPageInvalid.replace(
            "{pages}",
            String(source.pageCount ?? ""),
          ),
        );
        return;
      }
      page = parsed.page;
    }
    const nextLocator = { sourceId, page };
    if (manualSourceLocatorsEqual(manualLocator, nextLocator)) {
      setEditorCriterionId(null);
      setFocusTarget("edit");
      return;
    }
    setSaving(true);
    try {
      const outcome = await onSaveManualSourceLocator(criterionId, nextLocator);
      if (outcome === "failed") {
        setSaveError(messages.locatorSaveFailed);
        selectorRef.current?.focus({ preventScroll: true });
        return;
      }
      setEditorCriterionId(null);
      setFocusTarget("edit");
    } finally {
      setSaving(false);
    }
  }

  async function removeLocator() {
    if (!onSaveManualSourceLocator || !criterionId || saving) return;
    const confirmed = window.confirm(messages.removeLocatorConfirm);
    if (!confirmed) {
      editRef.current?.focus({ preventScroll: true });
      return;
    }
    setSaving(true);
    try {
      const outcome = await onSaveManualSourceLocator(criterionId, null);
      if (outcome === "failed") {
        editRef.current?.focus({ preventScroll: true });
        return;
      }
      setEditorCriterionId(null);
      setFocusTarget("add");
    } finally {
      setSaving(false);
    }
  }

  const nonPdfHint = selectedSource
    ? selectedSource.kind === "pdf"
      ? null
      : selectedSource.intakeMethod === "paste"
        ? messages.pastedHasNoPage
        : ["png", "jpeg", "webp"].includes(selectedSource.kind)
          ? messages.imageHasNoPdfPage
          : selectedSource.kind === "docx"
            ? messages.docxHasNoStablePage
            : messages.textHasNoPage
    : null;

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
            {!evidence && manualLocator && manualSource ? (
              <span className="evidence-panel__source-kind">
                <FileText aria-hidden="true" />
                {messages.manuallyLinkedSource.replace("{name}", manualSource.fileName)}
              </span>
            ) : null}
            {!evidence && !manualSource ? (
              <span className="evidence-panel__source-kind">
                <FileText aria-hidden="true" />
                {messages.noSourceLinked}
              </span>
            ) : null}
            {evidence || manualSource ? (
              <span className="evidence-panel__locator">
                <MapPin aria-hidden="true" />
                {sourcePageDescription(
                  evidence ? evidenceSource : manualSource,
                  evidence?.page ?? manualLocator?.page,
                  !evidence,
                )}
              </span>
            ) : null}
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

          {canEditLocator ? (
            <section className={`evidence-panel__section ${styles.editor}`} aria-labelledby="locator-editor-title">
              <h3 id="locator-editor-title">{messages.locatorEditorTitle}</h3>
              {!project.sources?.length ? (
                <p className="evidence-panel__explanation" data-testid="legacy-registry-guidance">
                  {messages.legacyRegistryGuidance}
                </p>
              ) : editing ? (
                <form
                  className={styles.form}
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveLocator();
                  }}
                >
                  <label htmlFor={sourceSelectId}>
                    <span>{messages.locatorSourceLabel}</span>
                    <select
                      id={sourceSelectId}
                      ref={selectorRef}
                      data-testid="locator-source"
                      value={sourceId}
                      disabled={saving}
                      aria-invalid={sourceError ? true : undefined}
                      aria-describedby={sourceError ? "locator-source-error" : undefined}
                      onChange={(event) => changeSource(event.target.value)}
                    >
                      <option value="">{messages.locatorSourceNone}</option>
                      {project.sources.map((source) => (
                        <option key={source.id} value={source.id}>
                          {sourceOptionLabel(source, messages.sourceWord)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {sourceError ? (
                    <p className="field-message" id="locator-source-error" data-testid="locator-source-error">
                      {sourceError}
                    </p>
                  ) : null}
                  {selectedSource?.kind === "pdf" ? (
                    <label htmlFor={pageInputId}>
                      <span>{messages.locatorPdfPageLabel}</span>
                      <input
                        id={pageInputId}
                        data-testid="locator-page"
                        type="number"
                        min={1}
                        max={selectedSource.pageCount ?? undefined}
                        step={1}
                        value={pageValue}
                        disabled={saving}
                        onChange={(event) => {
                          setPageValue(event.target.value);
                          setPageError(null);
                        }}
                        aria-invalid={pageError ? true : undefined}
                        aria-describedby={pageError ? "locator-page-error" : "locator-page-hint"}
                      />
                      <small id="locator-page-hint">
                        {messages.locatorPdfPageHint.replace(
                          "{pages}",
                          String(selectedSource.pageCount ?? ""),
                        )}
                      </small>
                    </label>
                  ) : nonPdfHint ? (
                    <p className="evidence-panel__explanation" data-testid="locator-no-page">
                      {nonPdfHint}
                    </p>
                  ) : null}
                  {pageError ? (
                    <p className="field-message" id="locator-page-error" data-testid="locator-page-error">
                      {pageError}
                    </p>
                  ) : null}
                  {saveError ? (
                    <p className="field-message" data-testid="locator-save-error">{saveError}</p>
                  ) : null}
                  <div className={styles.actions}>
                    <button className="button button-secondary" type="button" onClick={cancelEditing} disabled={saving}>
                      {messages.locatorCancel}
                    </button>
                    <button className="button button-primary" type="submit" disabled={saving} data-testid="save-locator">
                      {messages.locatorSave}
                    </button>
                  </div>
                </form>
              ) : (
                <div className={styles.actions}>
                  {manualLocator ? (
                    <>
                      <button
                        ref={editRef}
                        className="button button-secondary"
                        type="button"
                        onClick={startEditing}
                        disabled={saving}
                        data-testid="edit-locator"
                      >
                        {messages.editSourceLocation}
                      </button>
                      <button
                        className="button button-secondary"
                        type="button"
                        onClick={() => void removeLocator()}
                        disabled={saving}
                        data-testid="remove-locator"
                      >
                        {messages.removeSourceLocation}
                      </button>
                    </>
                  ) : (
                    <button
                      ref={addRef}
                      className="button button-primary"
                      type="button"
                      onClick={startEditing}
                      disabled={saving}
                      data-testid="add-locator"
                    >
                      {messages.addSourceLocation}
                    </button>
                  )}
                </div>
              )}
            </section>
          ) : null}

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
