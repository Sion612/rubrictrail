"use client";

import { useCallback, useEffect, useState } from "react";

import { useLocalizedMessages } from "@/components/locale-provider";
import type { WorkspaceReadOnlyProjectBackupCandidate } from "@/lib/workspace-storage/read-only-project-backup";
import type { WorkspaceStorageAdapter } from "@/lib/workspace-storage/storage-adapter";

import styles from "./workspace-recovery-project-exports.module.css";

const recoveryExportEn = {
  heading: "Download readable project backups",
  description:
    "These strictly validated local records are available for read-only backup before recovery. Downloading one does not select a workspace, grant authority, or change local data.",
  loading: "Checking readable local project records…",
  unavailable: "Local project records could not be read safely. No backup candidate was inferred.",
  none: "No individually valid v0.8 project record is available to export.",
  excludedOne: "1 invalid or mismatched local project record was excluded.",
  excludedMany: "{count} invalid or mismatched local project records were excluded.",
  recordLabel: "Readable record {number}",
  sampleTitle: "RubricTrail sample project",
  download: "Download backup",
  downloadLabel: "Download backup for {title}, readable record {number}",
  changed:
    "That local project record changed before export, so RubricTrail did not create a stale backup. Check the workspace again.",
  failed: "The validated project backup could not be created.",
} as const;

const recoveryExportZhCN = {
  heading: "下载可读取的项目备份",
  description:
    "恢复之前，可将这些经严格验证的本地记录作为只读备份下载。下载不会选择工作区、授予权威性或修改本地数据。",
  loading: "正在检查可读取的本地项目记录…",
  unavailable: "无法安全读取本地项目记录，因此没有推断任何备份候选项。",
  none: "没有可供导出的、单独验证有效的 v0.8 项目记录。",
  excludedOne: "已排除 1 条无效或身份不匹配的本地项目记录。",
  excludedMany: "已排除 {count} 条无效或身份不匹配的本地项目记录。",
  recordLabel: "可读取记录 {number}",
  sampleTitle: "RubricTrail 示例项目",
  download: "下载备份",
  downloadLabel: "下载“{title}”的备份，可读取记录 {number}",
  changed: "该本地项目记录在导出前发生变化，因此 RubricTrail 没有创建过期备份。请重新检查工作区。",
  failed: "无法创建经验证的项目备份。",
} satisfies { [Key in keyof typeof recoveryExportEn]: string };

type Inspection =
  | { status: "loading" }
  | { status: "failed" }
  | {
      status: "ready";
      candidates: readonly WorkspaceReadOnlyProjectBackupCandidate[];
      excludedInvalidRecordCount: number;
    };

export interface WorkspaceRecoveryProjectExportsProps {
  storage: WorkspaceStorageAdapter;
  onNotice(notice: string | null): void;
}

function formatMessage(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function candidateTitle(
  candidate: WorkspaceReadOnlyProjectBackupCandidate,
  sampleTitle: string,
): string {
  const state = candidate.state;
  return state.projectKind === "uploaded" && state.uploadedProject
    ? state.uploadedProject.title
    : sampleTitle;
}

function downloadText(fileName: string, contents: string): void {
  const url = URL.createObjectURL(
    new Blob([contents], { type: "application/json;charset=utf-8" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.hidden = true;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function WorkspaceRecoveryProjectExports({
  storage,
  onNotice,
}: WorkspaceRecoveryProjectExportsProps) {
  const messages = useLocalizedMessages(recoveryExportEn, recoveryExportZhCN);
  const [inspection, setInspection] = useState<Inspection>({ status: "loading" });

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void import("@/lib/workspace-storage/read-only-project-backup")
        .then((module) => {
          const result = module.inspectWorkspaceReadOnlyProjectBackups(storage);
          if (!active) return;
          setInspection(result.ok
            ? {
                status: "ready",
                candidates: result.candidates,
                excludedInvalidRecordCount: result.excludedInvalidRecordCount,
              }
            : { status: "failed" });
        })
        .catch(() => {
          if (active) setInspection({ status: "failed" });
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [storage]);

  const exportCandidate = useCallback(async (
    candidate: WorkspaceReadOnlyProjectBackupCandidate,
  ) => {
    try {
      const [reader, backup] = await Promise.all([
        import("@/lib/workspace-storage/read-only-project-backup"),
        import("@/lib/project-backup"),
      ]);
      const validated = reader.revalidateWorkspaceReadOnlyProjectBackup(
        storage,
        candidate,
      );
      if (!validated.ok) {
        onNotice(validated.reason === "record-changed" ? messages.changed : messages.failed);
        return;
      }
      const exportedAt = new Date().toISOString();
      downloadText(
        backup.projectBackupFileName(validated.state, exportedAt),
        backup.serializeProjectBackup(validated.state, exportedAt),
      );
    } catch {
      onNotice(messages.failed);
    }
  }, [messages.changed, messages.failed, onNotice, storage]);

  return (
    <section className={styles.panel} aria-labelledby="workspace-recovery-project-exports-title">
      <h2 id="workspace-recovery-project-exports-title">{messages.heading}</h2>
      <p>{messages.description}</p>
      {inspection.status === "loading" ? <p role="status">{messages.loading}</p> : null}
      {inspection.status === "failed" ? <p role="alert">{messages.unavailable}</p> : null}
      {inspection.status === "ready" && inspection.excludedInvalidRecordCount > 0 ? (
        <p role="status">
          {inspection.excludedInvalidRecordCount === 1
            ? messages.excludedOne
            : formatMessage(messages.excludedMany, {
                count: inspection.excludedInvalidRecordCount,
              })}
        </p>
      ) : null}
      {inspection.status === "ready" && inspection.candidates.length === 0 ? (
        <p>{messages.none}</p>
      ) : null}
      {inspection.status === "ready" && inspection.candidates.length > 0 ? (
        <ul className={styles.list}>
          {inspection.candidates.map((candidate, index) => {
            const number = index + 1;
            const title = candidateTitle(candidate, messages.sampleTitle);
            return (
              <li key={candidate.candidateId}>
                <span>
                  <small>{formatMessage(messages.recordLabel, { number })}</small>
                  <strong>{title}</strong>
                </span>
                <button
                  type="button"
                  aria-label={formatMessage(messages.downloadLabel, { title, number })}
                  onClick={() => void exportCandidate(candidate)}
                >
                  {messages.download}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
