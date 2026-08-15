"use client";

import { useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, FileCheck2, Highlighter, LoaderCircle, Quote, ShieldCheck, Sparkles } from "lucide-react";
import type { AssignmentAnalysis, DraftCheckResult } from "@/lib/domain";
import { PROJECT_DRAFT_MAX_CHARACTERS } from "@/lib/local-state";
import { useI18n, useLocalizedMessages } from "@/components/locale-provider";
import {
  draftMessagesEn,
  draftMessagesZhCN,
  interpolateViewMessage,
  localizeSystemText,
} from "@/lib/i18n/messages/views";

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

function countWords(text: string) {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
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
  const messages = useLocalizedMessages(draftMessagesEn, draftMessagesZhCN);
  const { locale, formatNumber } = useI18n();
  const sections = [
    ["executive-summary", messages.executiveSummary],
    ["problem-scope", messages.problemScope],
    ["analysis-recommendations", messages.analysisRecommendations],
    ["implementation", messages.implementation],
    ["conclusion", messages.conclusion],
  ] as const;
  const checkingStages = [
    messages.stageMap,
    messages.stageScan,
    messages.stagePrompts,
    messages.stageActions,
  ] as const;
  const signalLabel = (value: number) => {
    if (value >= 70) return messages.stronger;
    if (value >= 50) return messages.some;
    if (value > 0) return messages.limited;
    return messages.none;
  };
  const localizedPriority = (value: string) => {
    if (value === "high") return messages.high;
    if (value === "medium") return messages.medium;
    if (value === "low") return messages.low;
    return value;
  };
  const localizedKind = (value: string) => {
    if (value === "strength") return messages.strength;
    if (value === "issue") return messages.issue;
    if (value === "evidence_gap") return messages.evidenceGap;
    if (value === "next_action") return messages.nextAction;
    return value.replace("_", " ");
  };
  const localizedStatus = (value: string) => {
    if (value === "strong") return messages.strong;
    if (value === "partial") return messages.partial;
    if (value === "emerging") return messages.emerging;
    if (value === "not_evidenced") return messages.notEvidenced;
    return value.replace("_", " ");
  };
  const [hasEditedDraft, setHasEditedDraft] = useState(false);
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
        <p className="eyebrow">{messages.eyebrow}</p>
        <h1>{messages.title}</h1>
        <p>{messages.description}</p>
      </header>

      <div className="draft-workspace">
        <section className="draft-editor" aria-labelledby="draft-editor-title">
          <div className="editor-heading"><div><h2 id="draft-editor-title">{messages.yourSection}</h2><span>{messages.pasteOwn}</span></div><FileCheck2 aria-hidden="true" /></div>
          <label className="field-label" htmlFor="draft-section">{messages.reportSection}</label>
          <select id="draft-section" value={selectedSectionId} onChange={(event) => onSectionChange(event.target.value)}>
            {sections.map(([id, label]) => <option value={id} key={id}>{label}</option>)}
          </select>
          <label className="field-label" htmlFor="draft-text">{messages.draftText}</label>
          <textarea
            id="draft-text"
            value={draftText}
            onChange={(event) => {
              setHasEditedDraft(true);
              onDraftChange(event.target.value);
            }}
            placeholder={messages.placeholder}
            maxLength={PROJECT_DRAFT_MAX_CHARACTERS}
            aria-describedby={`draft-help draft-count${isEmpty ? " draft-empty-message" : ""}`}
            data-testid="draft-text"
          />
          <div className="editor-meta"><span id="draft-count">{interpolateViewMessage(messages.count, { words: formatNumber(words), characters: formatNumber(draftText.length), maximum: formatNumber(PROJECT_DRAFT_MAX_CHARACTERS) })}</span><span id="draft-help">{messages.oneSection}</span></div>
          {isEmpty ? <p className="field-message error" id="draft-empty-message" role={hasEditedDraft ? "alert" : undefined}>{messages.empty}</p> : null}
          {isShort ? <p className="field-message warning">{messages.short}</p> : null}
          <button className="button button-primary button-full" type="button" onClick={onCheck} disabled={isEmpty || isChecking} data-testid="run-draft-check">
            {isChecking ? <><LoaderCircle className="spin" aria-hidden="true" />{messages.scanning}</> : <><Sparkles aria-hidden="true" />{messages.run}</>}
          </button>
          <div className="integrity-note compact"><ShieldCheck aria-hidden="true" /><p><strong>{messages.thinkingYours}</strong> {messages.integrity}</p></div>
        </section>

        <section className="draft-results" aria-labelledby="draft-results-title" aria-live="polite">
          {isChecking ? (
            <div className="checking-state" data-testid="checking-state">
              <LoaderCircle className="spin" aria-hidden="true" />
              <h2 id="draft-results-title">{messages.reading}</h2>
              <ol>{checkingStages.map((stage, index) => <li className={index < checkingStage ? "is-complete" : index === checkingStage ? "is-active" : ""} key={stage}><span>{index < checkingStage ? <CheckCircle2 /> : formatNumber(index + 1)}</span>{stage}</li>)}</ol>
              <p>{messages.demoNoApi}</p>
            </div>
          ) : result ? (
            <div className="results-stack" data-testid="draft-results">
               {isStale ? <div className="inline-alert warning"><AlertTriangle aria-hidden="true" /><div><strong>{messages.staleTitle}</strong><span>{messages.staleDescription}</span></div></div> : null}
              <div className="result-summary">
                <div className="coverage-number"><strong>{signalLabel(result.coverageEstimate)}</strong><span>{messages.surfaceSignals}</span></div>
                <div><h2 id="draft-results-title">{urgentGapCount > 0 ? interpolateViewMessage(messages.urgentPrompts, { count: formatNumber(urgentGapCount), noun: urgentGapCount === 1 ? messages.prompt : messages.prompts }) : messages.noUrgent}</h2><p>{localizeSystemText(result.coverageDisclaimer, locale)} {messages.verify}</p></div>
              </div>
              <div className="criteria-coverage" aria-label={messages.coverage}>
                {result.criteria.map((criterion) => (
                  <div key={criterion.criterionId}>
                    <span>{criterionName.get(criterion.criterionId) ?? criterion.criterionId}</span>
                    <div className="progress-track" role="progressbar" aria-label={interpolateViewMessage(messages.signalAria, { criterion: criterionName.get(criterion.criterionId) ?? criterion.criterionId })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={criterion.coverage}><span style={{ width: `${criterion.coverage}%` }} /></div>
                    <strong>{localizedStatus(criterion.status)}</strong>
                  </div>
                ))}
              </div>

              <section className="feedback-list next-action-list" aria-labelledby="draft-next-actions-title">
                <h3 id="draft-next-actions-title">{messages.priorityActions}</h3>
                {result.nextActions.map((action) => (
                  <article className={`feedback-item next_action ${action.priority}`} key={action.id}>
                    <div className="feedback-marker" aria-hidden="true"><ArrowRight /></div>
                    <div className="feedback-content">
                      <div className="feedback-topline"><span>{interpolateViewMessage(messages.priorityMinutes, { priority: localizedPriority(action.priority), minutes: formatNumber(action.estimatedMinutes) })}</span><strong>{action.rubricIds.map((id) => criterionName.get(id) ?? id).join(" · ")}</strong></div>
                      <h3>{localizeSystemText(action.text, locale)}</h3>
                    </div>
                  </article>
                ))}
              </section>

              <div className="feedback-list">
                {result.feedback.map((feedback) => (
                  <article className={`feedback-item ${feedback.kind} ${feedback.severity}`} key={feedback.id}>
                    <div className="feedback-marker" aria-hidden="true">{feedback.kind === "strength" ? <CheckCircle2 /> : <Highlighter />}</div>
                    <div className="feedback-content">
                      <div className="feedback-topline"><span>{interpolateViewMessage(messages.feedbackMeta, { kind: localizedKind(feedback.kind), severity: localizedPriority(feedback.severity) })}</span><strong>{feedback.rubricIds.map((id) => criterionName.get(id) ?? id).join(" · ")}</strong></div>
                      <h3>{localizeSystemText(feedback.title, locale)}</h3>
                      <p>{localizeSystemText(feedback.explanation, locale)}</p>
                      {feedback.draftEvidence.length ? <blockquote><Quote aria-hidden="true" />“{feedback.draftEvidence[0].excerpt}”</blockquote> : <div className="missing-evidence">{messages.noEvidence}</div>}
                      {feedback.action ? <div className="improve-by"><strong>{messages.improveBy}</strong><p>{localizeSystemText(feedback.action, locale)}</p></div> : null}
                      {feedback.successCheck ? <div className="success-check"><strong>{messages.doneWhen}</strong><p>{localizeSystemText(feedback.successCheck, locale)}</p></div> : null}
                      {feedback.guidance ? <div className="coaching-prompt"><span>{feedback.guidance.kind === "sentence_stem" ? messages.sentenceFrame : messages.askYourself}</span><p>{localizeSystemText(feedback.guidance.text, locale)}</p></div> : null}
                      <div className="feedback-evidence-links">
                        {feedback.sourceEvidenceRefs.slice(0, 2).map((id) => <button className="evidence-link" type="button" onClick={() => onOpenEvidence(id)} key={id}>{interpolateViewMessage(messages.whyMatters, { id })} <ArrowRight aria-hidden="true" /></button>)}
                      </div>
                    </div>
                  </article>
                ))}
              </div>
              <button className="button button-secondary button-full" type="button" onClick={onNavigateProgress}>{messages.progress} <ArrowRight aria-hidden="true" /></button>
            </div>
          ) : (
            <div className="empty-state draft-empty">
              <div className="empty-illustration" aria-hidden="true"><FileCheck2 /><span /><span /><span /></div>
              <h2 id="draft-results-title">{messages.feedbackHere}</h2>
              <p>{messages.emptyDescription}</p>
              <ul><li>{messages.evidenceOwnWords}</li><li>{messages.rubricReason}</li><li>{messages.forwardQuestions}</li></ul>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
