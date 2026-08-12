import { z } from "zod";

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!DATE_ONLY_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export const dateOnlySchema = z
  .string()
  .refine(isRealDate, "Expected a real calendar date in YYYY-MM-DD format");

export const sourceDocumentSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    kind: z.enum(["brief", "rubric", "case", "student_draft"]),
    mimeType: z.string().min(1),
    content: z.string().min(1),
  })
  .strict();

export const evidenceRefSchema = z
  .object({
    id: z.string().min(1),
    documentId: z.string().min(1),
    locator: z
      .object({
        page: z.number().int().positive().optional(),
        section: z.string().min(1).optional(),
        paragraph: z.number().int().positive().optional(),
      })
      .strict(),
    excerpt: z.string().min(1).max(700),
  })
  .strict();

export const linkedRequirementSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1),
    status: z.enum(["explicit", "inferred", "ambiguous"]),
    priority: z.enum(["required", "recommended", "advisory"]),
    evidenceRefs: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const ambiguitySchema = z
  .object({
    id: z.string().min(1),
    question: z.string().min(1),
    whyItMatters: z.string().min(1),
    safeWorkingAssumption: z.string().min(1),
    severity: z.enum(["high", "medium", "low"]),
    evidenceRefs: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const rubricCriterionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    weight: z.number().positive().max(100),
    summary: z.string().min(1),
    highPerformance: z.array(z.string().min(1)).min(1),
    evidenceNeeded: z.array(z.string().min(1)).min(1),
    reportSections: z.array(z.string().min(1)).min(1),
    commonRisks: z.array(z.string().min(1)).min(1),
    evidenceRefs: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const assignmentAnalysisSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    course: z.string().min(1),
    subject: z.string().min(1),
    assignmentType: z.string().min(1),
    dueAt: z.string().datetime({ offset: true }),
    timezone: z.string().min(1),
    wordCount: z
      .object({
        target: z.number().int().positive(),
        tolerancePercent: z.number().min(0).max(100),
        includes: z.array(z.string().min(1)),
        excludes: z.array(z.string().min(1)),
      })
      .strict(),
    citationStyle: z.string().min(1),
    executiveSummary: z.string().min(1),
    sourceDocuments: z.array(sourceDocumentSchema).min(1),
    evidence: z.array(evidenceRefSchema).min(1),
    deliverables: z.array(linkedRequirementSchema).min(1),
    learningObjectives: z.array(linkedRequirementSchema).min(1),
    constraints: z.array(linkedRequirementSchema).min(1),
    rubric: z.array(rubricCriterionSchema).min(1),
    ambiguities: z.array(ambiguitySchema),
    hiddenRequirements: z.array(linkedRequirementSchema),
    integrityGuidance: z.array(linkedRequirementSchema).min(1),
  })
  .strict()
  .superRefine((analysis, context) => {
    const documentIds = new Set<string>();
    analysis.sourceDocuments.forEach((document, index) => {
      if (documentIds.has(document.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate source document id: ${document.id}`,
          path: ["sourceDocuments", index, "id"],
        });
      }
      documentIds.add(document.id);
    });

    const evidenceIds = new Set<string>();
    analysis.evidence.forEach((evidence, index) => {
      if (evidenceIds.has(evidence.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate evidence id: ${evidence.id}`,
          path: ["evidence", index, "id"],
        });
      }
      if (!documentIds.has(evidence.documentId)) {
        context.addIssue({
          code: "custom",
          message: `Unknown source document: ${evidence.documentId}`,
          path: ["evidence", index, "documentId"],
        });
      }
      const sourceDocument = analysis.sourceDocuments.find(
        (document) => document.id === evidence.documentId,
      );
      if (sourceDocument && !sourceDocument.content.includes(evidence.excerpt)) {
        context.addIssue({
          code: "custom",
          message: "Evidence excerpt does not occur in the source document",
          path: ["evidence", index, "excerpt"],
        });
      }
      evidenceIds.add(evidence.id);
    });

    const linkedCollections = [
      ["deliverables", analysis.deliverables],
      ["learningObjectives", analysis.learningObjectives],
      ["constraints", analysis.constraints],
      ["hiddenRequirements", analysis.hiddenRequirements],
      ["integrityGuidance", analysis.integrityGuidance],
      ["ambiguities", analysis.ambiguities],
      ["rubric", analysis.rubric],
    ] as const;

    linkedCollections.forEach(([collectionName, collection]) => {
      collection.forEach((item, itemIndex) => {
        item.evidenceRefs.forEach((evidenceId, refIndex) => {
          if (!evidenceIds.has(evidenceId)) {
            context.addIssue({
              code: "custom",
              message: `Unknown evidence ref: ${evidenceId}`,
              path: [collectionName, itemIndex, "evidenceRefs", refIndex],
            });
          }
        });
      });
    });

    const rubricIds = new Set<string>();
    analysis.rubric.forEach((criterion, index) => {
      if (rubricIds.has(criterion.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate rubric id: ${criterion.id}`,
          path: ["rubric", index, "id"],
        });
      }
      rubricIds.add(criterion.id);
    });

    const weightTotal = analysis.rubric.reduce(
      (total, criterion) => total + criterion.weight,
      0,
    );
    if (Math.abs(weightTotal - 100) > 0.001) {
      context.addIssue({
        code: "custom",
        message: `Rubric weights must total 100; received ${weightTotal}`,
        path: ["rubric"],
      });
    }
  });

export const draftInputSchema = z
  .object({
    id: z.string().min(1).max(160),
    assignmentId: z.string().min(1).max(160),
    sectionId: z.string().min(1).max(160),
    sectionLabel: z.string().min(1).max(300),
    text: z.string().min(1).max(100_000),
  })
  .strict();

export const draftSpanSchema = z
  .object({
    start: z.number().int().nonnegative().max(100_000),
    end: z.number().int().positive().max(100_000),
    excerpt: z.string().min(1).max(4_096),
  })
  .strict()
  .refine((span) => span.end > span.start, {
    message: "Draft span end must be after its start",
  });

export const feedbackItemSchema = z
  .object({
    id: z.string().min(1).max(160),
    kind: z.enum(["strength", "issue", "evidence_gap", "next_action"]),
    severity: z.enum(["high", "medium", "low"]),
    rubricIds: z.array(z.string().min(1).max(160)).min(1).max(50),
    title: z.string().min(1).max(300),
    explanation: z.string().min(1).max(4_096),
    draftEvidence: z.array(draftSpanSchema).max(50),
    sourceEvidenceRefs: z.array(z.string().min(1).max(160)).min(1).max(100),
    action: z.string().min(1).max(4_096).optional(),
    successCheck: z.string().min(1).max(2_000).optional(),
    guidance: z
      .object({
        kind: z.enum(["question", "sentence_stem"]),
        text: z.string().min(1).max(320),
      })
      .strict()
      .optional(),
  })
  .strict();

export const criterionCheckSchema = z
  .object({
    criterionId: z.string().min(1).max(160),
    coverage: z.number().min(0).max(100),
    status: z.enum(["not_started", "emerging", "partial", "strong"]),
    summary: z.string().min(1).max(4_096),
    strengths: z.array(z.string().min(1).max(1_000)).max(100),
    gaps: z.array(z.string().min(1).max(1_000)).max(100),
    evidenceRefs: z.array(z.string().min(1).max(160)).min(1).max(100),
  })
  .strict();

export const draftCheckResultSchema = z
  .object({
    id: z.string().min(1).max(160),
    assignmentId: z.string().min(1).max(160),
    draftId: z.string().min(1).max(160),
    sectionId: z.string().min(1).max(160),
    coverageEstimate: z.number().min(0).max(100),
    coverageDisclaimer: z.string().min(1).max(2_000),
    criteria: z.array(criterionCheckSchema).min(1).max(50),
    feedback: z.array(feedbackItemSchema).min(1).max(200),
    nextActions: z
      .array(
        z
          .object({
            id: z.string().min(1).max(160),
            text: z.string().min(1).max(2_000),
            priority: z.enum(["high", "medium", "low"]),
            estimatedMinutes: z.number().int().positive().max(100_000),
            rubricIds: z.array(z.string().min(1).max(160)).min(1).max(50),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict()
  .superRefine((result, context) => {
    const criterionIds = new Set<string>();
    result.criteria.forEach((criterion, index) => {
      if (criterionIds.has(criterion.criterionId)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate draft-check criterion: ${criterion.criterionId}`,
          path: ["criteria", index, "criterionId"],
        });
      }
      criterionIds.add(criterion.criterionId);
    });
    result.feedback.forEach((feedback, feedbackIndex) => {
      feedback.rubricIds.forEach((criterionId, rubricIndex) => {
        if (!criterionIds.has(criterionId)) {
          context.addIssue({
            code: "custom",
            message: `Unknown draft-check rubric id: ${criterionId}`,
            path: ["feedback", feedbackIndex, "rubricIds", rubricIndex],
          });
        }
      });
    });
  });

export const rubricTrailFixtureSchema = z
  .object({
    assignment: assignmentAnalysisSchema,
    draft: draftInputSchema,
    draftCheck: draftCheckResultSchema,
  })
  .strict()
  .superRefine((fixture, context) => {
    if (fixture.draft.assignmentId !== fixture.assignment.id) {
      context.addIssue({
        code: "custom",
        message: "Draft assignmentId does not match assignment",
        path: ["draft", "assignmentId"],
      });
    }
    if (
      fixture.draftCheck.assignmentId !== fixture.assignment.id ||
      fixture.draftCheck.draftId !== fixture.draft.id
    ) {
      context.addIssue({
        code: "custom",
        message: "Draft-check identifiers do not match fixture",
        path: ["draftCheck"],
      });
    }
    if (fixture.draftCheck.sectionId !== fixture.draft.sectionId) {
      context.addIssue({
        code: "custom",
        message: "Draft-check section does not match the selected draft section",
        path: ["draftCheck", "sectionId"],
      });
    }

    const rubricIds = new Set(
      fixture.assignment.rubric.map((criterion) => criterion.id),
    );
    const evidenceIds = new Set(
      fixture.assignment.evidence.map((evidence) => evidence.id),
    );
    const checkedCriterionIds = new Set(
      fixture.draftCheck.criteria.map((criterion) => criterion.criterionId),
    );

    fixture.draftCheck.criteria.forEach((criterion, index) => {
      if (!rubricIds.has(criterion.criterionId)) {
        context.addIssue({
          code: "custom",
          message: `Unknown rubric criterion: ${criterion.criterionId}`,
          path: ["draftCheck", "criteria", index, "criterionId"],
        });
      }
      criterion.evidenceRefs.forEach((ref, refIndex) => {
        if (!evidenceIds.has(ref)) {
          context.addIssue({
            code: "custom",
            message: `Unknown evidence ref: ${ref}`,
            path: ["draftCheck", "criteria", index, "evidenceRefs", refIndex],
          });
        }
      });
    });
    fixture.assignment.rubric.forEach((criterion) => {
      if (!checkedCriterionIds.has(criterion.id)) {
        context.addIssue({
          code: "custom",
          message: `Missing draft-check criterion: ${criterion.id}`,
          path: ["draftCheck", "criteria"],
        });
      }
    });

    fixture.draftCheck.feedback.forEach((feedback, feedbackIndex) => {
      feedback.sourceEvidenceRefs.forEach((ref, refIndex) => {
        if (!evidenceIds.has(ref)) {
          context.addIssue({
            code: "custom",
            message: `Unknown evidence ref: ${ref}`,
            path: [
              "draftCheck",
              "feedback",
              feedbackIndex,
              "sourceEvidenceRefs",
              refIndex,
            ],
          });
        }
      });
      feedback.draftEvidence.forEach((span, spanIndex) => {
        if (
          span.end > fixture.draft.text.length ||
          fixture.draft.text.slice(span.start, span.end) !== span.excerpt
        ) {
          context.addIssue({
            code: "custom",
            message: "Draft evidence span does not match draft text",
            path: [
              "draftCheck",
              "feedback",
              feedbackIndex,
              "draftEvidence",
              spanIndex,
            ],
          });
        }
      });
    });

    fixture.draftCheck.nextActions.forEach((action, actionIndex) => {
      action.rubricIds.forEach((criterionId, rubricIndex) => {
        if (!rubricIds.has(criterionId)) {
          context.addIssue({
            code: "custom",
            message: `Unknown next-action rubric id: ${criterionId}`,
            path: ["draftCheck", "nextActions", actionIndex, "rubricIds", rubricIndex],
          });
        }
      });
    });

    const rubricWeight = new Map(
      fixture.assignment.rubric.map((criterion) => [
        criterion.id,
        criterion.weight,
      ]),
    );
    const weightedCoverage = fixture.draftCheck.criteria.reduce(
      (total, criterion) =>
        total + criterion.coverage * ((rubricWeight.get(criterion.criterionId) ?? 0) / 100),
      0,
    );
    if (Math.abs(Math.round(weightedCoverage) - fixture.draftCheck.coverageEstimate) > 1) {
      context.addIssue({
        code: "custom",
        message: "Coverage estimate is inconsistent with weighted criteria",
        path: ["draftCheck", "coverageEstimate"],
      });
    }
  });

export const rubricLinkSchema = z
  .object({
    criterionId: z.string().min(1),
    contribution: z.number().positive().max(1),
  })
  .strict();

export const planningDepthSchema = z.enum([
  "focused",
  "standard",
  "thorough",
  "extended",
]);

export const planTaskTemplateSchema = z
  .object({
    id: z.string().min(1),
    phase: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    priority: z.enum(["high", "medium", "low"]),
    baseMinutes: z.number().int().positive(),
    minPlanningDepth: planningDepthSchema.optional(),
    dependencies: z.array(z.string().min(1)),
    doneDefinition: z.array(z.string().min(1)).min(1),
    rubricLinks: z.array(rubricLinkSchema).min(1),
  })
  .strict();

export const planTaskSchema = planTaskTemplateSchema.extend({
  adjustedMinutes: z.number().int().positive(),
  scheduledStartDate: dateOnlySchema,
  dueDate: dateOnlySchema,
  completed: z.boolean(),
  late: z.boolean(),
}).strict();

export const planGenerationInputSchema = z
  .object({
    weeklyHours: z.number().min(1).max(40),
    planningDepth: planningDepthSchema,
    startDate: dateOnlySchema,
    dueDate: dateOnlySchema,
    asOfDate: dateOnlySchema.optional(),
    completedTaskIds: z.array(z.string().min(1)).default([]),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.dueDate < input.startDate) {
      context.addIssue({
        code: "custom",
        message: "Assignment due date cannot be earlier than plan start date",
        path: ["dueDate"],
      });
    }
  });

export const criterionProgressSchema = z
  .object({
    criterionId: z.string().min(1),
    completedMinutes: z.number().nonnegative(),
    totalMinutes: z.number().nonnegative(),
    percent: z.number().min(0).max(100),
  })
  .strict();

export const actionPlanSchema = z
  .object({
    profile: z
      .object({
        weeklyHours: z.number().min(1).max(40),
        planningDepth: planningDepthSchema,
        startDate: dateOnlySchema,
        dueDate: dateOnlySchema,
        asOfDate: dateOnlySchema,
      })
      .strict(),
    tasks: z.array(planTaskSchema).min(1),
    totalMinutes: z.number().int().positive(),
    remainingMinutes: z.number().int().nonnegative(),
    completionPercent: z.number().min(0).max(100),
    projectedFinishDate: dateOnlySchema,
    status: z.enum(["on_track", "at_risk"]),
    capacityRisk: z
      .object({
        remainingMinutes: z.number().int().nonnegative(),
        availableMinutes: z.number().nonnegative(),
        shortfallMinutes: z.number().nonnegative(),
        requiredWeeklyHours: z.number().nonnegative(),
        deadlinePassed: z.boolean(),
        message: z.string().min(1),
      })
      .strict()
      .nullable(),
    rubricProgress: z.array(criterionProgressSchema).min(1),
  })
  .strict()
  .superRefine((plan, context) => {
    const taskIds = new Set<string>();
    plan.tasks.forEach((task, index) => {
      if (taskIds.has(task.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate plan task id: ${task.id}`,
          path: ["tasks", index, "id"],
        });
      }
      taskIds.add(task.id);
    });

    plan.tasks.forEach((task, taskIndex) => {
      task.dependencies.forEach((dependency, dependencyIndex) => {
        if (!taskIds.has(dependency)) {
          context.addIssue({
            code: "custom",
            message: `Unknown task dependency: ${dependency}`,
            path: ["tasks", taskIndex, "dependencies", dependencyIndex],
          });
        }
        if (dependency === task.id) {
          context.addIssue({
            code: "custom",
            message: "A task cannot depend on itself",
            path: ["tasks", taskIndex, "dependencies", dependencyIndex],
          });
        }
      });
    });

    const dependencyMap = new Map(
      plan.tasks.map((task) => [task.id, task.dependencies]),
    );
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const hasCycle = (id: string): boolean => {
      if (visiting.has(id)) return true;
      if (visited.has(id)) return false;
      visiting.add(id);
      const cyclic = (dependencyMap.get(id) ?? []).some(hasCycle);
      visiting.delete(id);
      visited.add(id);
      return cyclic;
    };
    if (plan.tasks.some((task) => hasCycle(task.id))) {
      context.addIssue({
        code: "custom",
        message: "Plan task dependencies must form an acyclic graph",
        path: ["tasks"],
      });
    }
  });

export const structuredResultSchema = <T extends z.ZodTypeAny>(dataSchema: T) =>
  z
    .object({
      schemaVersion: z.literal("1.0"),
      mode: z.enum(["mock", "live"]),
      fixtureVersion: z.string().min(1).optional(),
      generatedAt: z.string().datetime({ offset: true }),
      data: dataSchema,
      warnings: z.array(z.string()),
    })
    .strict();

export type SourceDocument = z.infer<typeof sourceDocumentSchema>;
export type EvidenceRef = z.infer<typeof evidenceRefSchema>;
export type LinkedRequirement = z.infer<typeof linkedRequirementSchema>;
export type Ambiguity = z.infer<typeof ambiguitySchema>;
export type RubricCriterion = z.infer<typeof rubricCriterionSchema>;
export type AssignmentAnalysis = z.infer<typeof assignmentAnalysisSchema>;
export type DraftInput = z.infer<typeof draftInputSchema>;
export type DraftSpan = z.infer<typeof draftSpanSchema>;
export type FeedbackItem = z.infer<typeof feedbackItemSchema>;
export type CriterionCheck = z.infer<typeof criterionCheckSchema>;
export type DraftCheckResult = z.infer<typeof draftCheckResultSchema>;
export type RubricTrailFixture = z.infer<typeof rubricTrailFixtureSchema>;
export type RubricLink = z.infer<typeof rubricLinkSchema>;
export type PlanningDepth = z.infer<typeof planningDepthSchema>;
export type PlanTaskTemplate = z.infer<typeof planTaskTemplateSchema>;
export type PlanTask = z.infer<typeof planTaskSchema>;
export type PlanGenerationInput = z.input<typeof planGenerationInputSchema>;
export type ParsedPlanGenerationInput = z.output<typeof planGenerationInputSchema>;
export type CriterionProgress = z.infer<typeof criterionProgressSchema>;
export type ActionPlan = z.infer<typeof actionPlanSchema>;
