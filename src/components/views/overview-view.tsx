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
  id: string;
  title: string;
  description: string;
  items: LinkedRequirement[];
  icon: LucideIcon;
  emptyMessage?: string;
  onOpenEvidence(id: string): void;
}

function formatDueDate(dueAt: string, timezone: string): string {
  const date = new Date(dueAt);
  if (Number.isNaN(date.getTime())) return dueAt;

  try {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(date);
  } catch {
    return new Intl.DateTimeFormat("en", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  }
}

function EvidenceLinks({ ids, label, onOpenEvidence }: EvidenceLinksProps) {
  if (ids.length === 0) return null;

  return (
    <div className="evidence-links" aria-label={`${label} source evidence`}>
      {ids.map((id, index) => (
        <button
          key={id}
          type="button"
          className="evidence-links__button"
          onClick={() => onOpenEvidence(id)}
          aria-label={`Open source ${index + 1} for ${label}`}
        >
          <Search aria-hidden="true" />
          Source {index + 1}
        </button>
      ))}
    </div>
  );
}

function RequirementSection({
  id,
  title,
  description,
  items,
  icon: Icon,
  emptyMessage = "No items were identified in this category.",
  onOpenEvidence,
}: RequirementSectionProps) {
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
        <p className="overview-section__empty">{emptyMessage}</p>
      ) : (
        <ul className="requirement-list">
          {items.map((item) => (
            <li key={item.id} className="requirement-list__item">
              <div className="requirement-list__content">
                <h3>{item.label}</h3>
                <p>{item.description}</p>
                <div className="requirement-list__meta" aria-label="Requirement classification">
                  <span>{item.priority}</span>
                  <span>{item.status}</span>
                </div>
              </div>
              <EvidenceLinks
                ids={item.evidenceRefs}
                label={item.label}
                onOpenEvidence={onOpenEvidence}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function AmbiguityList({
  items,
  onOpenEvidence,
}: {
  items: Ambiguity[];
  onOpenEvidence(id: string): void;
}) {
  return (
    <section className="overview-section overview-section--risks" aria-labelledby="ambiguities-title">
      <header className="overview-section__header">
        <span className="overview-section__icon" aria-hidden="true">
          <TriangleAlert />
        </span>
        <div>
          <h2 id="ambiguities-title">Questions to resolve</h2>
          <p>Unclear wording that could change the scope, evidence, or marking outcome.</p>
        </div>
      </header>

      {items.length === 0 ? (
        <p className="overview-section__empty">No material ambiguities were identified.</p>
      ) : (
        <ol className="ambiguity-list">
          {items.map((item) => (
            <li key={item.id} className={`ambiguity-list__item ambiguity-list__item--${item.severity}`}>
              <div className="ambiguity-list__heading">
                <h3>{item.question}</h3>
                <span>{item.severity} risk</span>
              </div>
              <dl className="ambiguity-list__details">
                <div>
                  <dt>Why it matters</dt>
                  <dd>{item.whyItMatters}</dd>
                </div>
                <div>
                  <dt>Safe working assumption</dt>
                  <dd>{item.safeWorkingAssumption}</dd>
                </div>
              </dl>
              <EvidenceLinks
                ids={item.evidenceRefs}
                label={item.question}
                onOpenEvidence={onOpenEvidence}
              />
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const PLAIN_ENGLISH_TERMS = [
  ["Process boundary", "The exact point where the process starts and ends."],
  ["Constraint or bottleneck", "The step that limits how much work the whole process can complete."],
  ["Trade-off", "A choice where improving one outcome may weaken another, such as speed versus accuracy."],
  ["Guardrail", "A measure that must not get worse while the main result improves."],
  ["Feasibility", "Whether an idea can realistically work with the available time, people, money, and space."],
] as const;

function PlainEnglishGuide() {
  return (
    <section className="overview-section" aria-labelledby="plain-english-title">
      <header className="overview-section__header">
        <span className="overview-section__icon" aria-hidden="true"><BookOpen /></span>
        <div>
          <h2 id="plain-english-title">Key terms in plain English</h2>
          <p>Short definitions for common operations and rubric language.</p>
        </div>
      </header>
      <ul className="requirement-list">
        {PLAIN_ENGLISH_TERMS.map(([term, meaning]) => (
          <li className="requirement-list__item" key={term}>
            <div className="requirement-list__content"><h3><dfn>{term}</dfn></h3><p>{meaning}</p></div>
          </li>
        ))}
      </ul>
    </section>
  );
}
export function OverviewView({ analysis, onOpenEvidence, onNavigate }: OverviewViewProps) {
  const wordCount = analysis.wordCount;
  const wordCountSummary = `${wordCount.target.toLocaleString("en")} words${
    wordCount.tolerancePercent > 0 ? `, ±${wordCount.tolerancePercent}%` : ""
  }`;

  return (
    <div className="overview-view">
      <header className="overview-hero">
        <div className="overview-hero__copy">
          <span className="overview-hero__eyebrow">Assignment decoded</span>
          <h1>{analysis.title}</h1>
          <p>{analysis.executiveSummary}</p>
        </div>
        <div className="overview-hero__actions" aria-label="Next steps">
          <button
            type="button"
            className="overview-hero__primary-action"
            onClick={() => onNavigate("rubric")}
          >
            Open rubric map
            <ArrowRight aria-hidden="true" />
          </button>
          <button
            type="button"
            className="overview-hero__secondary-action"
            onClick={() => onNavigate("plan")}
          >
            View action plan
          </button>
        </div>
      </header>

      <section className="assignment-facts" aria-labelledby="assignment-facts-title">
        <div className="assignment-facts__heading">
          <FileCheck2 aria-hidden="true" />
          <h2 id="assignment-facts-title">Assignment facts</h2>
        </div>
        <dl className="assignment-facts__grid">
          <div className="assignment-facts__item">
            <dt><BookOpen aria-hidden="true" />Course</dt>
            <dd>{analysis.course}</dd>
            <span>{analysis.subject}</span>
          </div>
          <div className="assignment-facts__item">
            <dt><FileText aria-hidden="true" />Format</dt>
            <dd>{analysis.assignmentType}</dd>
            <span>{wordCountSummary}</span>
          </div>
          <div className="assignment-facts__item">
            <dt><CalendarDays aria-hidden="true" />Due</dt>
            <dd>{formatDueDate(analysis.dueAt, analysis.timezone)}</dd>
            <span>{analysis.timezone}</span>
          </div>
          <div className="assignment-facts__item">
            <dt><Flag aria-hidden="true" />Referencing</dt>
            <dd>{analysis.citationStyle}</dd>
            <span>Check every claim before submission</span>
          </div>
        </dl>
      </section>

      <PlainEnglishGuide />

      <div className="overview-view__primary-grid">
        <RequirementSection
          id="deliverables"
          title="What you must submit"
          description="Explicit outputs that need to be present in the final submission."
          items={analysis.deliverables}
          icon={FileCheck2}
          onOpenEvidence={onOpenEvidence}
        />
        <RequirementSection
          id="learning-objectives"
          title="What the work must demonstrate"
          description="Learning outcomes translated into observable work."
          items={analysis.learningObjectives}
          icon={Target}
          onOpenEvidence={onOpenEvidence}
        />
      </div>

      <RequirementSection
        id="constraints"
        title="Rules and boundaries"
        description="Limits that shape the report even when they do not earn marks directly."
        items={analysis.constraints}
        icon={Flag}
        onOpenEvidence={onOpenEvidence}
      />

      <AmbiguityList items={analysis.ambiguities} onOpenEvidence={onOpenEvidence} />

      <div className="overview-view__risk-grid">
        <RequirementSection
          id="hidden-requirements"
          title="Easy-to-miss requirements"
          description="Implied work that students commonly overlook when reading quickly."
          items={analysis.hiddenRequirements}
          icon={Eye}
          emptyMessage="No additional hidden requirements were inferred."
          onOpenEvidence={onOpenEvidence}
        />
        <RequirementSection
          id="integrity-guidance"
          title="Academic integrity guardrails"
          description="Checks that keep the work yours, traceable, and defensible."
          items={analysis.integrityGuidance}
          icon={ShieldCheck}
          onOpenEvidence={onOpenEvidence}
        />
      </div>
    </div>
  );
}
