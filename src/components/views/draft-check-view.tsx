"use client";

import { AlertTriangle, ArrowRight, CheckCircle2, FileCheck2, Highlighter, LoaderCircle, Quote, ShieldCheck, Sparkles } from "lucide-react";
import type { AssignmentAnalysis, DraftCheckResult } from "@/lib/domain";
import { PROJECT_DRAFT_MAX_CHARACTERS } from "@/lib/local-state";

interface DraftCheckViewProps {
  analysis: AssignmentAnalysis;
  draftText: string;
  selectedSectionId: string;
  result: DraftCheckResult | null;
  checkedDraftText: string | null;
  isChecking: boolean;
  checkingStage: number;
  onDraftChange: (text: string) => void;
  onSectionChange: (sectionId: string) => void;
  onCheck: () => void;
  onOpenEvidence: (evidenceId: string) => void;
  onNavigateProgress: () => void;
}

const SECTIONS = [
  ["executive-summary", "Executive summary"],
  ["problem-scope", "Problem scope"],
  ["analysis-recommendations", "Analysis and recommendations"],
  ["implementation", "Implementation"],
  ["conclusion", "Conclusion"],
] as const;

const CHECKING_STAGES = [
  "Mapping your draft to the selected section",
  "Scanning for surface evidence signals",
  "Looking for prompts to review",
  "Preparing next actions",
] as const;

function countWords(text: string) {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}

function signalLabel(value: number) {
  if (value >= 70) return "Stronger";
  if (value >= 50) return "Some";
  if (value > 0) return "Limited";
  return "None";
}

export function DraftCheckView({
  analysis,
  draftText,
  selectedSectionId,
  result,
  checkedDraftText,
  isChecking,
  checkingStage,
  onDraftChange,
  onSectionChange,
  onCheck,
  onOpenEvidence,
  onNavigateProgress,
}: DraftCheckViewProps) {
  const words = countWords(draftText);
  const isEmpty = words === 0;
  const isShort = words > 0 && words < 80;
  const isStale = Boolean(
    result &&
      (checkedDraftText !== draftText || result.sectionId !== selectedSectionId),
  );
  const criterionName = new Map(analysis.rubric.map((criterion) => [criterion.id, criterion.name]));
  const urgentGapCount = result?.feedback.filter(
    (item) => item.severity === "high" && item.kind !== "strength",
  ).length ?? 0;

  return (
    <div className="view-stack draft-view">
      <header className="view-header">
        <p className="eyebrow">Draft check</p>
        <h1>Check against the rubric — without giving away the work.</h1>
        <p>This deterministic sample check flags simple surface signals and turns them into questions for your own review. It is not a grade or semantic assessment.</p>
      </header>

      <div className="draft-workspace">
        <section className="draft-editor" aria-labelledby="draft-editor-title">
          <div className="editor-heading"><div><h2 id="draft-editor-title">Your section</h2><span>Paste your own writing</span></div><FileCheck2 aria-hidden="true" /></div>
          <label className="field-label" htmlFor="draft-section">Report section</label>
          <select id="draft-section" value={selectedSectionId} onChange={(event) => onSectionChange(event.target.value)}>
            {SECTIONS.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
          </select>
          <label className="field-label" htmlFor="draft-text">Draft text</label>
          <textarea
            id="draft-text"
            value={draftText}
            onChange={(event) => onDraftChange(event.target.value)}
            placeholder="Paste your own paragraph or section here…"
            maxLength={PROJECT_DRAFT_MAX_CHARACTERS}
            aria-describedby="draft-help draft-count"
            data-testid="draft-text"
          />
          <div className="editor-meta"><span id="draft-count">{words} words · {draftText.length.toLocaleString()} / {PROJECT_DRAFT_MAX_CHARACTERS.toLocaleString()} characters</span><span id="draft-help">Best for one section at a time</span></div>
          {isEmpty ? <p className="field-message error" role="alert">Paste your own writing to begin. RubricTrail prompts your review; it will not write the assignment for you.</p> : null}
          {isShort ? <p className="field-message warning">This is a short extract. You can still run a limited check, but structural coverage may be incomplete.</p> : null}
          <button className="button button-primary button-full" type="button" onClick={onCheck} disabled={isEmpty || isChecking} data-testid="run-draft-check">
            {isChecking ? <><LoaderCircle className="spin" aria-hidden="true" />Scanning demo signals…</> : <><Sparkles aria-hidden="true" />Run demo signal check</>}
          </button>
          <div className="integrity-note compact"><ShieldCheck aria-hidden="true" /><p><strong>Your thinking stays yours.</strong> Feedback uses questions and short sentence frames — never a replacement paragraph.</p></div>
        </section>

        <section className="draft-results" aria-labelledby="draft-results-title" aria-live="polite">
          {isChecking ? (
            <div className="checking-state" data-testid="checking-state">
              <LoaderCircle className="spin" aria-hidden="true" />
              <h2 id="draft-results-title">Reading for evidence</h2>
              <ol>{CHECKING_STAGES.map((stage, index) => <li className={index < checkingStage ? "is-complete" : index === checkingStage ? "is-active" : ""} key={stage}><span>{index < checkingStage ? <CheckCircle2 /> : index + 1}</span>{stage}</li>)}</ol>
              <p>Deterministic Demo analysis · no API request</p>
            </div>
          ) : result ? (
            <div className="results-stack" data-testid="draft-results">
               {isStale ? <div className="inline-alert warning"><AlertTriangle aria-hidden="true" /><div><strong>Your draft or selected section has changed.</strong><span>Run the check again to refresh this feedback.</span></div></div> : null}
              <div className="result-summary">
                <div className="coverage-number"><strong>{signalLabel(result.coverageEstimate)}</strong><span>surface signals</span></div>
                <div><h2 id="draft-results-title">{urgentGapCount > 0 ? `${urgentGapCount} high-priority review ${urgentGapCount === 1 ? "prompt" : "prompts"}.` : "No high-priority prompts from this demo scan."}</h2><p>{result.coverageDisclaimer} Verify every prompt yourself.</p></div>
              </div>
              <div className="criteria-coverage" aria-label="Rubric coverage">
                {result.criteria.map((criterion) => (
                  <div key={criterion.criterionId}>
                    <span>{criterionName.get(criterion.criterionId) ?? criterion.criterionId}</span>
                    <div className="progress-track" role="progressbar" aria-label={`${criterionName.get(criterion.criterionId) ?? criterion.criterionId} demo signal level`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={criterion.coverage}><span style={{ width: `${criterion.coverage}%` }} /></div>
                    <strong>{criterion.status.replace("_", " ")}</strong>
                  </div>
                ))}
              </div>

              <section className="feedback-list next-action-list" aria-labelledby="draft-next-actions-title">
                <h3 id="draft-next-actions-title">Priority next actions</h3>
                {result.nextActions.map((action) => (
                  <article className={`feedback-item next_action ${action.priority}`} key={action.id}>
                    <div className="feedback-marker" aria-hidden="true"><ArrowRight /></div>
                    <div className="feedback-content">
                      <div className="feedback-topline"><span>{action.priority} priority · {action.estimatedMinutes} min</span><strong>{action.rubricIds.map((id) => criterionName.get(id) ?? id).join(" · ")}</strong></div>
                      <h3>{action.text}</h3>
                    </div>
                  </article>
                ))}
              </section>

              <div className="feedback-list">
                {result.feedback.map((feedback) => (
                  <article className={`feedback-item ${feedback.kind} ${feedback.severity}`} key={feedback.id}>
                    <div className="feedback-marker" aria-hidden="true">{feedback.kind === "strength" ? <CheckCircle2 /> : <Highlighter />}</div>
                    <div className="feedback-content">
                      <div className="feedback-topline"><span>{feedback.kind.replace("_", " ")} · {feedback.severity} priority</span><strong>{feedback.rubricIds.map((id) => criterionName.get(id) ?? id).join(" · ")}</strong></div>
                      <h3>{feedback.title}</h3>
                      <p>{feedback.explanation}</p>
                      {feedback.draftEvidence.length ? <blockquote><Quote aria-hidden="true" />“{feedback.draftEvidence[0].excerpt}”</blockquote> : <div className="missing-evidence">No matching evidence is visible in this section.</div>}
                      {feedback.action ? <div className="improve-by"><strong>Improve by</strong><p>{feedback.action}</p></div> : null}
                      {feedback.successCheck ? <div className="success-check"><strong>Done when</strong><p>{feedback.successCheck}</p></div> : null}
                      {feedback.guidance ? <div className="coaching-prompt"><span>{feedback.guidance.kind === "sentence_stem" ? "Sentence frame — adapt in your own words" : "Ask yourself"}</span><p>{feedback.guidance.text}</p></div> : null}
                      <div className="feedback-evidence-links">
                        {feedback.sourceEvidenceRefs.slice(0, 2).map((id) => <button className="evidence-link" type="button" onClick={() => onOpenEvidence(id)} key={id}>Why this matters · {id} <ArrowRight aria-hidden="true" /></button>)}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              <button className="button button-secondary button-full" type="button" onClick={onNavigateProgress}>See what this changes in progress <ArrowRight aria-hidden="true" /></button>
            </div>
          ) : (
            <div className="empty-state draft-empty">
              <div className="empty-illustration" aria-hidden="true"><FileCheck2 /><span /><span /><span /></div>
              <h2 id="draft-results-title">Feedback will appear here</h2>
              <p>Run the deterministic demo check to get review prompts based on visible surface signals. Always compare them with the rubric yourself.</p>
              <ul><li>Evidence in your words</li><li>Why the rubric requires it</li><li>Questions that move the work forward</li></ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
