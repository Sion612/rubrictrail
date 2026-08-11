import {
  draftCheckResultSchema,
  type DraftCheckResult,
} from "@/lib/domain";
import { SAMPLE_DRAFT_CHECK, SAMPLE_DRAFT_TEXT } from "@/lib/sample-data";

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/u).length : 0;
}

function getSectionCoaching(sectionId: string) {
  if (sectionId === "executive-summary") {
    return {
      rubricIds: ["diagnosis", "communication"],
      sourceEvidenceRefs: ["rubric-diagnosis", "rubric-communication"],
      title: "Make the executive summary decision-useful",
      explanation: "An executive summary should synthesize the problem, causal insight, recommended direction, and key limitation without introducing new evidence.",
      action: "State the operational problem, the most defensible cause, the selected response, and one important caveat in a compact sequence.",
      successCheck: "A decision-maker can understand the report's argument without reading new claims that appear nowhere else.",
      question: "What should a decision-maker know, decide, and remain cautious about after reading this summary?",
      nextAction: "Condense the problem, causal finding, selected action, and caveat into a decision-focused summary.",
    };
  }
  if (sectionId === "problem-scope") {
    return {
      rubricIds: ["diagnosis", "evidence"],
      sourceEvidenceRefs: ["rubric-diagnosis", "brief-scope"],
      title: "Bound the problem before analysing causes",
      explanation: "A problem-scope section should define the process start and end, baseline, primary outcome, guardrails, and exclusions.",
      action: "Write a one-sentence boundary, add the baseline measure and source, then name what this report will not try to solve.",
      successCheck: "A reader can tell exactly which process, period, outcome, and exclusions the analysis covers.",
      question: "Where does this process begin and end, and which outcome will show whether it improved?",
      nextAction: "Add a process boundary, baseline, success measure, guardrail, and explicit exclusion.",
    };
  }
  if (sectionId === "implementation") {
    return {
      rubricIds: ["recommendations", "communication"],
      sourceEvidenceRefs: ["rubric-recommendations", "brief-roadmap"],
      title: "Turn the proposal into a testable implementation",
      explanation: "Implementation evidence needs sequence, owners, resource assumptions, risks, KPIs, guardrails, and a review trigger.",
      action: "Convert each action into a pilot step with an owner, timing, dependency, measure, risk, and stop-or-adjust rule.",
      successCheck: "Another person could run and evaluate the pilot without inventing missing operational details.",
      question: "Who acts first, what must be true, and which result would trigger continuation, adjustment, or stop?",
      nextAction: "Add owners, sequence, resource assumptions, KPIs, risks, and a review trigger to the roadmap.",
    };
  }
  if (sectionId === "conclusion") {
    return {
      rubricIds: ["recommendations", "communication"],
      sourceEvidenceRefs: ["rubric-recommendations", "rubric-communication"],
      title: "Synthesize the argument without adding new claims",
      explanation: "A conclusion should answer the assignment question, connect diagnosis to recommendation, and acknowledge the most material limitation.",
      action: "Restate the answer, causal logic, selected response, and limitation using evidence already established in the report.",
      successCheck: "The final paragraph closes the argument and contains no unsupported new fact, source, or promise.",
      question: "What is the report's answer, why is it defensible, and what remains uncertain?",
      nextAction: "Close the argument with the diagnosis-to-action logic and one material limitation.",
    };
  }
  return {
    rubricIds: ["recommendations"],
    sourceEvidenceRefs: ["rubric-recommendations", "case-capacity"],
    title: "Make the cause-to-action logic explicit",
    explanation: "A feasible recommendation should change the diagnosed constraint, not only sound generally helpful.",
    action: "Test the recommendation against the constrained process step and name one trade-off.",
    successCheck: "Each recommendation has a cause, action, trade-off, owner, and KPI.",
    question: "Which diagnosed cause changes because of this action, and what trade-off must be tested?",
    nextAction: "Rewrite the recommendation logic as cause → action → trade-off → KPI.",
  };
}

function makeDynamicResult(text: string, sectionId: string): DraftCheckResult {
  const words = wordCount(text);
  const hasNumber = /\b\d+(?:\.\d+)?%?\b/u.test(text);
  const hasCitation = /\([A-Z][A-Za-z-]+,?\s+\d{4}\)/u.test(text);
  const hasContrast = /\b(however|although|whereas|trade-off|limitation)\b/iu.test(text);
  const coverage = Math.min(72, 22 + (hasNumber ? 12 : 0) + (hasCitation ? 14 : 0) + (hasContrast ? 8 : 0) + Math.min(16, Math.floor(words / 30)));
  const excerpt = text.trim().slice(0, Math.min(180, text.trim().length));
  const sectionCoaching = getSectionCoaching(sectionId);

  return draftCheckResultSchema.parse({
    id: `mock-check-${Date.now()}`,
    assignmentId: "lumalane-om302-2026",
    draftId: "student-draft-live-input",
    sectionId,
    coverageEstimate: coverage,
    coverageDisclaimer: "A deterministic surface-signal heuristic — not semantic evaluation and not a predicted grade.",
    criteria: [
      {
        criterionId: "diagnosis",
        coverage: hasNumber ? 58 : 34,
        status: hasNumber ? "partial" : "emerging",
        summary: hasNumber
          ? "The draft uses a measurable signal, but the process boundary and causal chain need to be explicit."
          : "The issue is described, but a measurable baseline is not yet visible.",
        strengths: hasNumber ? ["Uses at least one observable quantity."] : [],
        gaps: ["Define the process boundary and connect symptoms to causes."],
        evidenceRefs: ["rubric-diagnosis", "brief-scope"],
      },
      {
        criterionId: "theory",
        coverage: hasContrast ? 52 : 28,
        status: hasContrast ? "partial" : "emerging",
        summary: "A concept may be named, but its mechanism and limitations need clearer application.",
        strengths: hasContrast ? ["Signals a limitation or trade-off."] : [],
        gaps: ["Apply a concept to a specific process step and explain what it reveals."],
        evidenceRefs: ["rubric-theory", "brief-theory"],
      },
      {
        criterionId: "evidence",
        coverage: hasCitation ? 55 : 24,
        status: hasCitation ? "partial" : "emerging",
        summary: hasCitation
          ? "A citation signal is present; verify that each material claim has a traceable source."
          : "Material claims need traceable case or external evidence.",
        strengths: hasCitation ? ["Includes an author-date citation pattern."] : [],
        gaps: ["Separate case facts, interpretations, and assumptions."],
        evidenceRefs: ["rubric-evidence", "brief-evidence"],
      },
      {
        criterionId: "recommendations",
        coverage: 30,
        status: "emerging",
        summary: "Recommendations need a clearer cause-to-action link and feasibility comparison.",
        strengths: [],
        gaps: ["Compare options on impact, feasibility, trade-offs, owner, and KPI."],
        evidenceRefs: ["rubric-recommendations", "brief-recommendations"],
      },
      {
        criterionId: "communication",
        coverage: words >= 80 ? 60 : 38,
        status: words >= 80 ? "partial" : "emerging",
        summary: words >= 80
          ? "The section is readable, but precise signposting and citation checks are still needed."
          : "The extract is too short to assess structure with confidence.",
        strengths: words >= 80 ? ["Sustains a readable paragraph sequence."] : [],
        gaps: ["Replace vague evaluative words with a measure or qualification."],
        evidenceRefs: ["rubric-communication"],
      },
    ],
    feedback: [
      {
        id: "dynamic-evidence-gap",
        kind: "evidence_gap",
        severity: "high",
        rubricIds: ["evidence", "diagnosis"],
        title: hasNumber ? "Connect the measure to a causal claim" : "Add an observable baseline",
        explanation: hasNumber
          ? "A number is visible, but the reader still needs to see what process step it describes and what conclusion it supports."
          : "The reader cannot judge the scale of the problem without one observable measure.",
        draftEvidence: excerpt ? [{ start: 0, end: excerpt.length, excerpt }] : [],
        sourceEvidenceRefs: ["rubric-evidence", "case-service"],
        action: "Add one verified measure, explain its boundary, then state the inference in cautious language.",
        successCheck: "A reader can trace the measure to its source and see exactly what conclusion it supports.",
        guidance: {
          kind: "question",
          text: "What measure would prove this problem is material, and where does that measure come from?",
        },
      },
      {
        id: "dynamic-section-fit",
        kind: "issue",
        severity: "high",
        rubricIds: sectionCoaching.rubricIds,
        title: sectionCoaching.title,
        explanation: sectionCoaching.explanation,
        draftEvidence: [],
        sourceEvidenceRefs: sectionCoaching.sourceEvidenceRefs,
        action: sectionCoaching.action,
        successCheck: sectionCoaching.successCheck,
        guidance: {
          kind: "question",
          text: sectionCoaching.question,
        },
      },
    ],
    nextActions: [
      {
        id: "dynamic-next-1",
        text: "Add and verify one baseline measure for the selected process problem.",
        priority: "high",
        estimatedMinutes: 20,
        rubricIds: ["diagnosis", "evidence"],
      },
      {
        id: "dynamic-next-2",
        text: sectionCoaching.nextAction,
        priority: "high",
        estimatedMinutes: 30,
        rubricIds: sectionCoaching.rubricIds,
      },
    ],
  });
}

export async function runMockDraftCheck(
  text: string,
  sectionId: string,
): Promise<DraftCheckResult> {
  await new Promise((resolve) => window.setTimeout(resolve, 260));
  const isSample = text.trim() === SAMPLE_DRAFT_TEXT.trim();
  if (isSample && sectionId === "analysis-recommendations") {
    return draftCheckResultSchema.parse({
      ...SAMPLE_DRAFT_CHECK,
      id: `mock-check-${Date.now()}`,
      sectionId,
    });
  }
  return makeDynamicResult(text, sectionId);
}
