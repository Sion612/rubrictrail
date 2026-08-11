import {
  actionPlanSchema,
  planGenerationInputSchema,
  planTaskTemplateSchema,
  type ActionPlan,
  type CriterionProgress,
  type PlanningDepth,
  type ParsedPlanGenerationInput,
  type PlanGenerationInput,
  type PlanTask,
  type PlanTaskTemplate,
} from "./domain";

const DAY_IN_MILLISECONDS = 86_400_000;
const MAX_SCHEDULING_DAYS = 1_500;

const templateCandidates = [
  {
    id: "p1",
    phase: "Understand",
    title: "Decode the brief and tag evidence",
    description:
      "Turn every explicit requirement into a source-linked item before starting analysis.",
    priority: "high",
    baseMinutes: 45,
    dependencies: [],
    doneDefinition: [
      "Every explicit requirement has an evidence reference",
      "Deadline, word limit, deliverables and citation style are confirmed",
    ],
    rubricLinks: [
      { criterionId: "diagnosis", contribution: 0.2 },
      { criterionId: "theory", contribution: 0.15 },
      { criterionId: "evidence", contribution: 0.3 },
      { criterionId: "recommendations", contribution: 0.15 },
      { criterionId: "communication", contribution: 0.2 },
    ],
  },
  {
    id: "p2",
    phase: "Understand",
    title: "Build an ambiguity and question log",
    description:
      "Separate unresolved instructions from safe working assumptions and tutor questions.",
    priority: "high",
    baseMinutes: 30,
    dependencies: ["p1"],
    doneDefinition: [
      "Each ambiguity has a working assumption or a question to confirm",
      "No assumption is presented as a brief requirement",
    ],
    rubricLinks: [
      { criterionId: "evidence", contribution: 0.6 },
      { criterionId: "communication", contribution: 0.4 },
    ],
  },
  {
    id: "p3",
    phase: "Frame",
    title: "Choose the process scope and success measures",
    description:
      "Define one priority process problem, its boundary, primary KPI and quality guardrails.",
    priority: "high",
    baseMinutes: 45,
    dependencies: ["p1", "p2"],
    doneDefinition: [
      "The scope fits in one sentence",
      "One primary KPI and at least one guardrail are defined",
    ],
    rubricLinks: [
      { criterionId: "diagnosis", contribution: 0.8 },
      { criterionId: "communication", contribution: 0.2 },
    ],
  },
  {
    id: "p4",
    phase: "Diagnose",
    title: "Map the current process and calculate the baseline",
    description:
      "Map order release through handover and place case metrics at the relevant steps.",
    priority: "high",
    baseMinutes: 90,
    dependencies: ["p3"],
    doneDefinition: [
      "Current-state map covers the selected boundary",
      "Baseline speed, capacity and quality evidence appears at the relevant steps",
    ],
    rubricLinks: [
      { criterionId: "diagnosis", contribution: 0.6 },
      { criterionId: "evidence", contribution: 0.4 },
    ],
  },
  {
    id: "p10",
    phase: "Frame",
    title: "Create a rubric-led outline and word budget",
    description:
      "Map report sections to rubric criteria so high-weight analysis receives sufficient space.",
    priority: "medium",
    baseMinutes: 45,
    dependencies: ["p3"],
    doneDefinition: [
      "Every required report section is present",
      "The word budget broadly follows rubric weighting",
    ],
    rubricLinks: [
      { criterionId: "diagnosis", contribution: 0.15 },
      { criterionId: "theory", contribution: 0.2 },
      { criterionId: "evidence", contribution: 0.15 },
      { criterionId: "recommendations", contribution: 0.2 },
      { criterionId: "communication", contribution: 0.3 },
    ],
  },
  {
    id: "p5",
    phase: "Diagnose",
    title: "Apply capacity, bottleneck and flow concepts",
    description:
      "Use at least two operations concepts to explain the process evidence and its limitations.",
    priority: "high",
    baseMinutes: 120,
    dependencies: ["p4"],
    doneDefinition: [
      "At least two concepts are applied to case evidence",
      "Calculations and assumptions can be checked",
      "At least one limitation or alternative interpretation is noted",
    ],
    rubricLinks: [
      { criterionId: "theory", contribution: 0.65 },
      { criterionId: "diagnosis", contribution: 0.15 },
      { criterionId: "evidence", contribution: 0.2 },
    ],
  },
  {
    id: "p6",
    phase: "Research",
    title: "Build the external evidence matrix",
    description:
      "Track every material external claim to a personally verified academic or professional source.",
    priority: "high",
    baseMinutes: 120,
    dependencies: ["p3"],
    doneDefinition: [
      "Every material external claim has a verified source or is removed",
      "Case facts, external evidence and assumptions are visibly separated",
    ],
    rubricLinks: [
      { criterionId: "evidence", contribution: 0.75 },
      { criterionId: "theory", contribution: 0.25 },
    ],
  },
  {
    id: "p7",
    phase: "Design",
    title: "Compare improvement options and trade-offs",
    description:
      "Compare alternatives on causal fit, impact, feasibility, resources and operational risks.",
    priority: "high",
    baseMinutes: 75,
    dependencies: ["p5", "p6"],
    doneDefinition: [
      "At least three options are compared on consistent dimensions",
      "Speed, quality, dependability and cost trade-offs are visible",
    ],
    rubricLinks: [
      { criterionId: "recommendations", contribution: 0.7 },
      { criterionId: "theory", contribution: 0.2 },
      { criterionId: "evidence", contribution: 0.1 },
    ],
  },
  {
    id: "p8",
    phase: "Design",
    title: "Select and justify two or three recommendations",
    description:
      "Link each selected action to a diagnosed cause and state the evidence and assumptions behind it.",
    priority: "high",
    baseMinutes: 90,
    dependencies: ["p7"],
    doneDefinition: [
      "Each recommendation changes a diagnosed cause",
      "Selection logic and rejected alternatives are explained",
      "Impact estimates are sourced, calculated or labelled as scenarios",
    ],
    rubricLinks: [
      { criterionId: "recommendations", contribution: 0.75 },
      { criterionId: "evidence", contribution: 0.25 },
    ],
  },
  {
    id: "p9",
    phase: "Design",
    title: "Build the owner and KPI implementation roadmap",
    description:
      "Turn recommendations into a sequenced, measurable pilot with risks and a review trigger.",
    priority: "high",
    baseMinutes: 75,
    dependencies: ["p8"],
    doneDefinition: [
      "Each action has an owner and sequence",
      "Resource assumptions, risks, KPI, guardrail and review point are complete",
      "The roadmap fits on one page",
    ],
    rubricLinks: [
      { criterionId: "recommendations", contribution: 0.8 },
      { criterionId: "communication", contribution: 0.2 },
    ],
  },
  {
    id: "p11",
    phase: "Write",
    title: "Draft the report in the student’s own words",
    description:
      "Produce the complete first draft using the evidence map, analysis and selected response.",
    priority: "high",
    baseMinutes: 240,
    dependencies: ["p5", "p6", "p8", "p9", "p10"],
    doneDefinition: [
      "The full required structure has a first draft",
      "Facts, external evidence and assumptions are distinguishable",
      "The process map and roadmap are referenced from the argument",
    ],
    rubricLinks: [
      { criterionId: "diagnosis", contribution: 0.15 },
      { criterionId: "theory", contribution: 0.2 },
      { criterionId: "evidence", contribution: 0.2 },
      { criterionId: "recommendations", contribution: 0.25 },
      { criterionId: "communication", contribution: 0.2 },
    ],
  },
  {
    id: "p12",
    phase: "Review",
    title: "Run a rubric and evidence audit",
    description:
      "Check that every criterion has visible evidence and every material claim can be verified.",
    priority: "high",
    baseMinutes: 90,
    dependencies: ["p11"],
    doneDefinition: [
      "Every rubric criterion has visible supporting work",
      "Unsupported claims are sourced, qualified or removed",
      "Recommendations still follow from the final diagnosis",
    ],
    rubricLinks: [
      { criterionId: "diagnosis", contribution: 0.15 },
      { criterionId: "theory", contribution: 0.2 },
      { criterionId: "evidence", contribution: 0.25 },
      { criterionId: "recommendations", contribution: 0.25 },
      { criterionId: "communication", contribution: 0.15 },
    ],
  },
  {
    id: "p13",
    phase: "Submit",
    title: "Complete integrity, references and submission QA",
    description:
      "Perform the final word-count, reference, figure, integrity and PDF checks without changing the student’s argument.",
    priority: "high",
    baseMinutes: 60,
    dependencies: ["p12"],
    doneDefinition: [
      "Word count and all required artefacts pass the checklist",
      "Every citation and reference pair is verified",
      "Permitted AI use is declared and the PDF opens correctly",
    ],
    rubricLinks: [
      { criterionId: "evidence", contribution: 0.35 },
      { criterionId: "communication", contribution: 0.65 },
    ],
  },
  {
    id: "s1",
    phase: "Review",
    title: "Run a claim-to-source and language precision pass",
    description:
      "Replace vague claims with bounded, evidence-linked language and verify source use.",
    priority: "medium",
    baseMinutes: 45,
    minPlanningDepth: "standard",
    dependencies: ["p12"],
    doneDefinition: [
      "Vague terms have a metric, source or qualification",
      "Every source is used for the claim it actually supports",
    ],
    rubricLinks: [
      { criterionId: "evidence", contribution: 0.45 },
      { criterionId: "communication", contribution: 0.55 },
    ],
  },
  {
    id: "s2",
    phase: "Review",
    title: "Test theory limitations and alternative explanations",
    description:
      "Stress-test whether the selected concepts and diagnosis remain defensible under data limitations.",
    priority: "medium",
    baseMinutes: 60,
    minPlanningDepth: "thorough",
    dependencies: ["p12"],
    doneDefinition: [
      "At least one alternative explanation is tested",
      "Concept limitations are applied to this case rather than listed generically",
    ],
    rubricLinks: [
      { criterionId: "theory", contribution: 0.65 },
      { criterionId: "evidence", contribution: 0.35 },
    ],
  },
  {
    id: "s3",
    phase: "Review",
    title: "Stress-test recommendations with sensitivity and counterarguments",
    description:
      "Test whether recommendations remain sensible if demand, capacity or resource assumptions change.",
    priority: "medium",
    baseMinutes: 75,
    minPlanningDepth: "extended",
    dependencies: ["p9", "p12"],
    doneDefinition: [
      "At least two key assumptions are varied",
      "A credible counterargument and response are addressed",
      "The pilot includes a stop or review rule",
    ],
    rubricLinks: [
      { criterionId: "recommendations", contribution: 0.6 },
      { criterionId: "evidence", contribution: 0.25 },
      { criterionId: "theory", contribution: 0.15 },
    ],
  },
] satisfies PlanTaskTemplate[];

export const DEFAULT_PLAN_TASK_TEMPLATES = templateCandidates.map((template) =>
  planTaskTemplateSchema.parse(template),
);

export const DEFAULT_PLAN_INPUT = {
  weeklyHours: 10,
  planningDepth: "standard",
  startDate: "2026-07-20",
  dueDate: "2026-08-07",
  asOfDate: "2026-07-20",
  completedTaskIds: [],
} satisfies PlanGenerationInput;

function parseDateOnly(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function formatDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function addDays(value: string, amount: number): string {
  const date = parseDateOnly(value);
  date.setUTCDate(date.getUTCDate() + amount);
  return formatDateOnly(date);
}

function laterDate(left: string, right: string): string {
  return left >= right ? left : right;
}

function dayWeight(value: string): number {
  const day = parseDateOnly(value).getUTCDay();
  if (day === 0) return 0;
  if (day === 6) return 0.5;
  return 1;
}

function capacityForDay(weeklyHours: number, value: string): number {
  return (weeklyHours * 60 * dayWeight(value)) / 5.5;
}

export const PLANNING_DEPTH_OPTIONS = [
  {
    value: "focused",
    label: "Focused",
    description: "A lean pass through the essential evidence and submission checks.",
    effortFactor: 0.85,
    legacyTargetGrade: 60,
  },
  {
    value: "standard",
    label: "Standard",
    description: "A balanced plan with a source-and-language review pass.",
    effortFactor: 1,
    legacyTargetGrade: 70,
  },
  {
    value: "thorough",
    label: "Thorough",
    description: "More time for limitations, alternatives and deeper review.",
    effortFactor: 1.2,
    legacyTargetGrade: 75,
  },
  {
    value: "extended",
    label: "Extended",
    description: "The widest review scope, including sensitivity and counterargument checks.",
    // v0.3.4's highest visible option used the same 1.2 multiplier as 75,
    // while adding the final review gate. Keep that operational behaviour so
    // state-v3 values do not change the generated plan after the copy fix.
    effortFactor: 1.2,
    legacyTargetGrade: 80,
  },
] as const satisfies readonly {
  value: PlanningDepth;
  label: string;
  description: string;
  effortFactor: number;
  legacyTargetGrade: number;
}[];

const planningDepthRank = new Map(
  PLANNING_DEPTH_OPTIONS.map((option, index) => [option.value, index]),
);

export function getPlanningDepthEffortFactor(planningDepth: PlanningDepth): number {
  return (
    PLANNING_DEPTH_OPTIONS.find((option) => option.value === planningDepth)
      ?.effortFactor ?? 1
  );
}

export function planningDepthFromLegacyTargetGrade(targetGrade: number): PlanningDepth {
  if (targetGrade < 65) return "focused";
  if (targetGrade < 75) return "standard";
  if (targetGrade < 80) return "thorough";
  return "extended";
}

export function legacyTargetGradeForPlanningDepth(planningDepth: PlanningDepth): number {
  return (
    PLANNING_DEPTH_OPTIONS.find((option) => option.value === planningDepth)
      ?.legacyTargetGrade ?? 70
  );
}

function includesPlanningDepth(
  selected: PlanningDepth,
  minimum: PlanningDepth | undefined,
): boolean {
  if (!minimum) return true;
  return (planningDepthRank.get(selected) ?? 0) >= (planningDepthRank.get(minimum) ?? 0);
}

function roundUpToQuarterHour(minutes: number): number {
  return Math.ceil(minutes / 15) * 15;
}

export function calculateAvailableMinutes(
  weeklyHours: number,
  fromDate: string,
  throughDate: string,
): number {
  if (fromDate > throughDate) return 0;
  let current = fromDate;
  let total = 0;
  let inspectedDays = 0;
  while (current <= throughDate) {
    total += capacityForDay(weeklyHours, current);
    current = addDays(current, 1);
    inspectedDays += 1;
    if (inspectedDays > MAX_SCHEDULING_DAYS) {
      throw new Error("Plan date range exceeds the supported scheduling window");
    }
  }
  return total;
}

function topologicalOrder(templates: PlanTaskTemplate[]): PlanTaskTemplate[] {
  const templateById = new Map(templates.map((template) => [template.id, template]));
  const order: PlanTaskTemplate[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (template: PlanTaskTemplate) => {
    if (visited.has(template.id)) return;
    if (visiting.has(template.id)) {
      throw new Error(`Cyclic plan task dependency at ${template.id}`);
    }
    visiting.add(template.id);
    template.dependencies.forEach((dependencyId) => {
      const dependency = templateById.get(dependencyId);
      if (!dependency) {
        throw new Error(
          `Task ${template.id} depends on unknown task ${dependencyId}`,
        );
      }
      visit(dependency);
    });
    visiting.delete(template.id);
    visited.add(template.id);
    order.push(template);
  };

  templates.forEach(visit);
  return order;
}

function scheduleTask(
  minutes: number,
  weeklyHours: number,
  earliestDate: string,
  usedCapacity: Map<string, number>,
): { startDate: string; dueDate: string } {
  let remaining = minutes;
  let current = earliestDate;
  let startDate: string | undefined;
  let inspectedDays = 0;

  while (remaining > 0.0001) {
    const dailyCapacity = capacityForDay(weeklyHours, current);
    const used = usedCapacity.get(current) ?? 0;
    const available = Math.max(0, dailyCapacity - used);

    if (available > 0.0001) {
      startDate ??= current;
      const allocated = Math.min(available, remaining);
      usedCapacity.set(current, used + allocated);
      remaining -= allocated;
      if (remaining <= 0.0001) {
        return { startDate, dueDate: current };
      }
    }

    current = addDays(current, 1);
    inspectedDays += 1;
    if (inspectedDays > MAX_SCHEDULING_DAYS) {
      throw new Error("Unable to schedule plan inside the supported window");
    }
  }

  return { startDate: startDate ?? earliestDate, dueDate: current };
}

function buildRubricProgress(tasks: PlanTask[]): CriterionProgress[] {
  const progress = new Map<
    string,
    { completedMinutes: number; totalMinutes: number }
  >();

  tasks.forEach((task) => {
    task.rubricLinks.forEach((link) => {
      const current = progress.get(link.criterionId) ?? {
        completedMinutes: 0,
        totalMinutes: 0,
      };
      const linkedMinutes = task.adjustedMinutes * link.contribution;
      current.totalMinutes += linkedMinutes;
      if (task.completed) current.completedMinutes += linkedMinutes;
      progress.set(link.criterionId, current);
    });
  });

  return [...progress.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([criterionId, value]) => ({
      criterionId,
      completedMinutes: Math.round(value.completedMinutes),
      totalMinutes: Math.round(value.totalMinutes),
      percent:
        value.totalMinutes === 0
          ? 0
          : Math.round((value.completedMinutes / value.totalMinutes) * 100),
    }));
}

function buildCapacityRisk(
  input: ParsedPlanGenerationInput,
  remainingMinutes: number,
  scheduleStart: string,
) {
  if (remainingMinutes === 0) return null;

  const availableMinutes = calculateAvailableMinutes(
    input.weeklyHours,
    scheduleStart,
    input.dueDate,
  );
  const shortfallMinutes = Math.max(0, remainingMinutes - availableMinutes);
  const deadlinePassed = scheduleStart > input.dueDate;
  if (shortfallMinutes <= 0.0001 && !deadlinePassed) return null;

  const capacityPerWeeklyHour = calculateAvailableMinutes(
    1,
    scheduleStart,
    input.dueDate,
  );
  const requiredWeeklyHours =
    capacityPerWeeklyHour > 0
      ? Math.ceil((remainingMinutes / capacityPerWeeklyHour) * 2) / 2
      : 0;
  const roundedShortfall = Math.ceil(shortfallMinutes);

  return {
    remainingMinutes,
    availableMinutes: Math.floor(availableMinutes),
    shortfallMinutes: roundedShortfall,
    requiredWeeklyHours,
    deadlinePassed,
    message: deadlinePassed
      ? `The deadline has passed with ${Math.ceil(remainingMinutes / 60)} hours of work remaining.`
      : `The plan is ${Math.ceil(roundedShortfall / 60)} hours over available capacity. Increase to about ${requiredWeeklyHours} hours per week or narrow the scope.`,
  };
}

export function generateActionPlan(
  rawInput: PlanGenerationInput,
  templates: readonly PlanTaskTemplate[] = DEFAULT_PLAN_TASK_TEMPLATES,
): ActionPlan {
  const input = planGenerationInputSchema.parse(rawInput);
  const parsedTemplates = templates.map((template) =>
    planTaskTemplateSchema.parse(template),
  );
  const knownTemplateIds = new Set(parsedTemplates.map((template) => template.id));
  const requestedCompletedIds = new Set(
    input.completedTaskIds.filter((id) => knownTemplateIds.has(id)),
  );
  const initiallyActiveTemplates = parsedTemplates.filter(
    (template) =>
      includesPlanningDepth(input.planningDepth, template.minPlanningDepth) ||
      requestedCompletedIds.has(template.id),
  );
  const activeQualityGateIds = initiallyActiveTemplates
    .filter((template) => template.id.startsWith("s"))
    .map((template) => template.id);
  const activeTemplates = initiallyActiveTemplates.map((template) =>
    template.id === "p13"
      ? {
          ...template,
          dependencies: [
            ...new Set([...template.dependencies, ...activeQualityGateIds]),
          ],
        }
      : template,
  );
  const activeIds = new Set(activeTemplates.map((template) => template.id));
  const orderedTemplates = topologicalOrder(activeTemplates);
  const completedIds = new Set<string>();
  for (const template of orderedTemplates) {
    const activeDependencies = template.dependencies.filter((id) =>
      activeIds.has(id),
    );
    if (
      requestedCompletedIds.has(template.id) &&
      activeDependencies.every((id) => completedIds.has(id))
    ) {
      completedIds.add(template.id);
    }
  }
  const effortFactor = getPlanningDepthEffortFactor(input.planningDepth);
  const asOfDate = input.asOfDate ?? input.startDate;
  const scheduleStart = laterDate(input.startDate, asOfDate);
  const dueDateById = new Map<string, string>();
  const usedCapacity = new Map<string, number>();
  let cursor = scheduleStart;

  const tasks = orderedTemplates.map((template): PlanTask => {
    const adjustedMinutes = roundUpToQuarterHour(
      template.baseMinutes * effortFactor,
    );
    const completed = completedIds.has(template.id);
    const dependencies = template.dependencies.filter((id) => activeIds.has(id));
    const dependencyDate = dependencies.reduce(
      (latest, dependencyId) =>
        laterDate(latest, dueDateById.get(dependencyId) ?? scheduleStart),
      scheduleStart,
    );

    let scheduledStartDate = asOfDate;
    let taskDueDate = asOfDate;
    if (!completed) {
      const earliestDate = laterDate(cursor, dependencyDate);
      const scheduled = scheduleTask(
        adjustedMinutes,
        input.weeklyHours,
        earliestDate,
        usedCapacity,
      );
      scheduledStartDate = scheduled.startDate;
      taskDueDate = scheduled.dueDate;
      cursor = taskDueDate;
    }
    dueDateById.set(template.id, taskDueDate);

    return {
      ...template,
      dependencies,
      adjustedMinutes,
      scheduledStartDate,
      dueDate: taskDueDate,
      completed,
      late: !completed && taskDueDate > input.dueDate,
    };
  });

  const totalMinutes = tasks.reduce(
    (total, task) => total + task.adjustedMinutes,
    0,
  );
  const completedMinutes = tasks.reduce(
    (total, task) => total + (task.completed ? task.adjustedMinutes : 0),
    0,
  );
  const remainingMinutes = totalMinutes - completedMinutes;
  const pendingTasks = tasks.filter((task) => !task.completed);
  const projectedFinishDate =
    pendingTasks.at(-1)?.dueDate ?? laterDate(input.startDate, asOfDate);
  const capacityRisk = buildCapacityRisk(input, remainingMinutes, scheduleStart);

  return actionPlanSchema.parse({
    profile: {
      weeklyHours: input.weeklyHours,
      planningDepth: input.planningDepth,
      startDate: input.startDate,
      dueDate: input.dueDate,
      asOfDate,
    },
    tasks,
    totalMinutes,
    remainingMinutes,
    completionPercent:
      totalMinutes === 0 ? 0 : Math.round((completedMinutes / totalMinutes) * 100),
    projectedFinishDate,
    status: capacityRisk ? "at_risk" : "on_track",
    capacityRisk,
    rubricProgress: buildRubricProgress(tasks),
  });
}

export type PlanRebalanceOverrides = Partial<
  Pick<
    PlanGenerationInput,
    "weeklyHours" | "planningDepth" | "startDate" | "dueDate" | "asOfDate"
  >
> & {
  completedTaskIds?: string[];
};

export function rebalanceActionPlan(
  existingPlan: ActionPlan,
  overrides: PlanRebalanceOverrides,
  templates: readonly PlanTaskTemplate[] = DEFAULT_PLAN_TASK_TEMPLATES,
): ActionPlan {
  return generateActionPlan(
    {
      weeklyHours: overrides.weeklyHours ?? existingPlan.profile.weeklyHours,
      planningDepth:
        overrides.planningDepth ?? existingPlan.profile.planningDepth,
      startDate: overrides.startDate ?? existingPlan.profile.startDate,
      dueDate: overrides.dueDate ?? existingPlan.profile.dueDate,
      asOfDate: overrides.asOfDate ?? existingPlan.profile.asOfDate,
      completedTaskIds:
        overrides.completedTaskIds ??
        existingPlan.tasks.filter((task) => task.completed).map((task) => task.id),
    },
    templates,
  );
}

export const generatePlan = generateActionPlan;
export const rebalancePlan = rebalanceActionPlan;

export function daysBetween(startDate: string, endDate: string): number {
  return Math.round(
    (parseDateOnly(endDate).getTime() - parseDateOnly(startDate).getTime()) /
      DAY_IN_MILLISECONDS,
  );
}
