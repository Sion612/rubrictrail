"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  FileSearch,
  Layers3,
  Map,
  Search,
} from "lucide-react";

import type {
  ActionPlan,
  AssignmentAnalysis,
  DraftCheckResult,
  RubricCriterion,
} from "@/lib/domain";

interface RubricViewProps {
  analysis: AssignmentAnalysis;
  draftResult: DraftCheckResult | null;
  plan: ActionPlan;
  onOpenEvidence(id: string): void;
}

interface DetailListProps {
  title: string;
  items: string[];
  icon: typeof CheckCircle2;
  modifier: string;
}

function getDefaultExpandedId(criteria: RubricCriterion[]): string | null {
  return (
    criteria.find((criterion) => /evidence|analysis/i.test(criterion.name))?.id ??
    criteria[0]?.id ??
    null
  );
}

function initialExpandedSet(criteria: RubricCriterion[]): Set<string> {
  const id = getDefaultExpandedId(criteria);
  return id ? new Set([id]) : new Set();
}

function DetailList({ title, items, icon: Icon, modifier }: DetailListProps) {
  return (
    <section className={`rubric-detail rubric-detail--${modifier}`}>
      <div className="rubric-detail__heading">
        <Icon aria-hidden="true" />
        <h4>{title}</h4>
      </div>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function ProgressMetric({
  label,
  value,
  detail,
  muted = false,
}: {
  label: string;
  value: number | null;
  detail?: string;
  muted?: boolean;
}) {
  const normalizedValue = value === null ? 0 : Math.max(0, Math.min(100, value));

  return (
    <div className={`rubric-progress ${muted ? "rubric-progress--muted" : ""}`}>
      <div className="rubric-progress__label-row">
        <span>{label}</span>
        <strong>{value === null ? "Not checked" : `${Math.round(normalizedValue)}%`}</strong>
      </div>
      <progress value={normalizedValue} max={100} aria-label={label} />
      {detail ? <p>{detail}</p> : null}
    </div>
  );
}

export function RubricView({ analysis, draftResult, plan, onOpenEvidence }: RubricViewProps) {
  const defaultExpandedId = getDefaultExpandedId(analysis.rubric);
  const [expansion, setExpansion] = useState<{
    assignmentId: string;
    ids: Set<string>;
  }>(() => ({
    assignmentId: analysis.id,
    ids: initialExpandedSet(analysis.rubric),
  }));

  const expandedIds =
    expansion.assignmentId === analysis.id
      ? expansion.ids
      : defaultExpandedId
        ? new Set([defaultExpandedId])
        : new Set<string>();

  const toggleCriterion = (criterionId: string) => {
    setExpansion((current) => {
      const currentIds =
        current.assignmentId === analysis.id
          ? current.ids
          : initialExpandedSet(analysis.rubric);
      const nextIds = new Set(currentIds);

      if (nextIds.has(criterionId)) nextIds.delete(criterionId);
      else nextIds.add(criterionId);

      return { assignmentId: analysis.id, ids: nextIds };
    });
  };

  const totalWeight = analysis.rubric.reduce((sum, criterion) => sum + criterion.weight, 0);

  return (
    <div className="rubric-view">
      <header className="rubric-view__header">
        <div className="rubric-view__heading-copy">
          <span className="rubric-view__eyebrow">Rubric-to-work map</span>
          <h1>See what every mark requires</h1>
          <p>
            Expand a criterion to connect high-mark performance with the evidence, report section,
            tasks, and draft changes needed to achieve it.
          </p>
        </div>

        <dl className="rubric-summary" aria-label="Rubric progress summary">
          <div className="rubric-summary__item">
            <dt>Rubric weight mapped</dt>
            <dd>{Math.round(totalWeight)}%</dd>
          </div>
          <div className="rubric-summary__item">
            <dt>Plan completed</dt>
            <dd>{Math.round(plan.completionPercent)}%</dd>
          </div>
          <div className="rubric-summary__item">
            <dt>Draft coverage</dt>
            <dd>{draftResult ? `${Math.round(draftResult.coverageEstimate)}%` : "Not checked"}</dd>
          </div>
        </dl>
      </header>

      <div className="rubric-table" role="list" aria-label="Rubric criteria">
        {analysis.rubric.map((criterion, index) => {
          const expanded = expandedIds.has(criterion.id);
          const panelId = `rubric-criterion-panel-${index}`;
          const planProgress = plan.rubricProgress.find(
            (item) => item.criterionId === criterion.id,
          );
          const draftCheck = draftResult?.criteria.find(
            (item) => item.criterionId === criterion.id,
          );

          return (
            <article
              key={criterion.id}
              className={`rubric-row ${expanded ? "rubric-row--expanded" : ""}`}
              role="listitem"
            >
              <button
                type="button"
                className="rubric-row__toggle"
                aria-expanded={expanded}
                aria-controls={panelId}
                onClick={() => toggleCriterion(criterion.id)}
              >
                <span className="rubric-row__chevron" aria-hidden="true">
                  {expanded ? <ChevronDown /> : <ChevronRight />}
                </span>
                <span className="rubric-row__identity">
                  <span className="rubric-row__index">Criterion {index + 1}</span>
                  <strong>{criterion.name}</strong>
                  <span>{criterion.summary}</span>
                </span>
                <span className="rubric-row__weight">
                  <strong>{criterion.weight}%</strong>
                  <span>of grade</span>
                </span>
                <span className="rubric-row__snapshot">
                  <span>Plan</span>
                  <strong>{Math.round(planProgress?.percent ?? 0)}%</strong>
                </span>
                <span className="rubric-row__snapshot">
                  <span>Draft</span>
                  <strong>{draftCheck ? `${Math.round(draftCheck.coverage)}%` : "—"}</strong>
                </span>
              </button>

              {expanded ? (
                <div id={panelId} className="rubric-row__details">
                  <div className="rubric-row__progress-grid">
                    <ProgressMetric
                      label="Action-plan completion"
                      value={planProgress?.percent ?? 0}
                      detail={
                        planProgress
                          ? `${Math.round(planProgress.completedMinutes)} of ${Math.round(
                              planProgress.totalMinutes,
                            )} planned minutes complete`
                          : "No plan tasks are linked to this criterion yet."
                      }
                    />
                    <ProgressMetric
                      label="Draft coverage"
                      value={draftCheck?.coverage ?? null}
                      detail={draftCheck?.summary ?? "Run Draft Check to measure this criterion."}
                      muted={!draftCheck}
                    />
                  </div>

                  <div className="rubric-row__detail-grid">
                    <DetailList
                      title="High-performance signals"
                      items={criterion.highPerformance}
                      icon={CheckCircle2}
                      modifier="success"
                    />
                    <DetailList
                      title="Evidence you need"
                      items={criterion.evidenceNeeded}
                      icon={FileSearch}
                      modifier="evidence"
                    />
                    <DetailList
                      title="Where it belongs"
                      items={criterion.reportSections}
                      icon={Map}
                      modifier="sections"
                    />
                    <DetailList
                      title="Common ways to lose marks"
                      items={criterion.commonRisks}
                      icon={AlertTriangle}
                      modifier="risks"
                    />
                  </div>

                  {draftCheck ? (
                    <section className="rubric-row__draft-findings" aria-labelledby={`${panelId}-draft`}>
                      <div className="rubric-row__subheading">
                        <ClipboardCheck aria-hidden="true" />
                        <h4 id={`${panelId}-draft`}>Current draft signal</h4>
                      </div>
                      <div className="rubric-row__draft-columns">
                        <div>
                          <h5>What is working</h5>
                          {draftCheck.strengths.length > 0 ? (
                            <ul>{draftCheck.strengths.map((item) => <li key={item}>{item}</li>)}</ul>
                          ) : (
                            <p>No clear strength has been evidenced yet.</p>
                          )}
                        </div>
                        <div>
                          <h5>What is missing</h5>
                          {draftCheck.gaps.length > 0 ? (
                            <ul>{draftCheck.gaps.map((item) => <li key={item}>{item}</li>)}</ul>
                          ) : (
                            <p>No material gap was identified in this draft check.</p>
                          )}
                        </div>
                      </div>
                    </section>
                  ) : null}

                  <footer className="rubric-row__evidence-footer">
                    <div>
                      <Layers3 aria-hidden="true" />
                        <span>Why RubricTrail mapped this criterion</span>
                    </div>
                    <div className="rubric-row__evidence-actions">
                      {criterion.evidenceRefs.map((evidenceId, evidenceIndex) => (
                        <button
                          key={evidenceId}
                          type="button"
                          onClick={() => onOpenEvidence(evidenceId)}
                          aria-label={`Open source ${evidenceIndex + 1} for ${criterion.name}`}
                        >
                          <Search aria-hidden="true" />
                          Source {evidenceIndex + 1}
                        </button>
                      ))}
                    </div>
                  </footer>
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
