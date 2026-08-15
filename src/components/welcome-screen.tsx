"use client";

import {
  useEffect,
  useRef,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
} from "react";
import {
  AlertTriangle,
  ArchiveRestore,
  ArrowRight,
  ClipboardPaste,
  FileText,
  LockKeyhole,
  Route,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import { CommunityLinks } from "@/components/community-links";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useI18n, useLocalizedMessages } from "@/components/locale-provider";
import { BRAND } from "@/lib/brand";
import type { AssignmentFileErrorCode } from "@/lib/files/parse-assignment-files";
import {
  formatIntakeMessage,
  intakeEn,
  intakeZhCN,
  type IntakeMessages,
} from "@/lib/i18n/messages/intake";
import {
  PASTED_ASSIGNMENT_TEXT_MAX_CHARACTERS,
  validatePastedAssignmentText,
} from "@/lib/pasted-text-intake";
import type {
  AssignmentFileIntakeError,
  AssignmentIntakeMode,
  PastedTextIntakeError,
  UploadFlowResult,
} from "@/lib/ui-types";

interface WelcomeScreenProps {
  onTrySample: () => void;
  onFiles: (files: File[]) => void;
  onPastedText: (brief: string, rubric: string) => void;
  intakeMode: AssignmentIntakeMode;
  onIntakeModeChange: (mode: AssignmentIntakeMode) => void;
  pastedBrief: string;
  onPastedBriefChange: (value: string) => void;
  pastedRubric: string;
  onPastedRubricChange: (value: string) => void;
  pastedTextError: PastedTextIntakeError | null;
  isLoadingSample: boolean;
  uploadStatus: "idle" | "parsing" | "error";
  uploadError: AssignmentFileIntakeError | null;
  partialUploadResult: UploadFlowResult | null;
  onReviewPartialUpload: () => void;
  onImportBackup: (file: File) => void;
  isImportingBackup: boolean;
  backupError: string | null;
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

function chooseFilesLabel(
  error: AssignmentFileIntakeError,
  messages: IntakeMessages,
): string {
  if (error.code === "NO_READABLE_FILES") return messages.chooseAllFilesAgain;
  if (error.code === "FILE_TOO_LARGE") return messages.chooseSmallerFile;
  if (error.code === "PDF_TOO_MANY_PAGES") return messages.chooseShorterPdf;
  return [
    "TOO_MANY_FILES",
    "TOTAL_FILE_SIZE_TOO_LARGE",
    "EXTRACTED_TEXT_TOO_LARGE",
    "EXTRACTED_TEXT_TOO_MANY_LINES",
    "EXTRACTED_TEXT_TOO_MANY_WORDS",
    "TOTAL_PDF_PAGES_TOO_LARGE",
  ].includes(error.code)
    ? messages.chooseFewerFiles
    : messages.chooseAnotherFile;
}

function localizedPastedError(
  error: PastedTextIntakeError,
  messages: IntakeMessages,
): string {
  if (error.code === "brief-required") return messages.pasteErrorBrief;
  if (error.code === "unreadable") return messages.pasteErrorUnreadable;
  if (error.code === "too-many-characters") return messages.pasteErrorCharacters;
  if (error.code === "too-many-lines") return messages.pasteErrorLines;
  if (error.code === "too-large") return messages.pasteErrorTooLarge;
  if (error.code === "unknown") return messages.pasteErrorUnknown;
  if (error.target === "brief") {
    if (/does not contain readable text/i.test(error.message)) {
      return messages.pasteErrorUnreadable;
    }
    return messages.pasteErrorBrief;
  }
  if (/lines combined/i.test(error.message)) return messages.pasteErrorLines;
  if (/too large to prepare safely/i.test(error.message)) return messages.pasteErrorTooLarge;
  if (/characters combined/i.test(error.message)) return messages.pasteErrorCharacters;
  return messages.pasteErrorUnknown;
}

export function WelcomeScreen({
  onTrySample,
  onFiles,
  onPastedText,
  intakeMode,
  onIntakeModeChange,
  pastedBrief,
  onPastedBriefChange,
  pastedRubric,
  onPastedRubricChange,
  pastedTextError,
  isLoadingSample,
  uploadStatus,
  uploadError,
  partialUploadResult,
  onReviewPartialUpload,
  onImportBackup,
  isImportingBackup,
  backupError,
}: WelcomeScreenProps) {
  const { locale, formatNumber } = useI18n();
  const messages = useLocalizedMessages<IntakeMessages>(intakeEn, intakeZhCN);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const pasteHeadingRef = useRef<HTMLHeadingElement>(null);
  const uploadErrorRef = useRef<HTMLElement>(null);
  const partialUploadRef = useRef<HTMLElement>(null);
  const pasteErrorRef = useRef<HTMLElement>(null);
  const uploadSubmissionLockRef = useRef(false);
  const isWelcomeBusy =
    uploadStatus === "parsing" || isLoadingSample || isImportingBackup;
  const combinedPastedCharacters = pastedBrief.length + pastedRubric.length;
  const briefErrorId =
    pastedTextError?.target === "brief" || pastedTextError?.target === "combined"
      ? "pasted-text-error"
      : undefined;
  const rubricErrorId =
    pastedTextError?.target === "combined" ? "pasted-text-error" : undefined;
  const readyFileCount = partialUploadResult?.fileNames.length ?? 0;
  const selectedFileCount = partialUploadResult
    ? partialUploadResult.fileNames.length + partialUploadResult.skippedFiles.length
    : 0;
  const flow = [
    [messages.flowBriefTitle, messages.flowBriefDetail],
    [messages.flowRubricTitle, messages.flowRubricDetail],
    [messages.flowPlanTitle, messages.flowPlanDetail],
    [messages.flowDraftTitle, messages.flowDraftDetail],
    [messages.flowProgressTitle, messages.flowProgressDetail],
  ] as const;
  const displayedUploadError = uploadError
    ? locale === "en"
      ? { title: uploadError.title, message: uploadError.message }
      : uploadError.code === "NO_READABLE_FILES"
        ? { title: messages.errorNoReadableTitle, message: messages.errorNoReadableBody }
        : uploadError.code === "UNKNOWN"
          ? { title: messages.errorUnknownTitle, message: messages.errorUnknownBody }
          : {
              title: messages.errorKnownTitle,
              message: fileIssueReason(uploadError.code, messages),
            }
    : null;
  const displayedBackupError = backupError;

  useEffect(() => {
    if (uploadStatus !== "parsing") uploadSubmissionLockRef.current = false;
  }, [uploadStatus]);

  useEffect(() => {
    if (!uploadError || intakeMode !== "files") return;
    const frame = window.requestAnimationFrame(() => {
      uploadErrorRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [intakeMode, uploadError]);

  useEffect(() => {
    if (!partialUploadResult || intakeMode !== "files") return;
    const frame = window.requestAnimationFrame(() => {
      partialUploadRef.current?.focus();
      partialUploadRef.current?.scrollIntoView?.({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [intakeMode, partialUploadResult]);

  useEffect(() => {
    if (!pastedTextError || intakeMode !== "paste") return;
    const frame = window.requestAnimationFrame(() => {
      if (pastedTextError.target === "brief") {
        document
          .getElementById("pasted-assignment-brief")
          ?.focus({ preventScroll: true });
      } else {
        pasteErrorRef.current?.focus({ preventScroll: true });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [intakeMode, pastedTextError]);

  function submitFiles(fileList: FileList | readonly File[] | null) {
    if (isWelcomeBusy || uploadSubmissionLockRef.current || !fileList?.length) return;
    uploadSubmissionLockRef.current = true;

    try {
      onFiles(Array.from(fileList));
    } catch (error) {
      uploadSubmissionLockRef.current = false;
      throw error;
    }
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    submitFiles(event.target.files);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    submitFiles(event.dataTransfer.files);
  }

  function openFilePicker() {
    if (isWelcomeBusy || uploadSubmissionLockRef.current) return;
    fileInputRef.current?.click();
  }

  function handleBackupInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onImportBackup(file);
  }

  function changeIntakeMode(mode: AssignmentIntakeMode, focusPanel = false) {
    if (isWelcomeBusy) return;
    onIntakeModeChange(mode);
    if (!focusPanel) return;
    window.requestAnimationFrame(() => {
      document
        .getElementById(mode === "paste" ? "paste-intake-title" : "upload-zone-title")
        ?.focus({ preventScroll: true });
    });
  }

  function submitPastedText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isWelcomeBusy || uploadSubmissionLockRef.current) return;
    const isLocallyValid = !validatePastedAssignmentText({
      brief: pastedBrief,
      rubric: pastedRubric,
    });
    if (isLocallyValid) uploadSubmissionLockRef.current = true;
    onPastedText(pastedBrief, pastedRubric);
  }

  const chooseFilesRecovery = uploadError ? (
    <button
      className={`button ${uploadError.preferredRecovery === "files" ? "button-primary" : "button-secondary"}`}
      type="button"
      onClick={openFilePicker}
      disabled={isWelcomeBusy}
    >
      {chooseFilesLabel(uploadError, messages)}
    </button>
  ) : null;
  const pasteRecovery = uploadError ? (
    <button
      className={`button ${uploadError.preferredRecovery === "paste" ? "button-primary" : "button-secondary"}`}
      type="button"
      onClick={() => changeIntakeMode("paste", true)}
      disabled={isWelcomeBusy}
    >
      {messages.pasteInstead}
    </button>
  ) : null;
  const fileRecoveryButtons = uploadError ? (
    <div className="intake-error-actions">
      {uploadError.preferredRecovery === "paste" ? (
        <>{pasteRecovery}{chooseFilesRecovery}</>
      ) : (
        <>{chooseFilesRecovery}{pasteRecovery}</>
      )}
    </div>
  ) : null;

  return (
    <main className="welcome-shell" id="main-content">
      <header className="welcome-header">
        <a className="brand-lockup" href="#main-content" aria-label={messages.homeAria}>
          <span className="brand-mark" aria-hidden="true"><Route /></span>
          <span>{BRAND.name}</span>
        </a>
        <div className="header-actions">
          <LanguageSwitcher compact />
          <div className="mode-indicator" title={messages.demoDescription}>
            <span aria-hidden="true" />
            {messages.demoLabel}
          </div>
        </div>
      </header>

      <section className="welcome-grid" aria-labelledby="welcome-title">
        <div className="welcome-copy">
          <h1 id="welcome-title">{messages.welcomeTitle}</h1>
          <p className="welcome-lede">{messages.welcomeLede}</p>

          <button
            className="button button-primary button-large"
            type="button"
            onClick={onTrySample}
            disabled={isWelcomeBusy}
            data-testid="try-sample"
          >
            {isLoadingSample ? messages.sampleLoading : messages.sampleCta}
            {isLoadingSample ? <span className="button-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
          </button>

          <ol className="welcome-flow" aria-label={messages.workflowAria}>
            {flow.map(([title, detail], index) => (
              <li key={title}>
                <span className="flow-number">{String(index + 1).padStart(2, "0")}</span>
                <span><strong>{title}</strong><small>{detail}</small></span>
              </li>
            ))}
          </ol>

          <div className="integrity-note compact">
            <ShieldCheck aria-hidden="true" />
            <p><strong>{messages.integrityTitle}</strong> {messages.integrityBody}</p>
          </div>
        </div>

        <div className="welcome-workbench">
          <div className="workbench-heading">
            <div>
              <p className="eyebrow">{messages.startEyebrow}</p>
              <h2>{messages.startTitle}</h2>
              <p>{messages.startBody}</p>
            </div>
            <FileText aria-hidden="true" />
          </div>

          <div className="inline-alert warning compact-alert" role="note">
            <AlertTriangle aria-hidden="true" />
            <p>{messages.extractionLimit}</p>
          </div>

          <div className="intake-mode-picker" role="group" aria-label={messages.intakeModeAria}>
            <button
              type="button"
              className={intakeMode === "files" ? "is-active" : ""}
              aria-labelledby="intake-files-title"
              aria-describedby="intake-files-description"
              aria-pressed={intakeMode === "files"}
              onClick={() => changeIntakeMode("files")}
              disabled={isWelcomeBusy}
            >
              <UploadCloud aria-hidden="true" />
              <span><strong id="intake-files-title">{messages.uploadFiles}</strong><small id="intake-files-description">{messages.uploadFormats}</small></span>
            </button>
            <button
              type="button"
              className={intakeMode === "paste" ? "is-active" : ""}
              aria-labelledby="intake-paste-title"
              aria-describedby="intake-paste-description"
              aria-pressed={intakeMode === "paste"}
              onClick={() => changeIntakeMode("paste")}
              disabled={isWelcomeBusy}
            >
              <ClipboardPaste aria-hidden="true" />
              <span><strong id="intake-paste-title">{messages.pasteText}</strong><small id="intake-paste-description">{messages.pasteSources}</small></span>
            </button>
          </div>

          {intakeMode === "files" ? (
            <section className="intake-panel" aria-label={messages.uploadPanelAria}>
              <div
                className={`upload-zone${uploadError ? " has-error" : ""}`}
                role="group"
                aria-labelledby="upload-zone-title"
                aria-busy={uploadStatus === "parsing"}
                aria-disabled={isWelcomeBusy}
                onDragEnter={(event) => event.preventDefault()}
                onDragOver={(event) => event.preventDefault()}
                onDrop={handleDrop}
                data-testid="upload-zone"
              >
                <UploadCloud aria-hidden="true" />
                <h3 id="upload-zone-title" tabIndex={-1}>{messages.uploadTitle}</h3>
                <p>{messages.uploadLimits}</p>
                <button
                  id="choose-assignment-files"
                  type="button"
                  className="button button-secondary"
                  onClick={openFilePicker}
                  disabled={isWelcomeBusy}
                >
                  {uploadStatus === "parsing" ? messages.parsingLocally : messages.chooseFiles}
                </button>
                <input
                  ref={fileInputRef}
                  className="visually-hidden"
                  type="file"
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  multiple
                  aria-label={messages.fileInputAria}
                  disabled={isWelcomeBusy}
                  onChange={handleInput}
                  data-testid="file-input"
                />
              </div>

              {uploadError ? (
                <section
                  className="inline-alert warning intake-error"
                  role="alert"
                  tabIndex={-1}
                  ref={uploadErrorRef}
                  data-testid="upload-error"
                >
                  <AlertTriangle aria-hidden="true" />
                  <div>
                    <strong>{displayedUploadError?.title}</strong>
                    {uploadError.fileName ? <span className="intake-error-file">{uploadError.fileName}</span> : null}
                    <p>{displayedUploadError?.message}</p>
                    {uploadError.fileIssues.length > 0 ? (
                      <ul className="intake-file-list issue-list">
                        {uploadError.fileIssues.map((issue) => (
                          <li key={`${issue.inputIndex}-${issue.code}`}>
                            <strong>
                              {formatIntakeMessage(messages.fileNumber, {
                                number: issue.inputIndex + 1,
                                fileName: issue.fileName,
                              })}
                            </strong>
                            <span>{fileIssueReason(issue.code, messages)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    <small>{messages.nothingChanged}</small>
                    {fileRecoveryButtons}
                  </div>
                </section>
              ) : null}

              {partialUploadResult ? (
                <section
                  className="inline-alert warning partial-upload-card"
                  role="region"
                  aria-labelledby="partial-upload-title"
                  tabIndex={-1}
                  ref={partialUploadRef}
                  data-testid="partial-upload"
                >
                  <AlertTriangle aria-hidden="true" />
                  <div>
                    <h3 id="partial-upload-title">
                      {formatIntakeMessage(messages.partialTitle, {
                        ready: readyFileCount,
                        selected: selectedFileCount,
                      })}
                    </h3>
                    <p>
                      {formatIntakeMessage(
                        readyFileCount === 1
                          ? partialUploadResult.skippedFiles.length === 1
                            ? messages.partialBodyOneOne
                            : messages.partialBodyOneMany
                          : partialUploadResult.skippedFiles.length === 1
                            ? messages.partialBodyManyOne
                            : messages.partialBodyManyMany,
                        {
                          ready: readyFileCount,
                          skipped: partialUploadResult.skippedFiles.length,
                        },
                      )}
                    </p>
                    <div className="partial-file-groups">
                      <section aria-labelledby="ready-files-title">
                        <h4 id="ready-files-title">
                          {formatIntakeMessage(messages.readyToReview, { count: readyFileCount })}
                        </h4>
                        <ul className="intake-file-list ready-list">
                          {partialUploadResult.fileNames.map((fileName, index) => (
                            <li key={`${index}-${fileName}`}>{fileName}</li>
                          ))}
                        </ul>
                      </section>
                      <section aria-labelledby="attention-files-title">
                        <h4 id="attention-files-title">
                          {formatIntakeMessage(messages.needsAttention, {
                            count: partialUploadResult.skippedFiles.length,
                          })}
                        </h4>
                        <ul className="intake-file-list issue-list">
                          {partialUploadResult.skippedFiles.map((issue) => (
                            <li key={`${issue.inputIndex}-${issue.code}`}>
                              <strong>
                                {formatIntakeMessage(messages.notIncluded, {
                                  fileName: issue.fileName,
                                })}
                              </strong>
                              <span>{fileIssueReason(issue.code, messages)}</span>
                            </li>
                          ))}
                        </ul>
                      </section>
                    </div>
                    <p className="partial-reselect-note">
                      {messages.reselectWarning}
                    </p>
                    <div className="intake-error-actions partial-upload-actions">
                      <button
                        className="button button-primary"
                        type="button"
                        onClick={onReviewPartialUpload}
                        disabled={isWelcomeBusy}
                      >
                        {formatIntakeMessage(
                          readyFileCount === 1
                            ? messages.reviewReadyFile
                            : messages.reviewReadyFiles,
                          { count: readyFileCount },
                        )}
                      </button>
                      <button
                        className="button button-secondary"
                        type="button"
                        onClick={openFilePicker}
                        disabled={isWelcomeBusy}
                      >
                        {messages.chooseAllFilesAgain}
                      </button>
                      <button
                        className="button button-ghost"
                        type="button"
                        onClick={() => changeIntakeMode("paste", true)}
                        disabled={isWelcomeBusy}
                      >
                        {messages.pasteAllInstead}
                      </button>
                    </div>
                  </div>
                </section>
              ) : null}
            </section>
          ) : (
            <form
              className="paste-intake intake-panel"
              onSubmit={submitPastedText}
              aria-labelledby="paste-intake-title"
              aria-busy={uploadStatus === "parsing"}
              noValidate
            >
              <div className="paste-intake-heading">
                <ClipboardPaste aria-hidden="true" />
                <div>
                  <h3 id="paste-intake-title" ref={pasteHeadingRef} tabIndex={-1}>{messages.pasteTitle}</h3>
                  <p>{messages.pasteIntro}</p>
                </div>
              </div>

              <label htmlFor="pasted-assignment-brief">
                <span>{messages.briefLabel} <b>{messages.required}</b></span>
              </label>
              <textarea
                id="pasted-assignment-brief"
                value={pastedBrief}
                onChange={(event) => onPastedBriefChange(event.target.value)}
                placeholder={messages.briefPlaceholder}
                maxLength={PASTED_ASSIGNMENT_TEXT_MAX_CHARACTERS}
                required
                aria-invalid={pastedTextError?.target === "brief" || pastedTextError?.target === "combined" || undefined}
                aria-describedby={`pasted-brief-hint${briefErrorId ? ` ${briefErrorId}` : ""}`}
                disabled={isWelcomeBusy}
                data-testid="pasted-assignment-brief"
              />
              <small id="pasted-brief-hint">{messages.briefHint}</small>

              <label htmlFor="pasted-assignment-rubric">
                <span>{messages.rubricLabel} <b>{messages.optional}</b></span>
              </label>
              <textarea
                id="pasted-assignment-rubric"
                value={pastedRubric}
                onChange={(event) => onPastedRubricChange(event.target.value)}
                placeholder={messages.rubricPlaceholder}
                maxLength={PASTED_ASSIGNMENT_TEXT_MAX_CHARACTERS}
                aria-invalid={pastedTextError?.target === "combined" || undefined}
                aria-describedby={`pasted-rubric-hint${rubricErrorId ? ` ${rubricErrorId}` : ""}`}
                disabled={isWelcomeBusy}
                data-testid="pasted-assignment-rubric"
              />
              <small id="pasted-rubric-hint">{messages.rubricHint}</small>

              <div className="paste-intake-meta">
                <span className={combinedPastedCharacters > PASTED_ASSIGNMENT_TEXT_MAX_CHARACTERS ? "is-over-limit" : ""}>
                  {formatIntakeMessage(messages.charactersCombined, {
                    current: formatNumber(combinedPastedCharacters),
                    maximum: formatNumber(PASTED_ASSIGNMENT_TEXT_MAX_CHARACTERS),
                  })}
                </span>
              </div>

              {pastedTextError ? (
                <section
                  className="inline-alert warning intake-error"
                  role="alert"
                  tabIndex={-1}
                  ref={pasteErrorRef}
                  id="pasted-text-error"
                  data-testid="pasted-text-error"
                >
                  <AlertTriangle aria-hidden="true" />
                  <div>
                    <strong>{messages.pasteErrorTitle}</strong>
                    <p>
                      {localizedPastedError(pastedTextError, messages)}
                    </p>
                    <small>{messages.nothingChanged}</small>
                    {pastedTextError.target !== "brief" ? (
                      <button
                        className="button button-ghost paste-error-jump"
                        type="button"
                        onClick={() => document.getElementById("pasted-assignment-brief")?.focus({ preventScroll: true })}
                      >
                        {messages.goToBrief}
                      </button>
                    ) : null}
                  </div>
                </section>
              ) : null}

              <div className="paste-intake-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => changeIntakeMode("files", true)}
                  disabled={isWelcomeBusy}
                >
                  {messages.uploadInstead}
                </button>
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={isWelcomeBusy}
                >
                  {uploadStatus === "parsing" ? messages.preparingPreview : messages.reviewDetails}
                  {uploadStatus === "parsing" ? <span className="button-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
                </button>
              </div>
            </form>
          )}

          <div className="privacy-row">
            <LockKeyhole aria-hidden="true" />
            <p><strong>{messages.localProcessingTitle}</strong> {messages.localProcessingBody}</p>
          </div>

          <div className="welcome-backup-restore" aria-busy={isImportingBackup}>
            <ArchiveRestore aria-hidden="true" />
            <div>
              <span className="backup-eyebrow">{messages.backupEyebrow}</span>
              <strong>{messages.backupTitle}</strong>
              <p>{messages.backupBody}</p>
              <button
                className="button button-ghost"
                type="button"
                disabled={isWelcomeBusy}
                onClick={() => backupInputRef.current?.click()}
              >
                {isImportingBackup ? messages.backupReading : messages.backupOpen}
              </button>
              <input
                ref={backupInputRef}
                className="visually-hidden"
                type="file"
                accept=".rubrictrail.json,.json,application/json"
                aria-label={messages.backupInputAria}
                disabled={isWelcomeBusy}
                onChange={handleBackupInput}
                data-testid="backup-file-input"
              />
            </div>
          </div>
          {backupError ? (
            <div className="inline-alert danger" role="alert" data-testid="backup-error">
              <ArchiveRestore aria-hidden="true" />
              <div>
                <strong>{messages.backupErrorTitle}</strong>
                <span>{displayedBackupError}</span>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <footer className="welcome-footer">
        <span>{messages.footer}</span>
        <CommunityLinks />
      </footer>
    </main>
  );
}
