import { NextResponse } from "next/server";
import { z } from "zod";

import { createLiveAiProvider } from "@/lib/ai/live-provider";
import { assertLiveRouteAuthorized, readBoundedJson } from "@/lib/ai/live-route-guard";
import {
  LIVE_INPUT_LIMITS,
  LiveAiError,
  toLiveAiFailure,
} from "@/lib/ai/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BODY_CHARS =
  LIVE_INPUT_LIMITS.assignmentText + LIVE_INPUT_LIMITS.rubricText + 8_000;

const AssignmentRequestSchema = z
  .object({
    mode: z.literal("live"),
    assignmentText: z.string().trim().min(1).max(LIVE_INPUT_LIMITS.assignmentText),
    rubricText: z.string().trim().max(LIVE_INPUT_LIMITS.rubricText).optional(),
    fileName: z.string().trim().max(LIVE_INPUT_LIMITS.fileName).optional(),
  })
  .strict();

function errorResponse(error: unknown) {
  const failure = toLiveAiFailure(error);
  return NextResponse.json(failure.body, {
    status: failure.status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  try {
    assertLiveRouteAuthorized(request);
    const body = await readBoundedJson(
      request,
      MAX_REQUEST_BODY_CHARS,
      "The assignment request is too large for Live analysis.",
    );

    if (typeof body !== "object" || body === null || !("mode" in body) || body.mode !== "live") {
      throw new LiveAiError({
        code: "LIVE_MODE_REQUIRED",
        message: "Choose Live mode explicitly before sending a live analysis request.",
        status: 400,
      });
    }

    const parsed = AssignmentRequestSchema.safeParse(body);
    if (!parsed.success) {
      const oversized = parsed.error.issues.some((issue) => issue.code === "too_big");
      throw new LiveAiError({
        code: oversized ? "INPUT_TOO_LARGE" : "INVALID_REQUEST",
        message: oversized
          ? "The assignment request is too large for Live analysis."
          : "Provide assignmentText and only the supported Live analysis fields.",
        status: oversized ? 413 : 400,
      });
    }

    // Provider creation performs the server-side enabled/key/model checks.
    const provider = createLiveAiProvider(parsed.data.mode);
    const analysis = await provider.analyzeAssignment({
      assignmentText: parsed.data.assignmentText,
      rubricText: parsed.data.rubricText,
      fileName: parsed.data.fileName,
    });

    return NextResponse.json(
      {
        ok: true,
        mode: provider.mode,
        model: provider.model,
        analysis,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
