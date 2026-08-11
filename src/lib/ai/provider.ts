import type { AssignmentAnalysis, DraftCheckResult } from "@/lib/domain";

export const LIVE_INPUT_LIMITS = {
  assignmentText: 120_000,
  rubricText: 80_000,
  draftText: 40_000,
  assignmentContext: 160_000,
  section: 160,
  fileName: 255,
} as const;

export type AiProviderMode = "mock" | "live";

export interface AssignmentAnalysisInput {
  assignmentText: string;
  rubricText?: string;
  fileName?: string;
}

export interface DraftCheckInput {
  assignment: AssignmentAnalysis;
  draftText: string;
  section: string;
}

/**
 * Mock and Live providers deliberately share this contract. The UI should not
 * need provider-specific rendering or data coercion.
 */
export interface AiProvider {
  readonly mode: AiProviderMode;
  analyzeAssignment(input: AssignmentAnalysisInput): Promise<AssignmentAnalysis>;
  checkDraft(input: DraftCheckInput): Promise<DraftCheckResult>;
}

export type LiveAiErrorCode =
  | "INVALID_JSON"
  | "INVALID_REQUEST"
  | "INPUT_TOO_LARGE"
  | "LIVE_MODE_REQUIRED"
  | "LIVE_DISABLED"
  | "LIVE_AUTH_NOT_CONFIGURED"
  | "LIVE_UNAUTHORIZED"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "LIVE_API_KEY_MISSING"
  | "LIVE_MODEL_NOT_ALLOWED"
  | "MODEL_REFUSAL"
  | "MODEL_INCOMPLETE"
  | "MODEL_OUTPUT_INVALID"
  | "UPSTREAM_AUTH_ERROR"
  | "UPSTREAM_QUOTA_EXHAUSTED"
  | "UPSTREAM_RATE_LIMITED"
  | "UPSTREAM_TIMEOUT"
  | "UPSTREAM_UNAVAILABLE"
  | "UPSTREAM_REQUEST_REJECTED"
  | "UPSTREAM_ERROR"
  | "INTERNAL_ERROR";

export class LiveAiError extends Error {
  readonly code: LiveAiErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly requestId?: string;

  constructor(options: {
    code: LiveAiErrorCode;
    message: string;
    status: number;
    retryable?: boolean;
    requestId?: string;
  }) {
    super(options.message);
    this.name = "LiveAiError";
    this.code = options.code;
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    this.requestId = options.requestId;
  }
}

export interface LiveAiFailure {
  ok: false;
  error: {
    code: LiveAiErrorCode;
    message: string;
    retryable: boolean;
    requestId?: string;
  };
}

export function normalizeLiveAiError(error: unknown): LiveAiError {
  if (error instanceof LiveAiError) {
    return error;
  }

  return new LiveAiError({
    code: "INTERNAL_ERROR",
    message: "The live analysis could not be completed.",
    status: 500,
  });
}

export function toLiveAiFailure(error: unknown): {
  status: number;
  body: LiveAiFailure;
} {
  const normalized = normalizeLiveAiError(error);

  return {
    status: normalized.status,
    body: {
      ok: false,
      error: {
        code: normalized.code,
        message: normalized.message,
        retryable: normalized.retryable,
        ...(normalized.requestId ? { requestId: normalized.requestId } : {}),
      },
    },
  };
}
