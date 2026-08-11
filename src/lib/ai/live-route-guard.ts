import "server-only";

import { timingSafeEqual } from "node:crypto";
import { LiveAiError } from "@/lib/ai/provider";

function safeTokenMatch(received: string, expected: string): boolean {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function assertLiveRouteAuthorized(request: Request): void {
  if (process.env.OPENAI_LIVE_ENABLED !== "true") {
    throw new LiveAiError({
      code: "LIVE_DISABLED",
      message: "Live AI is disabled. The local workflow remains available.",
      status: 503,
    });
  }

  const expected = process.env.OPENAI_LIVE_TOKEN?.trim();
  if (!expected || expected.length < 32) {
    throw new LiveAiError({
      code: "LIVE_AUTH_NOT_CONFIGURED",
      message: "Live AI authentication is not configured.",
      status: 503,
    });
  }

  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) {
    throw new LiveAiError({
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "Live requests must use application/json.",
      status: 415,
    });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const received = authorization.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!received || !safeTokenMatch(received, expected)) {
    throw new LiveAiError({
      code: "LIVE_UNAUTHORIZED",
      message: "Live AI authorization failed.",
      status: 401,
    });
  }
}

export async function readBoundedJson(
  request: Request,
  maxCharacters: number,
  tooLargeMessage: string,
): Promise<unknown> {
  const maxBytes = maxCharacters * 4;
  const declaredBytes = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    throw new LiveAiError({
      code: "INPUT_TOO_LARGE",
      message: tooLargeMessage,
      status: 413,
    });
  }

  const reader = request.body?.getReader();
  const decoder = new TextDecoder();
  let byteCount = 0;
  let raw = "";
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteCount += value.byteLength;
      if (byteCount > maxBytes) {
        await reader.cancel();
        throw new LiveAiError({
          code: "INPUT_TOO_LARGE",
          message: tooLargeMessage,
          status: 413,
        });
      }
      raw += decoder.decode(value, { stream: true });
      if (raw.length > maxCharacters) {
        await reader.cancel();
        throw new LiveAiError({
          code: "INPUT_TOO_LARGE",
          message: tooLargeMessage,
          status: 413,
        });
      }
    }
    raw += decoder.decode();
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new LiveAiError({
      code: "INVALID_JSON",
      message: "Send a valid JSON request body.",
      status: 400,
    });
  }
}
