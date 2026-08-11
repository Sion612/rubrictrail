"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  FileText,
  Plus,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  createUploadedProject,
  draftFromUpload,
  validateUploadedProjectDraftIssues,
  type UploadedProjectDraftIssue,
} from "@/lib/uploaded-project";
import { assignmentFileIssueReason } from "@/lib/file-intake-messages";
import type { UploadedSummaryFieldStatus } from "@/lib/files/parse-assignment-files";
import type {
  UploadFlowResult,
  UploadedProject,
  UploadedProjectDraft,
} from "@/lib/ui-types";

interface UploadSummaryViewProps {
  result: UploadFlowResult;
  onBack: () => void;
  onCreateProject: (project: UploadedProject) => void;
}

function sourceDisplayName(value: string): string {
  return /^Pasted (?:assignment brief|rubric)\.txt$/i.test(value)
    ? value.replace(/\.txt$/i, "")
    : value;
}

function EvidenceNote({ evidence }: { evidence: UploadedProjectDraft["criteria"][number]["evidence"] }) {
  if (!evidence) return <small>No source excerpt was retained for this field.</small>;
  return (
    <details className="source-evidence-note">
      <summary>
        Source: {evidence.fileName ? sourceDisplayName(evidence.fileName) : "source text"}
        {evidence.page ? ` · page ${evidence.page}` : ""}
      </summary>
      <blockquote>{evidence.excerpt}</blockquote>
    </details>
  );
}

function FieldStatus({
  status,
  edited,
  isPasted,
}: {
  status: UploadedSummaryFieldStatus;
  edited: boolean;
  isPasted: boolean;
}) {
  if (edited) {
    return <small className="field-source-status manual">Edited manually — compare with the source excerpt</small>;
  }
  const message = {
    found: isPasted ? "Found in pasted text" : "Found in the uploaded source",
    inferred: isPasted
      ? "Inferred from pasted text — verify this"
      : "Inferred from a heading — verify this",
    missing: "Not detected — enter this manually",
  }[status];
  return <small className={`field-source-status ${status}`}>{message}</small>;
}

function FieldError({ issue }: { issue: UploadedProjectDraftIssue | undefined }) {
  if (!issue) return null;
  return (
    <small className="field-message error" id={`${issue.targetId}-error`}>
      {issue.message}
    </small>
  );
}

export function UploadSummaryView({
  result,
  onBack,
  onCreateProject,
}: UploadSummaryViewProps) {
  const initialDraft = useMemo(() => draftFromUpload(result), [result]);
  const [draft, setDraft] = useState<UploadedProjectDraft>(() => initialDraft);
  const [showErrors, setShowErrors] = useState(false);
  const criterionOriginsRef = useRef<
    Array<UploadedProjectDraft["criteria"][number] | null>
  >(
    initialDraft.criteria.map((criterion) => ({ ...criterion })),
  );
  const [criterionKeys, setCriterionKeys] = useState(
    initialDraft.criteria.map((_, index) => `detected-${index + 1}`),
  );
  const nextCriterionKeyRef = useRef(0);
  const errorSummaryRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const issues = useMemo(() => validateUploadedProjectDraftIssues(draft), [draft]);
  const issueByTarget = useMemo(() => {
    const firstIssueByTarget = new Map<string, UploadedProjectDraftIssue>();
    issues.forEach((issue) => {
      if (!firstIssueByTarget.has(issue.targetId)) {
        firstIssueByTarget.set(issue.targetId, issue);
      }
    });
    return firstIssueByTarget;
  }, [issues]);
  const totalWeight = draft.criteria.reduce(
    (total, criterion) => total + (Number(criterion.weight) || 0),
    0,
  );
  const isPasted = result.intakeMethod === "paste";
  const isPartial = result.skippedFiles.length > 0;
  const selectedFileCount = result.fileNames.length + result.skippedFiles.length;

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  function updateField<K extends keyof Omit<UploadedProjectDraft, "criteria">>(
    key: K,
    value: UploadedProjectDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateCriterion(index: number, key: "name" | "weight", value: string) {
    setDraft((current) => ({
      ...current,
      criteria: current.criteria.map((criterion, criterionIndex) => {
        if (criterionIndex !== index) return criterion;
        const nextCriterion = { ...criterion, [key]: value };
        const origin = criterionOriginsRef.current[index];
        return {
          ...nextCriterion,
          evidence:
            origin &&
            nextCriterion.name === origin.name &&
            nextCriterion.weight === origin.weight
              ? origin.evidence
              : null,
        };
      }),
    }));
  }

  function addCriterion() {
    criterionOriginsRef.current = [...criterionOriginsRef.current, null];
    nextCriterionKeyRef.current += 1;
    const nextCriterionKey = `manual-${nextCriterionKeyRef.current}`;
    setCriterionKeys((current) => [
      ...current,
      nextCriterionKey,
    ]);
    setDraft((current) => ({
      ...current,
      criteria: [...current.criteria, { name: "", weight: "", evidence: null }],
    }));
  }

  function removeCriterion(index: number) {
    criterionOriginsRef.current = criterionOriginsRef.current.filter(
      (_, criterionIndex) => criterionIndex !== index,
    );
    setCriterionKeys((current) => current.filter(
      (_, criterionIndex) => criterionIndex !== index,
    ));
    setDraft((current) => ({
      ...current,
      criteria: current.criteria.filter((_, criterionIndex) => criterionIndex !== index),
    }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setShowErrors(true);
    if (issues.length) {
      window.requestAnimationFrame(() => errorSummaryRef.current?.focus());
      return;
    }
    onCreateProject(createUploadedProject(result, draft));
  }

  function errorAttributes(targetId: string) {
    const issue = showErrors ? issueByTarget.get(targetId) : undefined;
    return {
      id: targetId,
      "aria-invalid": issue ? true : undefined,
      "aria-describedby": issue ? `${targetId}-error` : undefined,
    };
  }

  function focusIssue(targetId: string) {
    const target = document.getElementById(targetId);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: "center" });
  }

  return (
    <main className="uploaded-summary" id="main-content">
      <header className="summary-header">
        <button className="button button-ghost" type="button" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />Back
        </button>
        <div className="mode-indicator">
          <span aria-hidden="true" />
          {isPasted ? "Pasted text ready" : isPartial ? "Partial parse ready" : "Local parse complete"}
        </div>
      </header>

      <form className="summary-content summary-content-wide" onSubmit={submit} noValidate>
        <div className="summary-intro">
          <CheckCircle2 aria-hidden="true" />
          <div>
            <p className="eyebrow">Review before saving</p>
            <h1 ref={headingRef} tabIndex={-1}>Confirm what the assignment says.</h1>
            <p>
              RubricTrail filled only what it could locate in the source. Edit anything that is missing or
              ambiguous; your confirmation, not a guess, creates the project.
            </p>
          </div>
        </div>

        {isPartial ? (
          <section
            className="inline-alert warning partial-summary-warning"
            aria-labelledby="partial-summary-title"
          >
            <AlertTriangle aria-hidden="true" />
            <div>
              <h2 id="partial-summary-title">
                This preview uses {result.fileNames.length} of the {selectedFileCount} selected files.
              </h2>
              <p>
                Files listed below were not included in any detected field or source excerpt. Check anything marked missing before creating the project.
              </p>
              <ul className="intake-file-list issue-list">
                {result.skippedFiles.map((issue) => (
                  <li key={`${issue.inputIndex}-${issue.code}`}>
                    <strong>{issue.fileName}</strong>
                    <span>{assignmentFileIssueReason(issue.code)}</span>
                  </li>
                ))}
              </ul>
              <button
                className="button button-ghost"
                type="button"
                onClick={onBack}
              >
                Review file selection
              </button>
            </div>
          </section>
        ) : null}

        <div className="source-strip">
          <FileText aria-hidden="true" />
          <div>
            <strong>{result.fileNames.map(sourceDisplayName).join(", ")}</strong>
            <span>
              {result.fileNames.length} readable {result.fileNames.length === 1 ? "source" : "sources"} · {result.totalWords.toLocaleString()} source words · processed locally for this preview; full source text is not stored
            </span>
          </div>
        </div>

        {result.summary.warnings.length ? (
          <section className="inline-alert warning" aria-labelledby="parse-warning-title">
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong id="parse-warning-title">Items that need your confirmation</strong>
              <ul>{result.summary.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
            </div>
          </section>
        ) : null}

        <section className="confirm-fields" aria-labelledby="project-details-title">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Project details</p>
              <h2 id="project-details-title">Check the planning inputs</h2>
            </div>
          </div>
          <div className="confirm-field-grid">
            <label>
              <span>Assignment title</span>
              <input
                {...errorAttributes("confirm-title")}
                value={draft.title}
                onChange={(event) => updateField("title", event.target.value)}
                placeholder="e.g. Strategy report"
                maxLength={300}
                data-testid="confirm-title"
              />
              <FieldStatus status={result.summary.title.status} edited={draft.title !== initialDraft.title} isPasted={isPasted} />
              <EvidenceNote evidence={result.summary.title.evidence} />
              <FieldError issue={showErrors ? issueByTarget.get("confirm-title") : undefined} />
            </label>
            <label>
              <span>Course or module <small>optional</small></span>
              <input
                {...errorAttributes("confirm-course")}
                value={draft.course}
                onChange={(event) => updateField("course", event.target.value)}
                placeholder="e.g. BUS302"
                maxLength={200}
              />
              <small>Used only to label this local project.</small>
              <FieldError issue={showErrors ? issueByTarget.get("confirm-course") : undefined} />
            </label>
            <label>
              <span>Deadline</span>
              <input
                {...errorAttributes("confirm-deadline")}
                type="date"
                value={draft.dueDate}
                onChange={(event) => updateField("dueDate", event.target.value)}
                data-testid="confirm-deadline"
              />
              <FieldStatus status={result.summary.dueDate.status} edited={draft.dueDate !== initialDraft.dueDate} isPasted={isPasted} />
              <EvidenceNote evidence={result.summary.dueDate.evidence} />
              <FieldError issue={showErrors ? issueByTarget.get("confirm-deadline") : undefined} />
            </label>
            <label>
              <span>Word count</span>
              <input
                {...errorAttributes("confirm-word-count")}
                type="number"
                min="1"
                max="50000"
                step="1"
                value={draft.wordCount}
                onChange={(event) => updateField("wordCount", event.target.value)}
                placeholder="2500"
                data-testid="confirm-word-count"
              />
              <FieldStatus status={result.summary.wordCount.status} edited={draft.wordCount !== initialDraft.wordCount} isPasted={isPasted} />
              <EvidenceNote evidence={result.summary.wordCount.evidence} />
              <FieldError issue={showErrors ? issueByTarget.get("confirm-word-count") : undefined} />
            </label>
            <label className="confirm-field-wide">
              <span>Citation style</span>
              <input
                {...errorAttributes("confirm-citation-style")}
                value={draft.citationStyle}
                onChange={(event) => updateField("citationStyle", event.target.value)}
                placeholder="e.g. APA 7, Harvard, or Not specified"
                maxLength={160}
                data-testid="confirm-citation-style"
              />
              <FieldStatus status={result.summary.citationStyle.status} edited={draft.citationStyle !== initialDraft.citationStyle} isPasted={isPasted} />
              <EvidenceNote evidence={result.summary.citationStyle.evidence} />
              <FieldError issue={showErrors ? issueByTarget.get("confirm-citation-style") : undefined} />
            </label>
          </div>
        </section>

        <section className="rubric-detection rubric-editor" aria-labelledby="rubric-detection-title">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Rubric</p>
              <h2 id="rubric-detection-title" tabIndex={-1}>Confirm what earns marks</h2>
              <p>{result.summary.rubric.message}</p>
            </div>
            <span className={`text-status ${Math.abs(totalWeight - 100) < 0.01 ? "complete" : "incomplete"}`}>
              {totalWeight}% total
            </span>
          </div>

          <div className="rubric-editor-list">
            {draft.criteria.map((criterion, index) => (
              <div className="rubric-editor-row" key={criterionKeys[index]}>
                <span className="criterion-index" aria-hidden="true">{index + 1}</span>
                <label>
                  <span>Criterion</span>
                  <input
                    {...errorAttributes(`criterion-name-${index}`)}
                    value={criterion.name}
                    onChange={(event) => updateCriterion(index, "name", event.target.value)}
                    placeholder="Criterion name"
                    maxLength={300}
                    data-testid={`criterion-name-${index}`}
                  />
                  <FieldError issue={showErrors ? issueByTarget.get(`criterion-name-${index}`) : undefined} />
                </label>
                <label className="weight-field">
                  <span>Weight</span>
                  <span className="input-with-suffix">
                    <input
                      {...errorAttributes(`criterion-weight-${index}`)}
                      type="number"
                      min="0.01"
                      max="100"
                      step="0.01"
                      value={criterion.weight}
                      onChange={(event) => updateCriterion(index, "weight", event.target.value)}
                      aria-label={`Weight for criterion ${index + 1}`}
                      data-testid={`criterion-weight-${index}`}
                    />
                    <b>%</b>
                  </span>
                  <FieldError issue={showErrors ? issueByTarget.get(`criterion-weight-${index}`) : undefined} />
                </label>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => removeCriterion(index)}
                  aria-label={`Remove criterion ${index + 1}`}
                >
                  <Trash2 aria-hidden="true" />
                </button>
                <EvidenceNote evidence={criterion.evidence} />
              </div>
            ))}
          </div>

          <button
            id="add-criterion"
            className="button button-secondary add-criterion"
            type="button"
            onClick={addCriterion}
            disabled={draft.criteria.length >= 50}
          >
            <Plus aria-hidden="true" />Add missing criterion
          </button>
          <FieldError issue={showErrors ? issueByTarget.get("add-criterion") : undefined} />
        </section>

        {showErrors && issues.length ? (
          <section
            className="inline-alert danger confirm-errors"
            role="alert"
            tabIndex={-1}
            ref={errorSummaryRef}
            data-testid="confirm-errors"
          >
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong>Finish these checks before creating the project</strong>
              <ul>
                {issues.map((issue, index) => (
                  <li key={`${issue.targetId}-${index}`}>
                    <a
                      href={`#${issue.targetId}`}
                      onClick={(event) => {
                        event.preventDefault();
                        focusIssue(issue.targetId);
                      }}
                    >
                      {issue.message}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        <div className="integrity-note">
          <ShieldCheck aria-hidden="true" />
          <p>
            <strong>Compact local save:</strong> confirmed fields, rubric names, weights and short
            source excerpts are saved in this browser. Original files and full source text are not.
          </p>
        </div>

        <div className="summary-actions">
          <button className="button button-secondary" type="button" onClick={onBack}>
            {isPasted ? "Edit pasted text" : isPartial ? "Review file selection" : "Choose different files"}
          </button>
          <button className="button button-primary" type="submit" data-testid="create-project">
            Create local project <ArrowRight aria-hidden="true" />
          </button>
        </div>
      </form>
    </main>
  );
}
