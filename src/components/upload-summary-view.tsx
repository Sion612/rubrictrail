"use client";

import { useMemo, useState } from "react";
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
  validateUploadedProjectDraft,
} from "@/lib/uploaded-project";
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

function EvidenceNote({ evidence }: { evidence: UploadedProjectDraft["criteria"][number]["evidence"] }) {
  if (!evidence) return <small>No source excerpt was retained for this field.</small>;
  return (
    <details className="source-evidence-note">
      <summary>
        Source: {evidence.fileName ?? "uploaded file"}
        {evidence.page ? ` · page ${evidence.page}` : ""}
      </summary>
      <blockquote>{evidence.excerpt}</blockquote>
    </details>
  );
}

export function UploadSummaryView({
  result,
  onBack,
  onCreateProject,
}: UploadSummaryViewProps) {
  const [draft, setDraft] = useState<UploadedProjectDraft>(() => draftFromUpload(result));
  const [showErrors, setShowErrors] = useState(false);
  const errors = useMemo(() => validateUploadedProjectDraft(draft), [draft]);
  const totalWeight = draft.criteria.reduce(
    (total, criterion) => total + (Number(criterion.weight) || 0),
    0,
  );

  function updateField<K extends keyof Omit<UploadedProjectDraft, "criteria">>(
    key: K,
    value: UploadedProjectDraft[K],
  ) {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updateCriterion(index: number, key: "name" | "weight", value: string) {
    setDraft((current) => ({
      ...current,
      criteria: current.criteria.map((criterion, criterionIndex) =>
        criterionIndex === index ? { ...criterion, [key]: value } : criterion,
      ),
    }));
  }

  function addCriterion() {
    setDraft((current) => ({
      ...current,
      criteria: [...current.criteria, { name: "", weight: "", evidence: null }],
    }));
  }

  function removeCriterion(index: number) {
    setDraft((current) => ({
      ...current,
      criteria: current.criteria.filter((_, criterionIndex) => criterionIndex !== index),
    }));
  }

  function submit() {
    setShowErrors(true);
    if (errors.length) return;
    onCreateProject(createUploadedProject(result, draft));
  }

  return (
    <main className="uploaded-summary" id="main-content">
      <header className="summary-header">
        <button className="button button-ghost" type="button" onClick={onBack}>
          <ArrowLeft aria-hidden="true" />Back
        </button>
        <div className="mode-indicator"><span aria-hidden="true" />Local parse complete</div>
      </header>

      <section className="summary-content summary-content-wide">
        <div className="summary-intro">
          <CheckCircle2 aria-hidden="true" />
          <div>
            <p className="eyebrow">Review before saving</p>
            <h1>Confirm what the files actually say.</h1>
            <p>
              RubricTrail filled only what it could locate. Edit anything that is missing or
              ambiguous; your confirmation, not a guess, creates the project.
            </p>
          </div>
        </div>

        <div className="source-strip">
          <FileText aria-hidden="true" />
          <div>
            <strong>{result.fileNames.join(", ")}</strong>
            <span>
              {result.totalWords.toLocaleString()} extracted words · original files remain in
              this browser session
            </span>
          </div>
        </div>

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
                value={draft.title}
                onChange={(event) => updateField("title", event.target.value)}
                placeholder="e.g. Strategy report"
                data-testid="confirm-title"
              />
              <EvidenceNote evidence={result.summary.title.evidence} />
            </label>
            <label>
              <span>Course or module <small>optional</small></span>
              <input
                value={draft.course}
                onChange={(event) => updateField("course", event.target.value)}
                placeholder="e.g. BUS302"
              />
              <small>Used only to label this local project.</small>
            </label>
            <label>
              <span>Deadline</span>
              <input
                type="date"
                value={draft.dueDate}
                onChange={(event) => updateField("dueDate", event.target.value)}
                data-testid="confirm-deadline"
              />
              <EvidenceNote evidence={result.summary.dueDate.evidence} />
            </label>
            <label>
              <span>Word count</span>
              <input
                type="number"
                min="1"
                step="1"
                value={draft.wordCount}
                onChange={(event) => updateField("wordCount", event.target.value)}
                placeholder="2500"
                data-testid="confirm-word-count"
              />
              <EvidenceNote evidence={result.summary.wordCount.evidence} />
            </label>
            <label className="confirm-field-wide">
              <span>Citation style</span>
              <input
                value={draft.citationStyle}
                onChange={(event) => updateField("citationStyle", event.target.value)}
                placeholder="e.g. APA 7, Harvard, or Not specified"
                data-testid="confirm-citation-style"
              />
              <EvidenceNote evidence={result.summary.citationStyle.evidence} />
            </label>
          </div>
        </section>

        <section className="rubric-detection rubric-editor" aria-labelledby="rubric-detection-title">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">Rubric</p>
              <h2 id="rubric-detection-title">Confirm what earns marks</h2>
            </div>
            <span className={`text-status ${Math.abs(totalWeight - 100) < 0.01 ? "complete" : "incomplete"}`}>
              {totalWeight}% total
            </span>
          </div>

          <div className="rubric-editor-list">
            {draft.criteria.map((criterion, index) => (
              <div className="rubric-editor-row" key={`${index}-${criterion.evidence?.startOffset ?? "manual"}`}>
                <span className="criterion-index" aria-hidden="true">{index + 1}</span>
                <label>
                  <span>Criterion</span>
                  <input
                    value={criterion.name}
                    onChange={(event) => updateCriterion(index, "name", event.target.value)}
                    placeholder="Criterion name"
                    data-testid={`criterion-name-${index}`}
                  />
                </label>
                <label className="weight-field">
                  <span>Weight</span>
                  <span className="input-with-suffix">
                    <input
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

          <button className="button button-secondary add-criterion" type="button" onClick={addCriterion}>
            <Plus aria-hidden="true" />Add missing criterion
          </button>
        </section>

        {showErrors && errors.length ? (
          <section className="inline-alert danger confirm-errors" role="alert" data-testid="confirm-errors">
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong>Finish these checks before creating the project</strong>
              <ul>{errors.map((error) => <li key={error}>{error}</li>)}</ul>
            </div>
          </section>
        ) : null}

        <div className="integrity-note">
          <ShieldCheck aria-hidden="true" />
          <p>
            <strong>Compact local save:</strong> confirmed fields, rubric names, weights and short
            source excerpts are saved in this browser. Original files and full extracted text are not.
          </p>
        </div>

        <div className="summary-actions">
          <button className="button button-secondary" type="button" onClick={onBack}>
            Upload different files
          </button>
          <button className="button button-primary" type="button" onClick={submit} data-testid="create-project">
            Create local project <ArrowRight aria-hidden="true" />
          </button>
        </div>
      </section>
    </main>
  );
}
