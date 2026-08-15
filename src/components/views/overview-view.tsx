"use client";

import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  Eye,
  FileCheck2,
  FileText,
  Flag,
  Search,
  ShieldCheck,
  Target,
  TriangleAlert,
} from "lucide-react";

import type {
  Ambiguity,
  AssignmentAnalysis,
  LinkedRequirement,
} from "@/lib/domain";
import { useI18n, useLocalizedMessages } from "@/components/locale-provider";
import {
  interpolateViewMessage,
  localizeSampleAmbiguityText,
  localizeSampleOverviewFact,
  localizeSampleRequirementText,
  overviewMessagesEn,
  overviewMessagesZhCN,
} from "@/lib/i18n/messages/views";

interface OverviewViewProps {
  analysis: AssignmentAnalysis;
  onOpenEvidence(id: string): void;
  onNavigate(view: "rubric" | "plan"): void;
}

interface EvidenceLinksProps {
  ids: string[];
  label: string;
  onOpenEvidence(id: string): void;
}

interface RequirementSectionProps {
  analysisId: string;
  id: string;
  title: string;
  description: string;
  items: LinkedRequirement[];
  icon: LucideIcon;
  emptyMessage?: string;
  onOpenEvidence(id: string): void;
}

function EvidenceLinks({ ids, label, onOpenEvidence }: EvidenceLinksProps) {
  const messages = useLocalizedMessages(overviewMessagesEn, overviewMessagesZhCN);
  const { formatNumber } = useI18n();
  if (ids.length === 0) return null;

  return (
    <div
      className="evidence-links"
      aria-label={interpolateViewMessage(messages.evidenceGroup, { label })}
    >
      {ids.map((id, index) => (
        <button
          key={id}
          type="button"
          className="evidence-links__button"
          onClick={() => onOpenEvidence(id)}
          aria-label={interpolateViewMessage(messages.openSource, {
            number: formatNumber(index + 1),
            label,
          })}
        >
          <Search aria-hidden="true" />
          {interpolateViewMessage(messages.source, { number: formatNumber(index + 1) })}
        </button>
      ))}
    </div>
  );
}

function RequirementSection({
  analysisId,
  id,
  title,
  description,
  items,
  icon: Icon,
  emptyMessage,
  onOpenEvidence,
}: RequirementSectionProps) {
  const messages = useLocalizedMessages(overviewMessagesEn, overviewMessagesZhCN);
  const { locale } = useI18n();
  const localizedClassification = (value: string) => {
    if (value === "required") return messages.required;
    if (value === "recommended") return messages.recommended;
    if (value === "explicit") return messages.explicit;
    if (value === "inferred") return messages.inferred;
    return value;
  };

  return (
    <section className="overview-section" aria-labelledby={`${id}-title`}>
      <header className="overview-section__header">
        <span className="overview-section__icon" aria-hidden="true">
          <Icon />
        </span>
        <div>
          <h2 id={`${id}-title`}>{title}</h2>
          <p>{description}</p>
        </div>
      </header>

      {items.length === 0 ? (
        <p className="overview-section__empty">{emptyMessage ?? messages.noItems}</p>
      ) : (
        <ul className="requirement-list">
          {items.map((item) => {
            const localizedLabel = localizeSampleRequirementText(
              analysisId,
              item.id,
              "label",
              item.label,
              locale,
            );
            return (
              <li key={item.id} className="requirement-list__item">
                <div className="requirement-list__content">
                  <h3>{localizedLabel}</h3>
                  <p>
                    {localizeSampleRequirementText(
                      analysisId,
                      item.id,
                      "description",
                      item.description,
                      locale,
                    )}
                  </p>
                  <div className="requirement-list__meta" aria-label={messages.classification}>
                    <span>{localizedClassification(item.priority)}</span>
                    <span>{localizedClassification(item.status)}</span>
                  </div>
                </div>
                <EvidenceLinks
                  ids={item.evidenceRefs}
                  label={localizedLabel}
                  onOpenEvidence={onOpenEvidence}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function AmbiguityList({
  analysisId,
  items,
  onOpenEvidence,
}: {
  analysisId: string;
  items: Ambiguity[];
  onOpenEvidence(id: string): void;
}) {
  const messages = useLocalizedMessages(overviewMessagesEn, overviewMessagesZhCN);
  const { locale } = useI18n();
  const localizedSeverity = (value: string) => {
    if (value === "high") return messages.high;
    if (value === "medium") return messages.medium;
    if (value === "low") return messages.low;
    return value;
  };

  return (
    <section className="overview-section overview-section--risks" aria-labelledby="ambiguities-title">
      <header className="overview-section__header">
        <span className="overview-section__icon" aria-hidden="true">
          <TriangleAlert />
        </span>
        <div>
          <h2 id="ambiguities-title">{messages.questionsTitle}</h2>
          <p>{messages.questionsDescription}</p>
        </div>
      </header>

      {items.length === 0 ? (
        <p className="overview-section__empty">{messages.noAmbiguities}</p>
      ) : (
        <ol className="ambiguity-list">
          {items.map((item) => {
            const localizedQuestion = localizeSampleAmbiguityText(
              analysisId,
              item.id,
              "question",
              item.question,
              locale,
            );
            return (
              <li key={item.id} className={`ambiguity-list__item ambiguity-list__item--${item.severity}`}>
                <div className="ambiguity-list__heading">
                  <h3>{localizedQuestion}</h3>
                  <span>
                    {interpolateViewMessage(messages.risk, {
                      severity: localizedSeverity(item.severity),
                    })}
                  </span>
                </div>
                <dl className="ambiguity-list__details">
                  <div>
                    <dt>{messages.whyItMatters}</dt>
                    <dd>
                      {localizeSampleAmbiguityText(
                        analysisId,
                        item.id,
                        "whyItMatters",
                        item.whyItMatters,
                        locale,
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{messages.safeAssumption}</dt>
                    <dd>
                      {localizeSampleAmbiguityText(
                        analysisId,
                        item.id,
                        "safeWorkingAssumption",
                        item.safeWorkingAssumption,
                        locale,
                      )}
                    </dd>
                  </div>
                </dl>
                <EvidenceLinks
                  ids={item.evidenceRefs}
                  label={localizedQuestion}
                  onOpenEvidence={onOpenEvidence}
                />
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function PlainEnglishGuide() {
  const messages = useLocalizedMessages(overviewMessagesEn, overviewMessagesZhCN);
  const terms = [
    [messages.termProcessBoundary, messages.meaningProcessBoundary],
    [messages.termBottleneck, messages.meaningBottleneck],
    [messages.termTradeoff, messages.meaningTradeoff],
    [messages.termGuardrail, messages.meaningGuardrail],
    [messages.termFeasibility, messages.meaningFeasibility],
  ] as const;

  return (
    <section className="overview-section" aria-labelledby="plain-english-title">
      <header className="overview-section__header">
        <span className="overview-section__icon" aria-hidden="true"><BookOpen /></span>
        <div>
          <h2 id="plain-english-title">{messages.termsTitle}</h2>
          <p>{messages.termsDescription}</p>
        </div>
      </header>
      <ul className="requirement-list">
        {terms.map(([term, meaning]) => (
          <li className="requirement-list__item" key={term}>
            <div className="requirement-list__content"><h3><dfn>{term}</dfn></h3><p>{meaning}</p></div>
          </li>
        ))}
      </ul>
    </section>
  );
}
export function OverviewView({ analysis, onOpenEvidence, onNavigate }: OverviewViewProps) {
  const messages = useLocalizedMessages(overviewMessagesEn, overviewMessagesZhCN);
  const { locale, formatDate, formatNumber } = useI18n();
  const wordCount = analysis.wordCount;
  const wordCountSummary = `${interpolateViewMessage(messages.words, {
    count: formatNumber(wordCount.target),
  })}${
    wordCount.tolerancePercent > 0 ? `, ±${wordCount.tolerancePercent}%` : ""
  }`;
  const dueDate = new Date(analysis.dueAt);
  let dueLabel = analysis.dueAt;
  if (!Number.isNaN(dueDate.getTime())) {
    try {
      dueLabel = formatDate(dueDate, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: analysis.timezone,
      });
    } catch {
      dueLabel = formatDate(dueDate, { dateStyle: "medium", timeStyle: "short" });
    }
  }

  return (
    <div className="overview-view">
      <header className="overview-hero">
        <div className="overview-hero__copy">
          <span className="overview-hero__eyebrow">{messages.decoded}</span>
          <h1>{analysis.title}</h1>
          <p>
            {localizeSampleOverviewFact(
              analysis.id,
              "executiveSummary",
              analysis.executiveSummary,
              locale,
            )}
          </p>
        </div>
        <div className="overview-hero__actions" aria-label={messages.nextSteps}>
          <button
            type="button"
            className="overview-hero__primary-action"
            onClick={() => onNavigate("rubric")}
          >
            {messages.openRubric}
            <ArrowRight aria-hidden="true" />
          </button>
          <button
            type="button"
            className="overview-hero__secondary-action"
            onClick={() => onNavigate("plan")}
          >
            {messages.viewPlan}
          </button>
        </div>
      </header>

      <section className="assignment-facts" aria-labelledby="assignment-facts-title">
        <div className="assignment-facts__heading">
          <FileCheck2 aria-hidden="true" />
          <h2 id="assignment-facts-title">{messages.facts}</h2>
        </div>
        <dl className="assignment-facts__grid">
          <div className="assignment-facts__item">
            <dt><BookOpen aria-hidden="true" />{messages.course}</dt>
            <dd>{analysis.course}</dd>
            <span>
              {localizeSampleOverviewFact(analysis.id, "subject", analysis.subject, locale)}
            </span>
          </div>
          <div className="assignment-facts__item">
            <dt><FileText aria-hidden="true" />{messages.format}</dt>
            <dd>
              {localizeSampleOverviewFact(
                analysis.id,
                "assignmentType",
                analysis.assignmentType,
                locale,
              )}
            </dd>
            <span>{wordCountSummary}</span>
          </div>
          <div className="assignment-facts__item">
            <dt><CalendarDays aria-hidden="true" />{messages.due}</dt>
            <dd>{dueLabel}</dd>
            <span>{analysis.timezone}</span>
          </div>
          <div className="assignment-facts__item">
            <dt><Flag aria-hidden="true" />{messages.referencing}</dt>
            <dd>{analysis.citationStyle}</dd>
            <span>{messages.checkClaims}</span>
          </div>
        </dl>
      </section>

      <PlainEnglishGuide />

      <div className="overview-view__primary-grid">
        <RequirementSection
          analysisId={analysis.id}
          id="deliverables"
          title={messages.mustSubmit}
          description={messages.mustSubmitDescription}
          items={analysis.deliverables}
          icon={FileCheck2}
          onOpenEvidence={onOpenEvidence}
        />
        <RequirementSection
          analysisId={analysis.id}
          id="learning-objectives"
          title={messages.demonstrate}
          description={messages.demonstrateDescription}
          items={analysis.learningObjectives}
          icon={Target}
          onOpenEvidence={onOpenEvidence}
        />
      </div>

      <RequirementSection
        analysisId={analysis.id}
        id="constraints"
        title={messages.boundaries}
        description={messages.boundariesDescription}
        items={analysis.constraints}
        icon={Flag}
        onOpenEvidence={onOpenEvidence}
      />

      <AmbiguityList
        analysisId={analysis.id}
        items={analysis.ambiguities}
        onOpenEvidence={onOpenEvidence}
      />

      <div className="overview-view__risk-grid">
        <RequirementSection
          analysisId={analysis.id}
          id="hidden-requirements"
          title={messages.hidden}
          description={messages.hiddenDescription}
          items={analysis.hiddenRequirements}
          icon={Eye}
          emptyMessage={messages.noHidden}
          onOpenEvidence={onOpenEvidence}
        />
        <RequirementSection
          analysisId={analysis.id}
          id="integrity-guidance"
          title={messages.integrity}
          description={messages.integrityDescription}
          items={analysis.integrityGuidance}
          icon={ShieldCheck}
          onOpenEvidence={onOpenEvidence}
        />
      </div>
    </div>
  );
}
