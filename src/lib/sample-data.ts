import {
  assignmentAnalysisSchema,
  rubricTrailFixtureSchema,
  type AssignmentAnalysis,
  type DraftCheckResult,
  type DraftInput,
  type DraftSpan,
} from "./domain";

/** Stable baseline used to generate the fictional sample Action Plan. */
export const SAMPLE_PLANNING_BASELINE_DATE = "2026-08-17";

export const SAMPLE_ASSIGNMENT_BRIEF = `OM302 Operations Management
Individual Operations Improvement Report

Case: LumaLane Market — Click-and-Collect Operations
Deadline: 7 September 2026, 17:00 Europe/London
Length: 2,000 words, ±10%
Submission: One PDF
Referencing: Harvard style

LumaLane Market is a fictional eight-store convenience retailer serving university districts. Its click-and-collect service has experienced long collection waits, order errors and rising overtime during the 17:00–19:00 peak.

Write an individual operations improvement report that diagnoses one priority process problem and proposes a feasible response. Focus on one process problem; do not attempt to redesign the whole business.

Your report must:
1. Define the process boundary and the performance problem.
2. Include a current-state process map.
3. Use at least two relevant operations concepts to explain why the problem occurs, not merely to define terminology.
4. Combine evidence from the case pack with relevant external academic or professional sources.
5. Recommend two or three feasible changes and evaluate their trade-offs.
6. Provide a one-page implementation roadmap covering owners, sequence, resources, risks and measures of success.
7. Distinguish case facts, external evidence and your own assumptions.

The report should use a professional structure: executive summary, problem scope, analysis, recommendations, implementation, conclusion and references. Submit one PDF containing a 2,000-word report (±10%), a current-state process map, a one-page implementation roadmap and a reference list. The reference list and appendix are excluded from the word count; prose in tables is included. Use Harvard referencing.

Case pack
LumaLane’s current collection process:
1. Same-day orders close at 15:00.
2. Most orders are released to store staff together at 16:15.
3. Pickers collect products and send packed orders to a shared staging area.
4. At collection, a service colleague searches the staging area, verifies substitutions and hands over the order.

Observed across ten peak sessions:
- Average incoming demand: 42 orders/hour.
- Picking capacity: 46 orders/hour.
- Staging and handover capacity: 34 orders/hour.
- Mean customer wait: 11.8 minutes.
- Customers waiting over 15 minutes: 31%.
- Wrong or missing item rate: 7.2%.
- Fresh-item substitution rate: 18%.
- Customers abandoning collection: 8.6%.
- Peak-related overtime: 26 staff-hours/week.
- Friday demand is 1.6 times Tuesday demand.

Staff observations:
- Store managers believe unpredictable demand is the main problem.
- Pickers report congestion after the 16:15 batch release.
- Collection colleagues say labels are difficult to see in the shared staging area.
- Customers do not receive a message when an order is actually ready.
- No budget ceiling or floor-space expansion has been approved.

Learning outcomes:
- Analyse process performance using appropriate operations concepts and data.
- Evaluate operational choices and performance trade-offs.
- Develop a feasible, measurable improvement approach.
- Communicate an evidence-based recommendation in clear academic English.

Do not invent operational data, customer research, quotations or references. Any estimate must be clearly labelled and its basis explained. Follow the module AI-use policy: permitted AI support for planning or language feedback must be declared; generated analysis or report prose may not be submitted as the student’s own work.

This case, organisation and all operational data are fictional and were created for the RubricTrail demonstration.`;

export const SAMPLE_RUBRIC_TEXT = `OM302 Individual Operations Improvement Report — Rubric

Problem diagnosis — 20%
High performance defines a defensible process boundary and priority performance gap, maps the current process, connects symptoms to causes, and recognises relevant performance trade-offs.

Application of operations theory — 25%
High performance selects concepts suited to the case, applies them accurately to process evidence, explains limitations, and uses theory to deepen or change the diagnosis rather than merely defining terms.

Evidence and analysis — 20%
High performance integrates quantitative and qualitative case evidence with credible external sources, distinguishes facts from interpretations and assumptions, and handles data limitations honestly.

Quality of recommendations — 25%
High performance compares root-cause-linked options, assesses impact, feasibility and trade-offs, and defines owners, sequence, risks, KPIs and a review point for the selected response.

Structure and academic communication — 10%
High performance uses the required report structure, concise academic English, precise terminology, logical signposting and consistent Harvard citations.`;

const assignmentCandidate = {
  id: "lumalane-om302-2026",
  title: "Reducing Collection Delays at LumaLane Market",
  course: "OM302 Operations Management",
  subject: "Operations Management",
  assignmentType: "Individual operations improvement report",
  dueAt: "2026-09-07T17:00:00+01:00",
  timezone: "Europe/London",
  wordCount: {
    target: 2000,
    tolerancePercent: 10,
    includes: ["report body", "prose in tables"],
    excludes: ["reference list", "appendix"],
  },
  citationStyle: "Harvard",
  executiveSummary:
    "Diagnose one priority constraint in LumaLane Market’s click-and-collect process, apply operations theory to case evidence, and propose a feasible, measurable improvement plan.",
  sourceDocuments: [
    {
      id: "lumalane-brief",
      name: "OM302 LumaLane assignment brief.txt",
      kind: "brief",
      mimeType: "text/plain",
      content: SAMPLE_ASSIGNMENT_BRIEF,
    },
    {
      id: "lumalane-rubric",
      name: "OM302 assessment rubric.txt",
      kind: "rubric",
      mimeType: "text/plain",
      content: SAMPLE_RUBRIC_TEXT,
    },
  ],
  evidence: [
    {
      id: "brief-scope",
      documentId: "lumalane-brief",
      locator: { section: "Task", paragraph: 2 },
      excerpt:
        "Focus on one process problem; do not attempt to redesign the whole business.",
    },
    {
      id: "brief-theory",
      documentId: "lumalane-brief",
      locator: { section: "Requirements", paragraph: 3 },
      excerpt:
        "Use at least two relevant operations concepts to explain why the problem occurs, not merely to define terminology.",
    },
    {
      id: "brief-evidence",
      documentId: "lumalane-brief",
      locator: { section: "Requirements", paragraph: 4 },
      excerpt:
        "Combine evidence from the case pack with relevant external academic or professional sources.",
    },
    {
      id: "brief-recommendations",
      documentId: "lumalane-brief",
      locator: { section: "Requirements", paragraph: 5 },
      excerpt:
        "Recommend two or three feasible changes and evaluate their trade-offs.",
    },
    {
      id: "brief-roadmap",
      documentId: "lumalane-brief",
      locator: { section: "Requirements", paragraph: 6 },
      excerpt:
        "Provide a one-page implementation roadmap covering owners, sequence, resources, risks and measures of success.",
    },
    {
      id: "brief-deliverable",
      documentId: "lumalane-brief",
      locator: { section: "Submission" },
      excerpt:
        "Submit one PDF containing a 2,000-word report (±10%), a current-state process map, a one-page implementation roadmap and a reference list.",
    },
    {
      id: "brief-word-count",
      documentId: "lumalane-brief",
      locator: { section: "Submission" },
      excerpt:
        "The reference list and appendix are excluded from the word count; prose in tables is included.",
    },
    {
      id: "brief-deadline",
      documentId: "lumalane-brief",
      locator: { section: "Header" },
      excerpt: "Deadline: 7 September 2026, 17:00 Europe/London",
    },
    {
      id: "brief-integrity",
      documentId: "lumalane-brief",
      locator: { section: "Academic integrity" },
      excerpt:
        "Do not invent operational data, customer research, quotations or references. Any estimate must be clearly labelled and its basis explained.",
    },
    {
      id: "brief-ai-policy",
      documentId: "lumalane-brief",
      locator: { section: "Academic integrity" },
      excerpt:
        "Follow the module AI-use policy: permitted AI support for planning or language feedback must be declared; generated analysis or report prose may not be submitted as the student’s own work.",
    },
    {
      id: "case-capacity",
      documentId: "lumalane-brief",
      locator: { section: "Case pack — metrics" },
      excerpt:
        "Average incoming demand: 42 orders/hour.\n- Picking capacity: 46 orders/hour.\n- Staging and handover capacity: 34 orders/hour.",
    },
    {
      id: "case-service",
      documentId: "lumalane-brief",
      locator: { section: "Case pack — metrics" },
      excerpt:
        "Mean customer wait: 11.8 minutes.\n- Customers waiting over 15 minutes: 31%.\n- Wrong or missing item rate: 7.2%.\n- Fresh-item substitution rate: 18%.\n- Customers abandoning collection: 8.6%.",
    },
    {
      id: "case-quality",
      documentId: "lumalane-brief",
      locator: { section: "Case pack — metrics" },
      excerpt:
        "Wrong or missing item rate: 7.2%.\n- Fresh-item substitution rate: 18%.",
    },
    {
      id: "case-variation",
      documentId: "lumalane-brief",
      locator: { section: "Case pack — metrics" },
      excerpt: "Friday demand is 1.6 times Tuesday demand.",
    },
    {
      id: "case-batch-release",
      documentId: "lumalane-brief",
      locator: { section: "Case pack — staff observations" },
      excerpt: "Pickers report congestion after the 16:15 batch release.",
    },
    {
      id: "case-notification",
      documentId: "lumalane-brief",
      locator: { section: "Case pack — staff observations" },
      excerpt:
        "Customers do not receive a message when an order is actually ready.",
    },
    {
      id: "case-budget",
      documentId: "lumalane-brief",
      locator: { section: "Case pack — constraints" },
      excerpt: "No budget ceiling or floor-space expansion has been approved.",
    },
    {
      id: "rubric-diagnosis",
      documentId: "lumalane-rubric",
      locator: { section: "Problem diagnosis" },
      excerpt:
        "High performance defines a defensible process boundary and priority performance gap, maps the current process, connects symptoms to causes, and recognises relevant performance trade-offs.",
    },
    {
      id: "rubric-theory",
      documentId: "lumalane-rubric",
      locator: { section: "Application of operations theory" },
      excerpt:
        "High performance selects concepts suited to the case, applies them accurately to process evidence, explains limitations, and uses theory to deepen or change the diagnosis rather than merely defining terms.",
    },
    {
      id: "rubric-evidence",
      documentId: "lumalane-rubric",
      locator: { section: "Evidence and analysis" },
      excerpt:
        "High performance integrates quantitative and qualitative case evidence with credible external sources, distinguishes facts from interpretations and assumptions, and handles data limitations honestly.",
    },
    {
      id: "rubric-recommendations",
      documentId: "lumalane-rubric",
      locator: { section: "Quality of recommendations" },
      excerpt:
        "High performance compares root-cause-linked options, assesses impact, feasibility and trade-offs, and defines owners, sequence, risks, KPIs and a review point for the selected response.",
    },
    {
      id: "rubric-communication",
      documentId: "lumalane-rubric",
      locator: { section: "Structure and academic communication" },
      excerpt:
        "High performance uses the required report structure, concise academic English, precise terminology, logical signposting and consistent Harvard citations.",
    },
  ],
  deliverables: [
    {
      id: "deliverable-report",
      label: "2,000-word report",
      description:
        "A 2,000-word individual operations improvement report with a ±10% tolerance.",
      status: "explicit",
      priority: "required",
      evidenceRefs: ["brief-deliverable", "brief-word-count"],
    },
    {
      id: "deliverable-map",
      label: "Current-state process map",
      description:
        "A process map covering the selected process boundary as it operates now.",
      status: "explicit",
      priority: "required",
      evidenceRefs: ["brief-deliverable", "rubric-diagnosis"],
    },
    {
      id: "deliverable-roadmap",
      label: "One-page implementation roadmap",
      description:
        "A one-page plan with owners, sequence, resources, risks and success measures.",
      status: "explicit",
      priority: "required",
      evidenceRefs: ["brief-roadmap", "brief-deliverable"],
    },
    {
      id: "deliverable-references",
      label: "Harvard reference list",
      description: "A verified Harvard-style reference list in the same PDF.",
      status: "explicit",
      priority: "required",
      evidenceRefs: ["brief-deliverable", "brief-evidence"],
    },
  ],
  learningObjectives: [
    {
      id: "lo-analysis",
      label: "Analyse process performance",
      description:
        "Use appropriate operations concepts and data to explain process performance.",
      status: "explicit",
      priority: "required",
      evidenceRefs: ["brief-theory", "rubric-theory"],
    },
    {
      id: "lo-tradeoffs",
      label: "Evaluate operational trade-offs",
      description:
        "Compare operational choices rather than presenting a solution without alternatives.",
      status: "explicit",
      priority: "required",
      evidenceRefs: ["brief-recommendations", "rubric-recommendations"],
    },
    {
      id: "lo-implementation",
      label: "Develop a measurable response",
      description:
        "Translate the selected response into feasible actions and measures.",
      status: "explicit",
      priority: "required",
      evidenceRefs: ["brief-roadmap"],
    },
    {
      id: "lo-communication",
      label: "Communicate an evidence-based recommendation",
      description:
        "Use clear academic English and evidence-linked reasoning.",
      status: "explicit",
      priority: "required",
      evidenceRefs: ["rubric-communication", "brief-evidence"],
    },
  ],
  constraints: [
    {
      id: "constraint-scope",
      label: "One priority process problem",
      description:
        "Keep one main problem and treat other performance measures as causes or guardrails.",
      status: "explicit",
      priority: "required",
      evidenceRefs: ["brief-scope"],
    },
    {
      id: "constraint-evidence",
      label: "External evidence required",
      description:
        "Case evidence alone is insufficient; relevant external evidence must be verified.",
      status: "explicit",
      priority: "required",
      evidenceRefs: ["brief-evidence"],
    },
    {
      id: "constraint-budget",
      label: "Budget and expansion limits are unknown",
      description:
        "Recommendations must label resource assumptions and cannot presume building expansion.",
      status: "explicit",
      priority: "required",
      evidenceRefs: ["case-budget", "brief-integrity"],
    },
    {
      id: "constraint-single-pdf",
      label: "Single PDF submission",
      description: "All required artefacts must be contained in one PDF.",
      status: "explicit",
      priority: "required",
      evidenceRefs: ["brief-deliverable"],
    },
  ],
  rubric: [
    {
      id: "diagnosis",
      name: "Problem diagnosis",
      weight: 20,
      summary:
        "Define a focused process problem and connect performance symptoms to defensible causes.",
      highPerformance: [
        "Defines a defensible process boundary and primary performance gap.",
        "Maps the current process and places baseline evidence at relevant steps.",
        "Connects symptoms, causes and performance trade-offs.",
      ],
      evidenceNeeded: [
        "Current-state process map",
        "Baseline metrics",
        "Bottleneck calculation",
        "Causal chain and scope statement",
      ],
      reportSections: ["Problem scope", "Current-state diagnosis"],
      commonRisks: [
        "Trying to solve waiting, errors and forecasting as separate projects",
        "Treating symptoms as root causes",
        "Omitting the current-state map",
      ],
      evidenceRefs: ["rubric-diagnosis", "brief-scope", "case-capacity"],
    },
    {
      id: "theory",
      name: "Application of operations theory",
      weight: 25,
      summary:
        "Apply suitable operations concepts to the process and evidence rather than defining terms in isolation.",
      highPerformance: [
        "Selects concepts that fit the process problem.",
        "Applies concepts accurately to case data and process steps.",
        "Explains assumptions, limitations and alternative interpretations.",
      ],
      evidenceNeeded: [
        "Capacity and utilisation analysis",
        "Bottleneck or flow analysis",
        "Applied variability, queueing, lean or process-design reasoning",
      ],
      reportSections: ["Analytical framework", "Analysis"],
      commonRisks: [
        "Definition dumping",
        "Using lean as a synonym for efficiency",
        "Ignoring staging capacity while discussing picking capacity",
      ],
      evidenceRefs: ["rubric-theory", "brief-theory", "case-variation"],
    },
    {
      id: "evidence",
      name: "Evidence and analysis",
      weight: 20,
      summary:
        "Integrate case facts and verified external evidence while making assumptions and limitations visible.",
      highPerformance: [
        "Integrates quantitative and qualitative evidence.",
        "Uses credible external sources for material external claims.",
        "Separates facts, interpretations and assumptions.",
      ],
      evidenceNeeded: [
        "Claim-to-source evidence matrix",
        "Correctly labelled case metrics",
        "Verified external claims",
        "Explicit data limitations",
      ],
      reportSections: ["Analysis", "Recommendations", "Limitations"],
      commonRisks: [
        "Unsupported industry claims",
        "Fabricated impact figures",
        "Treating ten sessions as universally representative",
      ],
      evidenceRefs: ["rubric-evidence", "brief-evidence", "brief-integrity"],
    },
    {
      id: "recommendations",
      name: "Quality of recommendations",
      weight: 25,
      summary:
        "Compare feasible options and turn selected root-cause-linked actions into a measurable implementation plan.",
      highPerformance: [
        "Compares two or three root-cause-linked options.",
        "Evaluates impact, feasibility and trade-offs.",
        "Defines owners, sequence, risks, KPIs and a review point.",
      ],
      evidenceNeeded: [
        "Options comparison",
        "Cause-to-action logic",
        "Implementation roadmap",
        "KPI and risk definitions",
      ],
      reportSections: ["Options", "Recommendations", "Implementation"],
      commonRisks: [
        "Generic hire staff or use AI recommendations",
        "Adding capacity at a non-constrained step",
        "Guaranteed benefits without evidence",
      ],
      evidenceRefs: [
        "rubric-recommendations",
        "brief-recommendations",
        "brief-roadmap",
        "case-budget",
      ],
    },
    {
      id: "communication",
      name: "Structure and academic communication",
      weight: 10,
      summary:
        "Present a concise, well-signposted professional report with precise academic language and verified citations.",
      highPerformance: [
        "Uses the required report structure.",
        "Uses precise, readable academic English and clear signposting.",
        "Labels figures and applies Harvard citations consistently.",
      ],
      evidenceNeeded: [
        "Executive summary",
        "Rubric-led headings and word budget",
        "Reference and figure audit",
        "Submission checklist",
      ],
      reportSections: ["Whole report"],
      commonRisks: [
        "Missing executive summary",
        "Vague claims such as very efficient",
        "Key reasoning hidden in an appendix",
      ],
      evidenceRefs: [
        "rubric-communication",
        "brief-deliverable",
        "brief-word-count",
      ],
    },
  ],
  ambiguities: [
    {
      id: "ambiguity-source-count",
      question: "How many external sources, and how recent, are expected?",
      whyItMatters:
        "The brief requires relevant external evidence but gives no count or recency rule.",
      safeWorkingAssumption:
        "Plan for six to eight highly relevant sources, including at least three peer-reviewed sources, and confirm this with the tutor.",
      severity: "high",
      evidenceRefs: ["brief-evidence", "rubric-evidence"],
    },
    {
      id: "ambiguity-feasibility",
      question: "What budget and physical-change limits define feasible?",
      whyItMatters:
        "A credible financial return cannot be guaranteed without a budget or supplier costs.",
      safeWorkingAssumption:
        "Compare low-, medium- and high-resource options and label every cost or impact estimate as an assumption or pilot target.",
      severity: "high",
      evidenceRefs: ["case-budget", "brief-integrity"],
    },
    {
      id: "ambiguity-diagram-count",
      question: "Do labels inside the process map count toward the word limit?",
      whyItMatters:
        "The brief addresses prose in tables but does not explicitly address diagram labels.",
      safeWorkingAssumption:
        "Keep labels concise, retain core reasoning in the report body, and confirm the counting rule with the tutor.",
      severity: "medium",
      evidenceRefs: ["brief-word-count", "brief-deliverable"],
    },
    {
      id: "ambiguity-priority",
      question: "Should waiting, order errors or substitutions be the priority problem?",
      whyItMatters:
        "Treating all three as separate problems would exceed the required scope.",
      safeWorkingAssumption:
        "Use collection waiting as the primary problem and retain error rate as a quality guardrail unless analysis supports another scope.",
      severity: "medium",
      evidenceRefs: ["brief-scope", "case-service", "case-quality"],
    },
    {
      id: "ambiguity-sample",
      question: "How representative are the ten observed peak sessions?",
      whyItMatters:
        "A short observation period should not be treated as a year-round demand pattern.",
      safeWorkingAssumption:
        "Treat the figures as the case baseline and make continued pilot measurement part of implementation.",
      severity: "medium",
      evidenceRefs: ["case-service", "rubric-evidence"],
    },
  ],
  hiddenRequirements: [
    {
      id: "hidden-options",
      label: "Compare alternatives before selecting",
      description:
        "The recommendation rubric expects an options comparison, not a jump from diagnosis to one preferred solution.",
      status: "inferred",
      priority: "required",
      evidenceRefs: ["rubric-recommendations", "brief-recommendations"],
    },
    {
      id: "hidden-tradeoff",
      label: "Protect quality while improving speed",
      description:
        "Waiting-time improvement needs an error-rate guardrail so faster flow does not reduce quality.",
      status: "inferred",
      priority: "required",
      evidenceRefs: ["rubric-diagnosis", "case-quality"],
    },
    {
      id: "hidden-current-map",
      label: "Map the current state, not only the proposed future",
      description:
        "The process map must show evidence and constraints in the existing process.",
      status: "inferred",
      priority: "required",
      evidenceRefs: ["brief-deliverable", "rubric-diagnosis"],
    },
    {
      id: "hidden-word-budget",
      label: "Use rubric weights to budget analysis",
      description:
        "High-weight theory and recommendation criteria need more evidence and space than background description.",
      status: "inferred",
      priority: "recommended",
      evidenceRefs: ["rubric-theory", "rubric-recommendations"],
    },
  ],
  integrityGuidance: [
    {
      id: "integrity-no-fabrication",
      label: "Never fill evidence gaps with invented material",
      description:
        "Do not create interviews, customer comments, operational data, costs, results or references.",
      status: "explicit",
      priority: "required",
      evidenceRefs: ["brief-integrity"],
    },
    {
      id: "integrity-assumptions",
      label: "Label estimates and assumptions",
      description:
        "Convert missing data into an assumption, question or pilot measurement and explain its basis.",
      status: "explicit",
      priority: "required",
      evidenceRefs: ["brief-integrity", "rubric-evidence"],
    },
    {
      id: "integrity-student-authorship",
      label: "Keep the student as author",
      description:
        "RubricTrail can explain, plan, prompt and check, but it must not supply a submission-ready report.",
      status: "explicit",
      priority: "required",
      evidenceRefs: ["brief-ai-policy"],
    },
    {
      id: "integrity-source-check",
      label: "Open and verify every source",
      description:
        "Do not cite an AI output or a source that the student has not personally checked.",
      status: "inferred",
      priority: "required",
      evidenceRefs: ["brief-evidence", "brief-integrity"],
    },
  ],
} satisfies AssignmentAnalysis;

export const SAMPLE_ASSIGNMENT = assignmentAnalysisSchema.parse(
  assignmentCandidate,
);

export const SAMPLE_DRAFT_TEXT = `LumaLane has an operational problem because customers are waiting too long for their click-and-collect orders. The case pack reports an average wait of 11.8 minutes and says that 31% of customers wait longer than 15 minutes. This may also explain why 8.6% abandon their collection. The process therefore needs to become faster and more efficient.

Capacity management and lean operations are useful for understanding the problem. Average demand is 42 orders per hour and picking capacity is 46, so the company appears to have enough pickers. However, staging and handover can process only 34 orders per hour. This suggests that staging may be the bottleneck. Releasing most orders together at 16:15 probably creates congestion as well. Lean identifies waiting as waste, and standardising the process would remove waste.

The first recommendation is to hire more pickers during the evening peak. This would be easy to introduce and would reduce waiting. Second, LumaLane should use AI forecasting and send notifications when orders are ready. Digital systems are used by many retailers because they make operations more efficient. Third, the business should reorganise the staging area so employees can find orders more quickly.

These solutions should reduce waiting by at least 50%, improve customer satisfaction and probably pay for themselves. Implementation could start next month. The store manager should monitor waiting time and make changes if performance does not improve. Overall, using technology and extra staff will make the process leaner and give LumaLane a competitive advantage.`;

function spanFor(fragment: string): DraftSpan {
  const start = SAMPLE_DRAFT_TEXT.indexOf(fragment);
  if (start < 0) {
    throw new Error(`Sample draft fragment was not found: ${fragment}`);
  }
  return { start, end: start + fragment.length, excerpt: fragment };
}

export const SAMPLE_DRAFT = {
  id: "lumalane-draft-v1",
  assignmentId: SAMPLE_ASSIGNMENT.id,
  sectionId: "analysis-recommendations",
  sectionLabel: "Analysis and recommendations",
  text: SAMPLE_DRAFT_TEXT,
} satisfies DraftInput;

export const SAMPLE_DRAFT_CHECK = {
  id: "lumalane-draft-check-v1",
  assignmentId: SAMPLE_ASSIGNMENT.id,
  draftId: SAMPLE_DRAFT.id,
  sectionId: SAMPLE_DRAFT.sectionId,
  coverageEstimate: 46,
  coverageDisclaimer:
    "A deterministic surface-signal heuristic — not semantic evaluation, not a predicted grade, and not a guarantee of performance.",
  criteria: [
    {
      criterionId: "diagnosis",
      coverage: 62,
      status: "partial",
      summary:
        "The draft identifies waiting and a plausible staging constraint but has no explicit process boundary, current-state map or complete causal chain.",
      strengths: [
        "Uses waiting and abandonment metrics to establish a measurable service problem.",
        "Recognises staging capacity as a more plausible constraint than picking capacity.",
      ],
      gaps: [
        "No process boundary or current-state map",
        "No distinction between primary performance goal and quality guardrails",
      ],
      evidenceRefs: ["rubric-diagnosis", "case-capacity", "case-service"],
    },
    {
      criterionId: "theory",
      coverage: 46,
      status: "emerging",
      summary:
        "Capacity and lean are named, but utilisation, variability and theory limitations are not applied in enough depth.",
      strengths: ["Selects concepts that could fit the case"],
      gaps: [
        "Does not calculate staging utilisation",
        "Uses lean mainly as a definition",
        "Does not discuss the limits of average-rate data",
      ],
      evidenceRefs: ["rubric-theory", "brief-theory", "case-variation"],
    },
    {
      criterionId: "evidence",
      coverage: 35,
      status: "emerging",
      summary:
        "Case figures are used accurately, but material external claims and impact estimates are unsupported.",
      strengths: ["Several case metrics are quoted accurately"],
      gaps: [
        "No verified external sources",
        "The 50% reduction is invented",
        "Fact, inference and assumption are not consistently separated",
      ],
      evidenceRefs: ["rubric-evidence", "brief-evidence", "brief-integrity"],
    },
    {
      criterionId: "recommendations",
      coverage: 32,
      status: "emerging",
      summary:
        "Three actions are listed, but they are not compared and two are weakly connected to the diagnosed constraint.",
      strengths: ["Includes more than one possible intervention"],
      gaps: [
        "More pickers do not directly increase staging capacity",
        "AI forecasting is not tied to a defined operational decision",
        "No owners, sequence, resources, risks or review point",
      ],
      evidenceRefs: [
        "rubric-recommendations",
        "case-capacity",
        "case-budget",
      ],
    },
    {
      criterionId: "communication",
      coverage: 66,
      status: "partial",
      summary:
        "The prose is readable and logically ordered, but several claims are vague and the required report structure and citations are absent from this section.",
      strengths: ["Uses clear paragraphs and a visible problem-to-response sequence"],
      gaps: [
        "Vague claims such as more efficient and competitive advantage",
        "No citations or signposted evidence limitations",
      ],
      evidenceRefs: ["rubric-communication", "brief-deliverable"],
    },
  ],
  feedback: [
    {
      id: "feedback-specific-baseline",
      kind: "strength",
      severity: "medium",
      rubricIds: ["diagnosis", "evidence"],
      title: "A measurable service problem is established",
      explanation:
        "The draft uses wait and abandonment figures instead of relying only on a general statement that service is poor.",
      draftEvidence: [
        spanFor(
          "an average wait of 11.8 minutes and says that 31% of customers wait longer than 15 minutes",
        ),
      ],
      sourceEvidenceRefs: ["case-service", "rubric-diagnosis"],
      successCheck:
        "Keep these baseline figures and place them at the relevant process step.",
    },
    {
      id: "feedback-bottleneck",
      kind: "strength",
      severity: "medium",
      rubricIds: ["diagnosis", "theory"],
      title: "The likely constrained step is noticed",
      explanation:
        "Recognising the 34-order staging and handover capacity is more diagnostic than comparing demand only with picking capacity.",
      draftEvidence: [
        spanFor("staging and handover can process only 34 orders per hour"),
      ],
      sourceEvidenceRefs: ["case-capacity", "rubric-theory"],
      successCheck:
        "Show how this step sits inside the mapped process and test whether the rate definitions are comparable.",
    },
    {
      id: "feedback-batch-hypothesis",
      kind: "strength",
      severity: "low",
      rubricIds: ["diagnosis", "theory"],
      title: "A testable batching hypothesis is formed",
      explanation:
        "The cautious word probably correctly marks a process interpretation rather than a confirmed fact.",
      draftEvidence: [
        spanFor(
          "Releasing most orders together at 16:15 probably creates congestion as well.",
        ),
      ],
      sourceEvidenceRefs: ["case-batch-release", "rubric-diagnosis"],
      action:
        "Use the process map and variability evidence to test this causal hypothesis.",
    },
    {
      id: "feedback-utilisation",
      kind: "issue",
      severity: "high",
      rubricIds: ["diagnosis", "theory"],
      title: "Complete the capacity calculation",
      explanation:
        "At the stated average rates, staging utilisation is 42 ÷ 34 ≈ 124%. If the measures are comparable and sustained, backlog is structurally likely; the draft currently stops at may be the bottleneck.",
      draftEvidence: [
        spanFor("This suggests that staging may be the bottleneck."),
      ],
      sourceEvidenceRefs: ["case-capacity", "rubric-theory"],
      action:
        "Show the calculation, state its assumptions, and connect the result to wait and abandonment.",
      successCheck:
        "A reader can see why staging, rather than picking, is the primary constraint.",
      guidance: {
        kind: "question",
        text: "What does demand ÷ staging capacity imply, and when would that inference be unsafe?",
      },
    },
    {
      id: "feedback-picker-mismatch",
      kind: "issue",
      severity: "high",
      rubricIds: ["recommendations", "diagnosis"],
      title: "The first recommendation misses the diagnosed constraint",
      explanation:
        "Picking capacity already exceeds average incoming demand, while staging and handover capacity does not. More pickers could increase congestion unless peak variability shows another constraint.",
      draftEvidence: [spanFor("hire more pickers during the evening peak")],
      sourceEvidenceRefs: ["case-capacity", "rubric-recommendations"],
      action:
        "Test every recommendation against the cause-to-action chain and retain extra picking capacity only if evidence justifies it.",
      successCheck:
        "Each action changes a diagnosed cause or is explicitly framed as a guarded pilot.",
      guidance: {
        kind: "question",
        text: "Which constrained process step becomes faster because of this action?",
      },
    },
    {
      id: "feedback-invented-impact",
      kind: "evidence_gap",
      severity: "high",
      rubricIds: ["evidence", "recommendations"],
      title: "The 50% improvement is unsupported",
      explanation:
        "The case contains no experiment, model or verified benchmark that supports a 50% reduction, so this number cannot be presented as an expected result.",
      draftEvidence: [spanFor("reduce waiting by at least 50%")],
      sourceEvidenceRefs: ["brief-integrity", "rubric-evidence"],
      action:
        "Remove the number, derive a defensible scenario with assumptions, or define it as a target to test in a pilot.",
      successCheck:
        "Every impact figure has a source, calculation or explicit scenario label.",
    },
    {
      id: "feedback-ai-solution",
      kind: "issue",
      severity: "high",
      rubricIds: ["recommendations", "theory"],
      title: "AI forecasting is solution-first",
      explanation:
        "The draft does not state which operational decision would use a forecast, what data exists, or how forecasting relieves staging congestion and batch release.",
      draftEvidence: [spanFor("use AI forecasting")],
      sourceEvidenceRefs: ["rubric-recommendations", "case-batch-release"],
      action:
        "Define the operational decision first and compare a simple release rule with a forecasting tool before selecting technology.",
      successCheck:
        "The recommendation names the decision, user, input, expected mechanism and fallback.",
    },
    {
      id: "feedback-external-claim",
      kind: "evidence_gap",
      severity: "high",
      rubricIds: ["evidence", "communication"],
      title: "A broad industry claim needs verification",
      explanation:
        "The sentence gives no source, defined mechanism or boundary and therefore cannot support the recommendation as written.",
      draftEvidence: [
        spanFor(
          "Digital systems are used by many retailers because they make operations more efficient.",
        ),
      ],
      sourceEvidenceRefs: ["brief-evidence", "rubric-evidence"],
      action:
        "Add the claim to an evidence matrix; narrow or remove it if no credible source is found.",
      successCheck:
        "The final wording identifies the mechanism and includes a personally verified source.",
    },
    {
      id: "feedback-lean-application",
      kind: "issue",
      severity: "medium",
      rubricIds: ["theory", "diagnosis"],
      title: "Lean is defined rather than applied",
      explanation:
        "Naming waiting as waste does not yet identify where waiting, motion or rework occurs or how a proposed change removes it.",
      draftEvidence: [spanFor("Lean identifies waiting as waste")],
      sourceEvidenceRefs: ["brief-theory", "rubric-theory"],
      action:
        "Annotate concrete waiting, searching and rework on the current-state map, then connect one action to each relevant waste.",
      successCheck:
        "Each lean concept points to a visible process step and evidence.",
    },
    {
      id: "feedback-roadmap",
      kind: "issue",
      severity: "medium",
      rubricIds: ["recommendations", "communication"],
      title: "Implementation is not yet actionable",
      explanation:
        "Starting next month does not define sequence, action owners, resources, risks, baseline, pilot duration or a review trigger.",
      draftEvidence: [spanFor("Implementation could start next month.")],
      sourceEvidenceRefs: ["brief-roadmap", "rubric-recommendations"],
      action:
        "Create a one-page pilot roadmap with owner, sequence, resource assumption, KPI, guardrail, risk and review point.",
      successCheck:
        "Another person could run and evaluate the pilot without guessing the next step.",
    },
    {
      id: "feedback-reasoning-stem",
      kind: "next_action",
      severity: "medium",
      rubricIds: ["theory", "evidence"],
      title: "Make the evidence-to-interpretation step visible",
      explanation:
        "A short reasoning frame can help separate case fact, interpretation, theoretical mechanism and missing evidence without writing the report for the student.",
      draftEvidence: [],
      sourceEvidenceRefs: ["rubric-theory", "rubric-evidence"],
      action: "Use the frame for each major analytical claim.",
      guidance: {
        kind: "sentence_stem",
        text: "The case pack reports ____. This suggests ____ when interpreted through ____. To test this interpretation, the report would need ____.",
      },
    },
  ],
  nextActions: [
    {
      id: "next-capacity",
      text: "Calculate and caveat staging utilisation, then annotate it on the process map.",
      priority: "high",
      estimatedMinutes: 20,
      rubricIds: ["diagnosis", "theory"],
    },
    {
      id: "next-logic",
      text: "Rebuild each recommendation as cause → action → trade-off → KPI.",
      priority: "high",
      estimatedMinutes: 30,
      rubricIds: ["recommendations"],
    },
    {
      id: "next-evidence-matrix",
      text: "Create a claim-to-evidence matrix and personally verify external sources.",
      priority: "high",
      estimatedMinutes: 45,
      rubricIds: ["evidence"],
    },
    {
      id: "next-roadmap",
      text: "Add a pilot roadmap with owners, baseline, risks, guardrails and review point.",
      priority: "medium",
      estimatedMinutes: 25,
      rubricIds: ["recommendations", "communication"],
    },
    {
      id: "next-language",
      text: "Run a vague-language, integrity and citation audit.",
      priority: "medium",
      estimatedMinutes: 15,
      rubricIds: ["communication", "evidence"],
    },
  ],
} satisfies DraftCheckResult;

export const SAMPLE_FIXTURE = rubricTrailFixtureSchema.parse({
  assignment: SAMPLE_ASSIGNMENT,
  draft: SAMPLE_DRAFT,
  draftCheck: SAMPLE_DRAFT_CHECK,
});

export const SAMPLE_SECTION_OPTIONS = [
  { id: "executive-summary", label: "Executive summary" },
  { id: "problem-scope", label: "Problem scope" },
  { id: "analysis-recommendations", label: "Analysis and recommendations" },
  { id: "implementation", label: "Implementation" },
  { id: "conclusion", label: "Conclusion" },
] as const;
