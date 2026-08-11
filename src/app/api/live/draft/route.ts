import { NextResponse } from "next/server";
import { z } from "zod";
import { assignmentAnalysisSchema } from "@/lib/domain";
import { createLiveAiProvider } from "@/lib/ai/live-provider";
import { assertLiveRouteAuthorized, readBoundedJson } from "@/lib/ai/live-route-guard";
import { LIVE_INPUT_LIMITS, LiveAiError, toLiveAiFailure } from "@/lib/ai/provider";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BODY_CHARS = LIVE_INPUT_LIMITS.assignmentContext + LIVE_INPUT_LIMITS.draftText + 8_000;

const DraftRequestSchema = z.object({
  mode: z.literal("live"),
  assignment: assignmentAnalysisSchema,
  draftText: z.string().trim().min(1).max(LIVE_INPUT_LIMITS.draftText),
  section: z.string().trim().min(1).max(LIVE_INPUT_LIMITS.section),
}).strict();

function errorResponse(error: unknown) {
  const failure = toLiveAiFailure(error);
  return NextResponse.json(failure.body, { status: failure.status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  try {
    assertLiveRouteAuthorized(request);
    const body = await readBoundedJson(
      request,
      MAX_REQUEST_BODY_CHARS,
      "The draft-check request is too large.",
    );
    if (typeof body !== "object" || body === null || !("mode" in body) || body.mode !== "live") {
      throw new LiveAiError({ code: "LIVE_MODE_REQUIRED", message: "Choose Live mode explicitly before sending a live draft check.", status: 400 });
    }
    const parsed = DraftRequestSchema.safeParse(body);
    if (!parsed.success) {
      const oversized = parsed.error.issues.some((issue) => issue.code === "too_big");
      throw new LiveAiError({ code: oversized ? "INPUT_TOO_LARGE" : "INVALID_REQUEST", message: oversized ? "The draft-check request is too large." : "Provide assignment, draftText, section, and mode='live'.", status: oversized ? 413 : 400 });
    }
    if (JSON.stringify(parsed.data.assignment).length > LIVE_INPUT_LIMITS.assignmentContext) {
      throw new LiveAiError({ code: "INPUT_TOO_LARGE", message: "The assignment context is too large.", status: 413 });
    }
    const provider = createLiveAiProvider(parsed.data.mode);
    const result = await provider.checkDraft({ assignment: parsed.data.assignment, draftText: parsed.data.draftText, section: parsed.data.section });
    return NextResponse.json({ ok: true, mode: provider.mode, model: provider.model, result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
