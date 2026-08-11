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
import { BRAND } from "@/lib/brand";
import {
  PASTED_ASSIGNMENT_TEXT_MAX_CHARACTERS,
  validatePastedAssignmentText,
} from "@/lib/pasted-text-intake";
import type {
  AssignmentFileIntakeError,
  AssignmentIntakeMode,
  PastedTextIntakeError,
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
  onImportBackup: (file: File) => void;
  isImportingBackup: boolean;
  backupError: string | null;
}

const FLOW = [
  ["Brief", "Decode the real ask"],
  ["Rubric", "See what earns marks"],
  ["Plan", "Build evidence on time"],
  ["Draft", "Check, don’t outsource"],
  ["Progress", "Know what is still missing"],
] as const;

function chooseFilesLabel(error: AssignmentFileIntakeError): string {
  if (error.code === "FILE_TOO_LARGE") return "Choose a smaller file";
  return [
    "TOO_MANY_FILES",
    "TOTAL_FILE_SIZE_TOO_LARGE",
    "EXTRACTED_TEXT_TOO_LARGE",
  ].includes(error.code)
    ? "Choose fewer files"
    : "Choose another file";
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
  onImportBackup,
  isImportingBackup,
  backupError,
}: WelcomeScreenProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const pasteHeadingRef = useRef<HTMLHeadingElement>(null);
  const uploadErrorRef = useRef<HTMLElement>(null);
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
      {chooseFilesLabel(uploadError)}
    </button>
  ) : null;
  const pasteRecovery = uploadError ? (
    <button
      className={`button ${uploadError.preferredRecovery === "paste" ? "button-primary" : "button-secondary"}`}
      type="button"
      onClick={() => changeIntakeMode("paste", true)}
      disabled={isWelcomeBusy}
    >
      Paste text instead
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
        <a className="brand-lockup" href="#main-content" aria-label="RubricTrail home">
          <span className="brand-mark" aria-hidden="true"><Route /></span>
          <span>{BRAND.name}</span>
        </a>
        <div className="mode-indicator" title={BRAND.demoDescription}>
          <span aria-hidden="true" />
          Local demo · no credits
        </div>
      </header>

      <section className="welcome-grid" aria-labelledby="welcome-title">
        <div className="welcome-copy">
          <h1 id="welcome-title">Turn the brief into a plan you can prove.</h1>
          <p className="welcome-lede">
            RubricTrail connects every requirement to the rubric, the work you need to do,
            and the evidence you still need to build.
          </p>

          <button
            className="button button-primary button-large"
            type="button"
            onClick={onTrySample}
            disabled={isWelcomeBusy}
            data-testid="try-sample"
          >
            {isLoadingSample ? "Reading sample brief…" : "Explore the 2-minute demo"}
            {isLoadingSample ? <span className="button-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
          </button>

          <ol className="welcome-flow" aria-label="RubricTrail workflow">
            {FLOW.map(([title, detail], index) => (
              <li key={title}>
                <span className="flow-number">{String(index + 1).padStart(2, "0")}</span>
                <span><strong>{title}</strong><small>{detail}</small></span>
              </li>
            ))}
          </ol>

          <div className="integrity-note compact">
            <ShieldCheck aria-hidden="true" />
            <p><strong>Support, not substitution.</strong> RubricTrail coaches the process. It never invents sources, data, or a submission.</p>
          </div>
        </div>

        <div className="welcome-workbench">
          <div className="workbench-heading">
            <div>
              <p className="eyebrow">Start a new project</p>
              <h2>Add your assignment</h2>
              <p>Upload a file or paste instructions from your course page. Everything is processed only in this browser.</p>
            </div>
            <FileText aria-hidden="true" />
          </div>

          <div className="intake-mode-picker" role="group" aria-label="Choose how to add your assignment">
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
              <span><strong id="intake-files-title">Upload files</strong><small id="intake-files-description">PDF, DOCX or TXT</small></span>
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
              <span><strong id="intake-paste-title">Paste text</strong><small id="intake-paste-description">Course page, email or scan</small></span>
            </button>
          </div>

          {intakeMode === "files" ? (
            <section className="intake-panel" aria-label="Upload assignment files">
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
                <h3 id="upload-zone-title" tabIndex={-1}>Drop brief and rubric here</h3>
                <p>PDF, DOCX or TXT · up to 10 files · 10 MB each · 25 MB combined</p>
                <button
                  id="choose-assignment-files"
                  type="button"
                  className="button button-secondary"
                  onClick={openFilePicker}
                  disabled={isWelcomeBusy}
                >
                  {uploadStatus === "parsing" ? "Parsing locally…" : "Choose files"}
                </button>
                <input
                  ref={fileInputRef}
                  className="visually-hidden"
                  type="file"
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  multiple
                  aria-label="Upload assignment brief and rubric files"
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
                    <strong>{uploadError.title}</strong>
                    {uploadError.fileName ? <span className="intake-error-file">{uploadError.fileName}</span> : null}
                    <p>{uploadError.message}</p>
                    <small>Nothing was saved or changed.</small>
                    {fileRecoveryButtons}
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
                  <h3 id="paste-intake-title" ref={pasteHeadingRef} tabIndex={-1}>Paste your assignment text</h3>
                  <p>Copy the instructions from your course page or document. Formatting does not matter.</p>
                </div>
              </div>

              <label htmlFor="pasted-assignment-brief">
                <span>Assignment brief or instructions <b>Required</b></span>
              </label>
              <textarea
                id="pasted-assignment-brief"
                value={pastedBrief}
                onChange={(event) => onPastedBriefChange(event.target.value)}
                placeholder="Include the task, deadline, word count and submission rules if available."
                maxLength={PASTED_ASSIGNMENT_TEXT_MAX_CHARACTERS}
                required
                aria-invalid={pastedTextError?.target === "brief" || pastedTextError?.target === "combined" || undefined}
                aria-describedby={`pasted-brief-hint${briefErrorId ? ` ${briefErrorId}` : ""}`}
                disabled={isWelcomeBusy}
                data-testid="pasted-assignment-brief"
              />
              <small id="pasted-brief-hint">Include the task, deadline, word count and submission rules if available.</small>

              <label htmlFor="pasted-assignment-rubric">
                <span>Rubric or marking criteria <b>Optional</b></span>
              </label>
              <textarea
                id="pasted-assignment-rubric"
                value={pastedRubric}
                onChange={(event) => onPastedRubricChange(event.target.value)}
                placeholder="Paste criterion names and percentages if you have them. You can add them later."
                maxLength={PASTED_ASSIGNMENT_TEXT_MAX_CHARACTERS}
                aria-invalid={pastedTextError?.target === "combined" || undefined}
                aria-describedby={`pasted-rubric-hint${rubricErrorId ? ` ${rubricErrorId}` : ""}`}
                disabled={isWelcomeBusy}
                data-testid="pasted-assignment-rubric"
              />
              <small id="pasted-rubric-hint">Paste the criteria and percentages if available. You can add them later.</small>

              <div className="paste-intake-meta">
                <span className={combinedPastedCharacters > PASTED_ASSIGNMENT_TEXT_MAX_CHARACTERS ? "is-over-limit" : ""}>
                  {combinedPastedCharacters.toLocaleString()} / {PASTED_ASSIGNMENT_TEXT_MAX_CHARACTERS.toLocaleString()} characters combined
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
                    <strong>Check the pasted text.</strong>
                    <p>{pastedTextError.message}</p>
                    <small>Nothing was saved or changed.</small>
                    {pastedTextError.target !== "brief" ? (
                      <button
                        className="button button-ghost paste-error-jump"
                        type="button"
                        onClick={() => document.getElementById("pasted-assignment-brief")?.focus({ preventScroll: true })}
                      >
                        Go to assignment brief
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
                  Upload files instead
                </button>
                <button
                  className="button button-primary"
                  type="submit"
                  disabled={isWelcomeBusy}
                >
                  {uploadStatus === "parsing" ? "Preparing preview…" : "Review assignment details"}
                  {uploadStatus === "parsing" ? <span className="button-spinner" aria-hidden="true" /> : <ArrowRight aria-hidden="true" />}
                </button>
              </div>
            </form>
          )}

          <div className="privacy-row">
            <LockKeyhole aria-hidden="true" />
            <p><strong>Private by default.</strong> Files and pasted text are processed in this browser. Only confirmed fields and short excerpts are saved; full source text is not.</p>
          </div>

          <div className="welcome-backup-restore" aria-busy={isImportingBackup}>
            <ArchiveRestore aria-hidden="true" />
            <div>
              <span className="backup-eyebrow">Continue an existing project</span>
              <strong>Already have a RubricTrail backup?</strong>
              <p>Restore a versioned JSON backup. Confirm its project name and export date before anything is replaced.</p>
              <button
                className="button button-ghost"
                type="button"
                disabled={isWelcomeBusy}
                onClick={() => backupInputRef.current?.click()}
              >
                {isImportingBackup ? "Reading backup…" : "Open a project backup"}
              </button>
              <input
                ref={backupInputRef}
                className="visually-hidden"
                type="file"
                accept=".rubrictrail.json,.json,application/json"
                aria-label="Choose a RubricTrail project backup"
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
                <strong>We couldn’t restore that backup.</strong>
                <span>{backupError}</span>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <footer className="welcome-footer">
        <span>Built for evidence-led coursework</span>
        <span>Local-first · Traceable · Integrity-aware</span>
      </footer>
    </main>
  );
}
