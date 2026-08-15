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
import { useI18n, useLocalizedMessages } from "@/components/locale-provider";
import {
  interpolateViewMessage,
  localizeSampleRubricListItem,
  localizeSampleRubricSummary,
  localizeSystemText,
  rubricMessagesEn,
  rubricMessagesZhCN,
} from "@/lib/i18n/messages/views";

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
  const messages = useLocalizedMessages(rubricMessagesEn, rubricMessagesZhCN);
  const { formatNumber } = useI18n();
  const normalizedValue = value === null ? 0 : Math.max(0, Math.min(100, value));

  return (
    <div className={`rubric-progress ${muted ? "rubric-progress--muted" : ""}`}>
      <div className="rubric-progress__label-row">
        <span>{label}</span>
        <strong>{value === null ? messages.notChecked : `${formatNumber(Math.round(normalizedValue))}%`}</strong>
      </div>
      <progress value={normalizedValue} max={100} aria-label={label} />
      {detail ? <p>{detail}</p> : null}
    </div>
  );
}

export function RubricView({ analysis, draftResult, plan, onOpenEvidence }: RubricViewProps) {
  const messages = useLocalizedMessages(rubricMessagesEn, rubricMessagesZhCN);
  const { locale, formatNumber } = useI18n();
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
          <span className="rubric-view__eyebrow">{messages.eyebrow}</span>
          <h1>{messages.title}</h1>
          <p>{messages.description}</p>
        </div>

        <dl className="rubric-summary" aria-label={messages.summary}>
          <div className="rubric-summary__item">
            <dt>{messages.weightMapped}</dt>
            <dd>{formatNumber(Math.round(totalWeight))}%</dd>
          </div>
          <div className="rubric-summary__item">
            <dt>{messages.planCompleted}</dt>
            <dd>{formatNumber(Math.round(plan.completionPercent))}%</dd>
          </div>
          <div className="rubric-summary__item">
            <dt>{messages.draftCoverage}</dt>
            <dd>{draftResult ? `${formatNumber(Math.round(draftResult.coverageEstimate))}%` : messages.notChecked}</dd>
          </div>
        </dl>
      </header>

      <div className="rubric-table" role="list" aria-label={messages.criteria}>
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
                  <span className="rubric-row__index">
                    {interpolateViewMessage(messages.criterion, {
                      number: formatNumber(index + 1),
                    })}
                  </span>
                  <strong>{criterion.name}</strong>
                  <span>
                    {localizeSampleRubricSummary(
                      analysis.id,
                      criterion.id,
                      criterion.summary,
                      locale,
                    )}
                  </span>
                </span>
                <span className="rubric-row__weight">
                  <strong>{formatNumber(criterion.weight)}%</strong>
                  <span>{messages.ofGrade}</span>
                </span>
                <span className="rubric-row__snapshot">
                  <span>{messages.plan}</span>
                  <strong>{formatNumber(Math.round(planProgress?.percent ?? 0))}%</strong>
                </span>
                <span className="rubric-row__snapshot">
                  <span>{messages.draft}</span>
                  <strong>{draftCheck ? `${formatNumber(Math.round(draftCheck.coverage))}%` : "—"}</strong>
                </span>
              </button>

              {expanded ? (
                <div id={panelId} className="rubric-row__details">
                  <div className="rubric-row__progress-grid">
                    <ProgressMetric
                      label={messages.actionCompletion}
                      value={planProgress?.percent ?? 0}
                      detail={
                        planProgress
                          ? interpolateViewMessage(messages.minutesComplete, {
                              completed: formatNumber(Math.round(planProgress.completedMinutes)),
                              total: formatNumber(Math.round(planProgress.totalMinutes)),
                            })
                          : messages.noPlanTasks
                      }
                    />
                    <ProgressMetric
                      label={messages.draftCoverage}
                      value={draftCheck?.coverage ?? null}
                      detail={draftCheck ? localizeSystemText(draftCheck.summary, locale) : messages.runDraftCheck}
                      muted={!draftCheck}
                    />
                  </div>

                  <div className="rubric-row__detail-grid">
                    <DetailList
                      title={messages.highPerformance}
                      items={criterion.highPerformance.map((item, index) =>
                        localizeSampleRubricListItem(
                          analysis.id,
                          criterion.id,
                          "highPerformance",
                          index,
                          item,
                          locale,
                        ),
                      )}
                      icon={CheckCircle2}
                      modifier="success"
                    />
                    <DetailList
                      title={messages.evidenceNeeded}
                      items={criterion.evidenceNeeded.map((item, index) =>
                        localizeSampleRubricListItem(
                          analysis.id,
                          criterion.id,
                          "evidenceNeeded",
                          index,
                          item,
                          locale,
                        ),
                      )}
                      icon={FileSearch}
                      modifier="evidence"
                    />
                    <DetailList
                      title={messages.whereBelongs}
                      items={criterion.reportSections.map((item, index) =>
                        localizeSampleRubricListItem(
                          analysis.id,
                          criterion.id,
                          "reportSections",
                          index,
                          item,
                          locale,
                        ),
                      )}
                      icon={Map}
                      modifier="sections"
                    />
                    <DetailList
                      title={messages.commonRisks}
                      items={criterion.commonRisks.map((item, index) =>
                        localizeSampleRubricListItem(
                          analysis.id,
                          criterion.id,
                          "commonRisks",
                          index,
                          item,
                          locale,
                        ),
                      )}
                      icon={AlertTriangle}
                      modifier="risks"
                    />
                  </div>

                  {draftCheck ? (
                    <section className="rubric-row__draft-findings" aria-labelledby={`${panelId}-draft`}>
                      <div className="rubric-row__subheading">
                        <ClipboardCheck aria-hidden="true" />
                        <h4 id={`${panelId}-draft`}>{messages.currentSignal}</h4>
                      </div>
                      <div className="rubric-row__draft-columns">
                        <div>
                          <h5>{messages.working}</h5>
                          {draftCheck.strengths.length > 0 ? (
                            <ul>{draftCheck.strengths.map((item) => <li key={item}>{localizeSystemText(item, locale)}</li>)}</ul>
                          ) : (
                            <p>{messages.noStrength}</p>
                          )}
                        </div>
                        <div>
                          <h5>{messages.missing}</h5>
                          {draftCheck.gaps.length > 0 ? (
                            <ul>{draftCheck.gaps.map((item) => <li key={item}>{localizeSystemText(item, locale)}</li>)}</ul>
                          ) : (
                            <p>{messages.noGap}</p>
                          )}
                        </div>
                      </div>
                    </section>
                  ) : null}

                  <footer className="rubric-row__evidence-footer">
                    <div>
                      <Layers3 aria-hidden="true" />
                        <span>{messages.mappingReason}</span>
                    </div>
                    <div className="rubric-row__evidence-actions">
                      {criterion.evidenceRefs.map((evidenceId, evidenceIndex) => (
                        <button
                          key={evidenceId}
                          type="button"
                          onClick={() => onOpenEvidence(evidenceId)}
                          aria-label={interpolateViewMessage(messages.openSource, {
                            number: formatNumber(evidenceIndex + 1),
                            label: criterion.name,
                          })}
                        >
                          <Search aria-hidden="true" />
                          {interpolateViewMessage(messages.source, {
                            number: formatNumber(evidenceIndex + 1),
                          })}
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
