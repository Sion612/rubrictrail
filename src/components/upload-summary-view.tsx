"use client";

import {
  type CSSProperties,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n, useLocalizedMessages } from "@/components/locale-provider";
import {
  createUploadedProject,
  draftFromUpload,
  validateUploadedProjectDraftIssues,
  type UploadedProjectDraftIssue,
} from "@/lib/uploaded-project";
import type {
  AssignmentFileErrorCode,
  UploadedSummaryFieldStatus,
} from "@/lib/files/parse-assignment-files";
import {
  formatIntakeMessage,
  intakeEn,
  intakeZhCN,
  type IntakeMessages,
} from "@/lib/i18n/messages/intake";
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

const FILE_ISSUE_MESSAGE_KEY: Record<AssignmentFileErrorCode, keyof IntakeMessages> = {
  UNSUPPORTED_FILE_TYPE: "issueUnsupportedType",
  INVALID_FILE_NAME: "issueInvalidName",
  FILE_TOO_LARGE: "issueFileTooLarge",
  TOO_MANY_FILES: "issueTooManyFiles",
  TOTAL_FILE_SIZE_TOO_LARGE: "issueTotalSize",
  EXTRACTED_TEXT_TOO_LARGE: "issueTextTooLarge",
  EXTRACTED_TEXT_TOO_MANY_LINES: "issueTooManyLines",
  EXTRACTED_TEXT_TOO_MANY_WORDS: "issueTooManyWords",
  PDF_TOO_MANY_PAGES: "issuePdfTooLong",
  TOTAL_PDF_PAGES_TOO_LARGE: "issuePdfsTooLong",
  EMPTY_FILE: "issueEmpty",
  INVALID_TEXT_ENCODING: "issueEncoding",
  SCANNED_NO_TEXT: "issueScanned",
  ENCRYPTED_PDF: "issueEncrypted",
  PARSER_UNAVAILABLE: "issueParser",
  CORRUPT_DOCUMENT: "issueCorrupt",
};

function fileIssueReason(code: AssignmentFileErrorCode, messages: IntakeMessages): string {
  return messages[FILE_ISSUE_MESSAGE_KEY[code]];
}

const CONFIRM_FIELD_STYLE = {
  display: "flex",
  flexDirection: "column",
  gap: 7,
  minWidth: 0,
} satisfies CSSProperties;

function sourceDisplayName(value: string, messages: IntakeMessages, isPasted: boolean): string {
  if (!isPasted) return value;
  if (/^Pasted assignment brief\.txt$/i.test(value)) return messages.pastedBriefSource;
  if (/^Pasted rubric\.txt$/i.test(value)) return messages.pastedRubricSource;
  return value;
}

function EvidenceNote({
  evidence,
  messages,
  isPasted,
}: {
  evidence: UploadedProjectDraft["criteria"][number]["evidence"];
  messages: IntakeMessages;
  isPasted: boolean;
}) {
  if (!evidence) return <small>{messages.evidenceNone}</small>;
  return (
    <details className="source-evidence-note">
      <summary>
        {formatIntakeMessage(messages.evidenceSource, {
          source: evidence.fileName
            ? sourceDisplayName(evidence.fileName, messages, isPasted)
            : messages.evidenceSourceText,
        })}
        {evidence.page
          ? formatIntakeMessage(messages.evidencePage, { page: evidence.page })
          : ""}
      </summary>
      <blockquote>{evidence.excerpt}</blockquote>
    </details>
  );
}

function FieldStatus({
  status,
  edited,
  isPasted,
  messages,
}: {
  status: UploadedSummaryFieldStatus;
  edited: boolean;
  isPasted: boolean;
  messages: IntakeMessages;
}) {
  if (edited) {
    return <small className="field-source-status manual">{messages.statusEdited}</small>;
  }
  const message = {
    found: isPasted ? messages.statusFoundPasted : messages.statusFoundUpload,
    inferred: isPasted
      ? messages.statusInferredPasted
      : messages.statusInferredUpload,
    missing: messages.statusMissing,
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

function localizedParserMessage(message: string, messages: IntakeMessages): string {
  const fixedMessages: Record<string, string> = {
    "Assignment title was not found in the uploaded text.": messages.warningTitleMissing,
    "The title was inferred from the first heading; verify it against the brief.":
      messages.warningTitleInferred,
    "Due date was not found; add it before relying on the plan.":
      messages.warningDeadlineMissing,
    "Word count was not found in the uploaded text.": messages.warningWordsMissing,
    "Citation or referencing style was not found.": messages.warningCitationMissing,
    "No reliable rubric section was detected. Rubric analysis is incomplete; no weights were assumed.":
      messages.rubricNone,
    "A rubric heading was found, but no reliable criteria were extracted. Rubric analysis is incomplete; no weights were assumed.":
      messages.rubricHeadingOnly,
  };
  if (fixedMessages[message]) return fixedMessages[message];

  const missingWeights = message.match(
    /^Detected (\d+) rubric criteria, but (\d+) (?:weight was|weights were) not explicit\. Missing weights remain blank\.$/,
  );
  if (missingWeights) {
    return formatIntakeMessage(
      Number(missingWeights[2]) === 1
        ? messages.rubricMissingWeight
        : messages.rubricMissingWeights,
      { criteria: missingWeights[1], missing: missingWeights[2] },
    );
  }

  const wrongTotal = message.match(
    /^Explicit rubric weights total ([\d.]+)%, not 100%\. Verify whether criteria are missing\.$/,
  );
  if (wrongTotal) {
    return formatIntakeMessage(messages.rubricWrongTotal, { total: wrongTotal[1] });
  }

  const complete = message.match(
    /^Detected (\d+) rubric criteria with explicit weights totalling 100%\.$/,
  );
  if (complete) {
    return formatIntakeMessage(messages.rubricComplete, { criteria: complete[1] });
  }

  return message;
}

function localizedDraftIssue(
  issue: UploadedProjectDraftIssue,
  messages: IntakeMessages,
): UploadedProjectDraftIssue {
  const fixedMessages: Record<string, string> = {
    "Add an assignment title.": messages.errorTitleRequired,
    "Keep the assignment title under 300 characters.": messages.errorTitleLength,
    "Use a single-line assignment title without control or bidirectional formatting characters.":
      messages.errorTitleUnsafe,
    "Keep the course or module under 200 characters.": messages.errorCourseLength,
    "Use a single-line course or module name without control or bidirectional formatting characters.":
      messages.errorCourseUnsafe,
    "Add a real calendar deadline.": messages.errorDeadlineReal,
    "Choose a deadline within the next four years.": messages.errorDeadlineRange,
    "Add a positive whole-number word count.": messages.errorWordsPositive,
    "Keep the word count at or below 50,000 words.": messages.errorWordsMaximum,
    "Add a citation style, or enter “Not specified”.": messages.errorCitationRequired,
    "Keep the citation style under 160 characters.": messages.errorCitationLength,
    "Add at least one rubric criterion.": messages.errorCriterionRequired,
    "Keep the rubric to 50 criteria or fewer.": messages.errorCriterionMaximum,
    "Choose whether the official rubric provides a complete percentage breakdown.":
      messages.errorWeightingChoice,
  };
  let localizedMessage = fixedMessages[issue.message];
  const criterionNumber = Number(issue.targetId.match(/-(\d+)$/)?.[1] ?? -1) + 1;

  if (!localizedMessage && issue.targetId.startsWith("criterion-name-")) {
    localizedMessage = formatIntakeMessage(
      issue.message.includes("under 300")
        ? messages.errorCriterionNameLength
        : messages.errorCriterionName,
      { number: criterionNumber },
    );
  }
  if (!localizedMessage && issue.targetId.startsWith("criterion-weight-")) {
    if (issue.message.startsWith("Published rubric weights must total")) {
      const total = issue.message.match(/currently total ([\d.]+)%/)?.[1] ?? "0";
      localizedMessage = formatIntakeMessage(messages.errorWeightTotal, { total });
    } else {
      localizedMessage = formatIntakeMessage(
        issue.message.includes("greater than 0")
          ? messages.errorCriterionWeightRange
          : messages.errorCriterionWeight,
        { number: criterionNumber },
      );
    }
  }

  return { ...issue, message: localizedMessage ?? issue.message };
}

export function UploadSummaryView({
  result,
  onBack,
  onCreateProject,
}: UploadSummaryViewProps) {
  const { locale, formatNumber } = useI18n();
  const messages = useLocalizedMessages<IntakeMessages>(intakeEn, intakeZhCN);
  const initialDraft = useMemo(() => draftFromUpload(result), [result]);
  const [draft, setDraft] = useState<UploadedProjectDraft>(() => initialDraft);
  const [showErrors, setShowErrors] = useState(false);
  const [criterionOrigins, setCriterionOrigins] = useState<
    Array<UploadedProjectDraft["criteria"][number] | null>
  >(() =>
    initialDraft.criteria.map((criterion) => ({ ...criterion })),
  );
  const [criterionKeys, setCriterionKeys] = useState(
    initialDraft.criteria.map((_, index) => `detected-${index + 1}`),
  );
  const nextCriterionKeyRef = useRef(0);
  const errorSummaryRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const issues = useMemo(() => validateUploadedProjectDraftIssues(draft), [draft]);
  const displayedIssues = useMemo(
    () => issues.map((issue) => localizedDraftIssue(issue, messages)),
    [issues, messages],
  );
  const issueByTarget = useMemo(() => {
    const firstIssueByTarget = new Map<string, UploadedProjectDraftIssue>();
    displayedIssues.forEach((issue) => {
      if (!firstIssueByTarget.has(issue.targetId)) {
        firstIssueByTarget.set(issue.targetId, issue);
      }
    });
    return firstIssueByTarget;
  }, [displayedIssues]);
  const totalWeight = draft.criteria.reduce(
    (total, criterion) => total + (Number(criterion.weight) || 0),
    0,
  );
  const recordedWeightCount = draft.criteria.filter(
    (criterion) => criterion.weight.trim() !== "",
  ).length;
  const isPasted = result.intakeMethod === "paste";
  const isPartial = result.skippedFiles.length > 0;
  const selectedFileCount = result.fileNames.length + result.skippedFiles.length;
  const sourceContainsPercentageValues = result.summary.rubric.criteria.some(
    (criterion) => criterion.weight !== null,
  );

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
    const origin = criterionOrigins[index];
    setDraft((current) => ({
      ...current,
      criteria: current.criteria.map((criterion, criterionIndex) => {
        if (criterionIndex !== index) return criterion;
        const nextCriterion = { ...criterion, [key]: value };
        return {
          ...nextCriterion,
          evidence:
            origin &&
            nextCriterion.name === origin.name
              ? origin.evidence
              : null,
        };
      }),
    }));
  }

  function addCriterion() {
    setCriterionOrigins((current) => [...current, null]);
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
    setCriterionOrigins((current) => current.filter(
      (_, criterionIndex) => criterionIndex !== index,
    ));
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
          <ArrowLeft aria-hidden="true" />{messages.summaryBack}
        </button>
        <div className="header-actions">
          <LanguageSwitcher compact />
          <div className="mode-indicator">
            <span aria-hidden="true" />
            {isPasted
              ? messages.summaryStatusPasted
              : isPartial
                ? messages.summaryStatusPartial
                : messages.summaryStatusComplete}
          </div>
        </div>
      </header>

      <form className="summary-content summary-content-wide" onSubmit={submit} noValidate>
        <div className="summary-intro">
          <CheckCircle2 aria-hidden="true" />
          <div>
            <p className="eyebrow">{messages.summaryEyebrow}</p>
            <h1 ref={headingRef} tabIndex={-1}>{messages.summaryTitle}</h1>
            <p>{messages.summaryIntro}</p>
          </div>
        </div>

        {locale === "zh-CN" ? (
          <div className="inline-alert warning compact-alert" role="note">
            <AlertTriangle aria-hidden="true" />
            <p>{messages.chineseReviewWarning}</p>
          </div>
        ) : null}

        {isPartial ? (
          <section
            className="inline-alert warning partial-summary-warning"
            aria-labelledby="partial-summary-title"
          >
            <AlertTriangle aria-hidden="true" />
            <div>
              <h2 id="partial-summary-title">
                {formatIntakeMessage(messages.partialSummaryTitle, {
                  ready: result.fileNames.length,
                  selected: selectedFileCount,
                })}
              </h2>
              <p>
                {messages.partialSummaryBody}
              </p>
              <ul className="intake-file-list issue-list">
                {result.skippedFiles.map((issue) => (
                  <li key={`${issue.inputIndex}-${issue.code}`}>
                    <strong>{issue.fileName}</strong>
                    <span>{fileIssueReason(issue.code, messages)}</span>
                  </li>
                ))}
              </ul>
              <button
                className="button button-ghost"
                type="button"
                onClick={onBack}
              >
                {messages.reviewFileSelection}
              </button>
            </div>
          </section>
        ) : null}

        <div className="source-strip">
          <FileText aria-hidden="true" />
          <div>
            <strong>{result.fileNames.map((name) => sourceDisplayName(name, messages, isPasted)).join(", ")}</strong>
            <span>
              {formatIntakeMessage(
                result.fileNames.length === 1
                  ? messages.readableSourceOne
                  : messages.readableSourceMany,
                {
                  count: formatNumber(result.fileNames.length),
                  words: formatNumber(result.totalWords),
                },
              )}
            </span>
          </div>
        </div>

        {result.summary.warnings.length ? (
          <section className="inline-alert warning" aria-labelledby="parse-warning-title">
            <AlertTriangle aria-hidden="true" />
            <div>
              <strong id="parse-warning-title">{messages.confirmationItems}</strong>
              <ul>
                {result.summary.warnings.map((warning) => (
                  <li key={warning}>{localizedParserMessage(warning, messages)}</li>
                ))}
              </ul>
            </div>
          </section>
        ) : null}

        <section className="confirm-fields" aria-labelledby="project-details-title">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">{messages.detailsEyebrow}</p>
              <h2 id="project-details-title">{messages.detailsTitle}</h2>
            </div>
          </div>
          <div className="confirm-field-grid">
            <div className="confirm-field" style={CONFIRM_FIELD_STYLE}>
              <label htmlFor="confirm-title">
                <span>{messages.assignmentTitle}</span>
                <input
                  {...errorAttributes("confirm-title")}
                  value={draft.title}
                  onChange={(event) => updateField("title", event.target.value)}
                  placeholder={messages.assignmentPlaceholder}
                  maxLength={300}
                  data-testid="confirm-title"
                />
              </label>
              <FieldStatus status={result.summary.title.status} edited={draft.title !== initialDraft.title} isPasted={isPasted} messages={messages} />
              <EvidenceNote evidence={result.summary.title.evidence} messages={messages} isPasted={isPasted} />
              <FieldError issue={showErrors ? issueByTarget.get("confirm-title") : undefined} />
            </div>
            <div className="confirm-field" style={CONFIRM_FIELD_STYLE}>
              <label htmlFor="confirm-course">
                <span>{messages.courseLabel} <small>{messages.optional}</small></span>
                <input
                  {...errorAttributes("confirm-course")}
                  value={draft.course}
                  onChange={(event) => updateField("course", event.target.value)}
                  placeholder={messages.coursePlaceholder}
                  maxLength={200}
                />
              </label>
              <small>{messages.courseHint}</small>
              <FieldError issue={showErrors ? issueByTarget.get("confirm-course") : undefined} />
            </div>
            <div className="confirm-field" style={CONFIRM_FIELD_STYLE}>
              <label htmlFor="confirm-deadline">
                <span>{messages.deadline}</span>
                <input
                  {...errorAttributes("confirm-deadline")}
                  type="date"
                  value={draft.dueDate}
                  onChange={(event) => updateField("dueDate", event.target.value)}
                  data-testid="confirm-deadline"
                />
              </label>
              <FieldStatus status={result.summary.dueDate.status} edited={draft.dueDate !== initialDraft.dueDate} isPasted={isPasted} messages={messages} />
              <EvidenceNote evidence={result.summary.dueDate.evidence} messages={messages} isPasted={isPasted} />
              <FieldError issue={showErrors ? issueByTarget.get("confirm-deadline") : undefined} />
            </div>
            <div className="confirm-field" style={CONFIRM_FIELD_STYLE}>
              <label htmlFor="confirm-word-count">
                <span>{messages.wordCount}</span>
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
              </label>
              <FieldStatus status={result.summary.wordCount.status} edited={draft.wordCount !== initialDraft.wordCount} isPasted={isPasted} messages={messages} />
              <EvidenceNote evidence={result.summary.wordCount.evidence} messages={messages} isPasted={isPasted} />
              <FieldError issue={showErrors ? issueByTarget.get("confirm-word-count") : undefined} />
            </div>
            <div className="confirm-field confirm-field-wide" style={CONFIRM_FIELD_STYLE}>
              <label htmlFor="confirm-citation-style">
                <span>{messages.citationStyle}</span>
                <input
                  {...errorAttributes("confirm-citation-style")}
                  value={draft.citationStyle}
                  onChange={(event) => updateField("citationStyle", event.target.value)}
                  placeholder={messages.citationPlaceholder}
                  maxLength={160}
                  data-testid="confirm-citation-style"
                />
              </label>
              <FieldStatus status={result.summary.citationStyle.status} edited={draft.citationStyle !== initialDraft.citationStyle} isPasted={isPasted} messages={messages} />
              <EvidenceNote evidence={result.summary.citationStyle.evidence} messages={messages} isPasted={isPasted} />
              <FieldError issue={showErrors ? issueByTarget.get("confirm-citation-style") : undefined} />
            </div>
          </div>
        </section>

        <section className="rubric-detection rubric-editor" aria-labelledby="rubric-detection-title">
          <div className="section-heading compact-heading">
            <div>
              <p className="eyebrow">{messages.rubricEyebrow}</p>
              <h2 id="rubric-detection-title" tabIndex={-1}>{messages.rubricReviewTitle}</h2>
              <p>{localizedParserMessage(result.summary.rubric.message, messages)}</p>
            </div>
            {draft.weightingMode === "complete" ? (
              <span className={`text-status ${Math.abs(totalWeight - 100) < 0.01 ? "complete" : "incomplete"}`}>
                {formatIntakeMessage(messages.publishedTotal, { total: totalWeight })}
              </span>
            ) : draft.weightingMode === "not_complete" ? (
              <span className={`text-status ${recordedWeightCount > 0 ? "incomplete" : "complete"}`}>
                {recordedWeightCount > 0
                  ? formatIntakeMessage(messages.incompleteWeights, {
                      recorded: recordedWeightCount,
                      total: draft.criteria.length,
                    })
                  : messages.noPublishedWeights}
              </span>
            ) : (
              <span className="text-status incomplete">{messages.weightingChoiceNeeded}</span>
            )}
          </div>

          <fieldset
            className="weighting-mode-fieldset"
            aria-describedby={`weighting-mode-help${showErrors && issueByTarget.has("rubric-weighting-published") ? " rubric-weighting-published-error" : ""}`}
          >
            <legend>{messages.weightingLegend}</legend>
            <p id="weighting-mode-help">
              {messages.weightingHelp}
            </p>
            <div className="weighting-mode-options">
              <label>
                <input
                  {...errorAttributes("rubric-weighting-published")}
                  type="radio"
                  name="rubric-weighting-mode"
                  value="complete"
                  checked={draft.weightingMode === "complete"}
                  onChange={() => updateField("weightingMode", "complete")}
                  required
                />
                <span>
                  <strong>{messages.weightingYes}</strong>
                  <small>{messages.weightingYesHint}</small>
                </span>
              </label>
              <label>
                <input
                  type="radio"
                  name="rubric-weighting-mode"
                  value="not_complete"
                  checked={draft.weightingMode === "not_complete"}
                  onChange={() => updateField("weightingMode", "not_complete")}
                  aria-describedby="weighting-mode-help"
                  required
                />
                <span>
                  <strong>{messages.weightingNo}</strong>
                  <small>{messages.weightingNoHint}</small>
                </span>
              </label>
            </div>
            <FieldError issue={showErrors ? issueByTarget.get("rubric-weighting-published") : undefined} />
          </fieldset>

          {draft.weightingMode === "not_complete" && sourceContainsPercentageValues ? (
            <div className="inline-alert warning compact-alert" role="status">
              <AlertTriangle aria-hidden="true" />
              <p>{messages.partialPercentages}</p>
            </div>
          ) : null}

          <div className="rubric-editor-list">
            {draft.criteria.map((criterion, index) => (
              <div
                className="rubric-editor-row"
                key={criterionKeys[index]}
              >
                <span className="criterion-index" aria-hidden="true">{index + 1}</span>
                <label>
                  <span>{messages.criterion}</span>
                  <input
                    {...errorAttributes(`criterion-name-${index}`)}
                    value={criterion.name}
                    onChange={(event) => updateCriterion(index, "name", event.target.value)}
                    placeholder={messages.criterionPlaceholder}
                    maxLength={300}
                    data-testid={`criterion-name-${index}`}
                  />
                  <small>{criterion.evidence ? messages.sourceLinkedCriterion : messages.manualCriterion}</small>
                  <FieldError issue={showErrors ? issueByTarget.get(`criterion-name-${index}`) : undefined} />
                </label>
                <label className="weight-field">
                  <span>
                    {draft.weightingMode === "complete"
                      ? messages.publishedWeight
                      : messages.publishedWeightOptional}
                  </span>
                  <span className="input-with-suffix">
                    <input
                      {...errorAttributes(`criterion-weight-${index}`)}
                      type="number"
                      min="0.01"
                      max="100"
                      step="0.01"
                      value={criterion.weight}
                      onChange={(event) => updateCriterion(index, "weight", event.target.value)}
                      aria-label={formatIntakeMessage(messages.weightAria, { number: index + 1 })}
                      data-testid={`criterion-weight-${index}`}
                      required={draft.weightingMode === "complete"}
                    />
                    <b>%</b>
                  </span>
                  <small>
                    {criterionOrigins[index]?.weight &&
                    criterionOrigins[index]?.weight === criterion.weight
                      ? messages.weightFound
                      : criterion.weight
                        ? messages.weightManual
                        : draft.weightingMode === "complete"
                          ? messages.weightRequired
                          : messages.weightBlank}
                  </small>
                  <FieldError issue={showErrors ? issueByTarget.get(`criterion-weight-${index}`) : undefined} />
                </label>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => removeCriterion(index)}
                  aria-label={formatIntakeMessage(messages.removeCriterion, { number: index + 1 })}
                >
                  <Trash2 aria-hidden="true" />
                </button>
                <EvidenceNote evidence={criterion.evidence} messages={messages} isPasted={isPasted} />
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
            <Plus aria-hidden="true" />{messages.addCriterion}
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
              <strong>{messages.finishChecks}</strong>
              <ul>
                {displayedIssues.map((issue, index) => (
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
            <strong>{messages.compactSaveTitle}</strong> {messages.compactSaveBody}
          </p>
        </div>

        <div className="summary-actions">
          <button className="button button-secondary" type="button" onClick={onBack}>
            {isPasted
              ? messages.editPastedText
              : isPartial
                ? messages.reviewFileSelection
                : messages.chooseDifferentFiles}
          </button>
          <button className="button button-primary" type="submit" data-testid="create-project">
            {messages.createProject} <ArrowRight aria-hidden="true" />
          </button>
        </div>
      </form>
    </main>
  );
}
