"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import {
  ArchiveRestore,
  ArrowRight,
  FileText,
  LockKeyhole,
  Route,
  ShieldCheck,
  UploadCloud,
} from "lucide-react";
import { BRAND } from "@/lib/brand";

interface WelcomeScreenProps {
  onTrySample: () => void;
  onFiles: (files: File[]) => void;
  isLoadingSample: boolean;
  uploadStatus: "idle" | "parsing" | "error";
  uploadError: string | null;
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

export function WelcomeScreen({
  onTrySample,
  onFiles,
  isLoadingSample,
  uploadStatus,
  uploadError,
  onImportBackup,
  isImportingBackup,
  backupError,
}: WelcomeScreenProps) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const uploadSubmissionLockRef = useRef(false);
  const isWelcomeBusy =
    uploadStatus === "parsing" || isLoadingSample || isImportingBackup;
  const isUploadDisabled = isWelcomeBusy;

  useEffect(() => {
    if (uploadStatus !== "parsing") uploadSubmissionLockRef.current = false;
  }, [uploadStatus]);

  function submitFiles(fileList: FileList | null) {
    if (isUploadDisabled || uploadSubmissionLockRef.current || !fileList?.length) return;
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
    setIsDragging(false);
    submitFiles(event.dataTransfer.files);
  }

  function openFilePicker() {
    if (isUploadDisabled || uploadSubmissionLockRef.current) return;
    fileInputRef.current?.click();
  }

  function handleBackupInput(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) onImportBackup(file);
  }

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
              <p className="eyebrow">Use your own files</p>
              <h2>Preview, confirm, then plan</h2>
            </div>
            <FileText aria-hidden="true" />
          </div>

          <div
            className={`upload-zone${isDragging ? " is-dragging" : ""}${uploadError ? " has-error" : ""}`}
            role="group"
            aria-labelledby="upload-zone-title"
            aria-busy={uploadStatus === "parsing"}
            aria-disabled={isUploadDisabled}
            onDragEnter={(event) => {
              event.preventDefault();
              if (!isUploadDisabled && !uploadSubmissionLockRef.current) setIsDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            data-testid="upload-zone"
          >
            <UploadCloud aria-hidden="true" />
            <h3 id="upload-zone-title">{isDragging ? "Drop files to preview" : "Drop brief and rubric here"}</h3>
            <p>PDF, DOCX or TXT · up to 10 files · 10 MB each · 25 MB combined</p>
            <button
              id="choose-assignment-files"
              type="button"
              className="button button-secondary"
              onClick={openFilePicker}
              disabled={isUploadDisabled}
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
              disabled={isUploadDisabled}
              onChange={handleInput}
              data-testid="file-input"
            />
          </div>

          {uploadError ? (
            <div className="inline-alert danger" role="alert" data-testid="upload-error">
              <strong>We couldn’t read that file.</strong>
              <span>{uploadError}</span>
            </div>
          ) : null}

          <div className="privacy-row">
            <LockKeyhole aria-hidden="true" />
            <p><strong>Private by default.</strong> Files are parsed in this browser. You confirm every field before a compact local project is saved.</p>
          </div>

          <div className="welcome-backup-restore" aria-busy={isImportingBackup}>
            <ArchiveRestore aria-hidden="true" />
            <div>
              <strong>Already have a RubricTrail project?</strong>
              <p>Restore a versioned JSON backup. Confirm its project name and export date before anything is replaced.</p>
              <button
                className="button button-ghost"
                type="button"
                disabled={isImportingBackup || isUploadDisabled}
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
                disabled={isImportingBackup || isUploadDisabled}
                onChange={handleBackupInput}
                data-testid="backup-file-input"
              />
            </div>
          </div>
          {backupError ? (
            <div className="inline-alert danger" role="alert" data-testid="backup-error">
              <strong>We couldn’t restore that backup.</strong>
              <span>{backupError}</span>
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
