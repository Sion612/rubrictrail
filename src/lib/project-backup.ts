import { z } from "zod";
import {
  MAX_STORED_CHARACTERS,
  parsePersistedProjectStateValue,
  serializePersistedProjectStateValue,
} from "@/lib/local-state";
import type { PersistedProjectState } from "@/lib/ui-types";

export const PROJECT_BACKUP_FORMAT = "rubrictrail-project";
export const PROJECT_BACKUP_FORMAT_VERSION = 1;
export const MAX_PROJECT_BACKUP_BYTES = 10 * 1024 * 1024;
export const MAX_PROJECT_BACKUP_CHARACTERS = MAX_STORED_CHARACTERS + 2_048;

export type ProjectBackupErrorCode =
  | "empty-file"
  | "file-too-large"
  | "invalid-utf8"
  | "invalid-json"
  | "wrong-format"
  | "unsupported-format-version"
  | "unsupported-state-version"
  | "invalid-project"
  | "no-project";

export class ProjectBackupError extends Error {
  readonly code: ProjectBackupErrorCode;

  constructor(code: ProjectBackupErrorCode, message: string) {
    super(message);
    this.name = "ProjectBackupError";
    this.code = code;
  }
}

export interface ParsedProjectBackup {
  state: PersistedProjectState;
  exportedAt: string;
  recovered: boolean;
}

interface ProjectBackupEnvelope {
  format: typeof PROJECT_BACKUP_FORMAT;
  formatVersion: typeof PROJECT_BACKUP_FORMAT_VERSION;
  exportedAt: string;
  project: PersistedProjectState;
}

const exportedAtSchema = z.string().datetime({ offset: true });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidProject(message = "This backup contains invalid or incomplete project data.") {
  return new ProjectBackupError("invalid-project", message);
}

function validateEnvelopeKeys(value: Record<string, unknown>): void {
  const expected = new Set(["format", "formatVersion", "exportedAt", "project"]);
  if (
    Object.keys(value).length !== expected.size ||
    Object.keys(value).some((key) => !expected.has(key))
  ) {
    throw invalidProject("This backup has unexpected or missing fields.");
  }
}

function portableProjectState(state: PersistedProjectState): {
  state: PersistedProjectState;
  recovered: boolean;
} {
  const nextState: PersistedProjectState = {
    ...state,
    draftText: state.projectKind === "uploaded" ? "" : state.draftText,
    draftResult: null,
    checkedDraftText: null,
  };
  return {
    state: nextState,
    recovered:
      state.draftResult !== null ||
      state.checkedDraftText !== null ||
      (state.projectKind === "uploaded" && state.draftText !== ""),
  };
}

export function projectBackupTitle(state: PersistedProjectState): string {
  return state.projectKind === "uploaded" && state.uploadedProject
    ? state.uploadedProject.title
    : "RubricTrail sample project";
}

export function serializeProjectBackup(
  state: PersistedProjectState,
  exportedAt = new Date().toISOString(),
): string {
  const parsed = parsePersistedProjectStateValue(state);
  if (!parsed.ok) throw invalidProject();
  if (parsed.state.projectKind === "none") {
    throw new ProjectBackupError("no-project", "There is no project to back up yet.");
  }
  if (!exportedAtSchema.safeParse(exportedAt).success) {
    throw invalidProject("The backup export time is invalid.");
  }
  const portable = portableProjectState(parsed.state);
  const storageReady = serializePersistedProjectStateValue(portable.state);
  if (!storageReady.ok) {
    throw invalidProject("This project is too large to create a safe backup.");
  }

  const envelope: ProjectBackupEnvelope = {
    format: PROJECT_BACKUP_FORMAT,
    formatVersion: PROJECT_BACKUP_FORMAT_VERSION,
    exportedAt,
    project: storageReady.state,
  };
  const serialized = JSON.stringify(envelope);
  if (serialized.length > MAX_PROJECT_BACKUP_CHARACTERS) {
    throw invalidProject("This project is too large to create a safe backup.");
  }
  return serialized;
}

export function parseProjectBackupText(text: string): ParsedProjectBackup {
  if (text.length === 0) {
    throw new ProjectBackupError("empty-file", "The selected backup file is empty.");
  }
  if (text.length > MAX_PROJECT_BACKUP_CHARACTERS) {
    throw new ProjectBackupError(
      "file-too-large",
      "This backup is larger than RubricTrail can safely restore.",
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new ProjectBackupError(
      "invalid-json",
      "This file is not valid JSON and cannot be restored.",
    );
  }

  if (!isRecord(value) || value.format !== PROJECT_BACKUP_FORMAT) {
    throw new ProjectBackupError(
      "wrong-format",
      "Choose a RubricTrail project backup, not a raw project or another JSON file.",
    );
  }
  if (value.formatVersion !== PROJECT_BACKUP_FORMAT_VERSION) {
    throw new ProjectBackupError(
      "unsupported-format-version",
      typeof value.formatVersion === "number" &&
        value.formatVersion > PROJECT_BACKUP_FORMAT_VERSION
        ? "This backup was created by a newer RubricTrail format. Upgrade RubricTrail before restoring it."
        : "This RubricTrail backup format is not supported.",
    );
  }

  validateEnvelopeKeys(value);
  const exportedAt = exportedAtSchema.safeParse(value.exportedAt);
  if (!exportedAt.success) {
    throw invalidProject("This backup has an invalid export time.");
  }

  const project = parsePersistedProjectStateValue(value.project);
  if (!project.ok) {
    if (project.reason === "unsupported-version") {
      throw new ProjectBackupError(
        "unsupported-state-version",
        "This project uses a newer RubricTrail data version. Upgrade RubricTrail before restoring it.",
      );
    }
    throw invalidProject();
  }
  if (project.state.projectKind === "none") {
    throw new ProjectBackupError(
      "no-project",
      "This backup does not contain a started project.",
    );
  }
  const portable = portableProjectState(project.state);
  const storageReady = serializePersistedProjectStateValue(portable.state);
  if (!storageReady.ok) throw invalidProject();

  return {
    state: storageReady.state,
    exportedAt: exportedAt.data,
    recovered: project.recovered || portable.recovered || storageReady.recovered,
  };
}

export async function readProjectBackupFile(file: File): Promise<ParsedProjectBackup> {
  if (file.size === 0) {
    throw new ProjectBackupError("empty-file", "The selected backup file is empty.");
  }
  if (file.size > MAX_PROJECT_BACKUP_BYTES) {
    throw new ProjectBackupError(
      "file-too-large",
      "Choose a RubricTrail backup smaller than 10 MB.",
    );
  }

  let text: string;
  try {
    const bytes = await file.arrayBuffer();
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new ProjectBackupError(
      "invalid-utf8",
      "This backup is unreadable or is not valid UTF-8 text.",
    );
  }
  return parseProjectBackupText(text);
}

export function projectBackupFileName(
  state: PersistedProjectState,
  exportedAt = new Date().toISOString(),
): string {
  const slug = projectBackupTitle(state)
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "project";
  const date = exportedAtSchema.safeParse(exportedAt).success
    ? exportedAt.slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  return `rubrictrail-${slug}-${date}.rubrictrail.json`;
}
