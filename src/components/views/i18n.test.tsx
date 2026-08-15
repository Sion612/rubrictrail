import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider, useI18n } from "@/components/locale-provider";
import { ActionPlanView } from "@/components/views/action-plan-view";
import { DraftCheckView } from "@/components/views/draft-check-view";
import { OverviewView } from "@/components/views/overview-view";
import { RubricView } from "@/components/views/rubric-view";
import {
  UploadedBriefView,
  UploadedRubricView,
} from "@/components/views/uploaded-project-views";
import { DEFAULT_PLAN_INPUT, generateActionPlan } from "@/lib/plan";
import {
  SAMPLE_ASSIGNMENT,
  SAMPLE_DRAFT_CHECK,
  SAMPLE_DRAFT_TEXT,
} from "@/lib/sample-data";
import {
  localizeSampleAmbiguityText,
  localizeSampleOverviewFact,
  localizeSampleRequirementText,
  localizeSampleRubricListItem,
  localizeSampleRubricSummary,
} from "@/lib/i18n/messages/views";
import type { UploadedProject } from "@/lib/ui-types";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

function ChineseControl() {
  const { setLocale } = useI18n();
  return (
    <button type="button" onClick={() => setLocale("zh-CN")}>
      switch-test-locale
    </button>
  );
}

const uploadedProject: UploadedProject = {
  id: "uploaded-project",
  title: "Original uploaded title",
  course: "Original course",
  dueDate: "2026-09-24",
  wordCount: 2_500,
  citationStyle: "APA 7",
  fileNames: ["original-brief.txt"],
  extractedWordCount: 320,
  weightingStatus: "complete",
  criteria: [
    {
      id: "criterion-original",
      name: "Original criterion name",
      weight: 100,
      evidence: {
        sourceId: "source-original",
        excerpt: "Original source excerpt must stay unchanged.",
        fileName: "original-rubric.pdf",
        page: 2,
        startOffset: 10,
        endOffset: 54,
      },
    },
  ],
  createdAt: "2026-08-12T00:00:00.000Z",
};

describe("core view localization", () => {
  it("switches system copy to Simplified Chinese without changing ids, progress, or uploaded text", () => {
    const onToggleTask = vi.fn();
    const plan = generateActionPlan(DEFAULT_PLAN_INPUT);

    render(
      <LocaleProvider>
        <ChineseControl />
        <ActionPlanView
          plan={plan}
          onRebalance={vi.fn()}
          onToggleTask={onToggleTask}
          onNavigateDraft={vi.fn()}
        />
        <DraftCheckView
          analysis={SAMPLE_ASSIGNMENT}
          draftText={SAMPLE_DRAFT_TEXT}
          selectedSectionId="analysis-recommendations"
          result={SAMPLE_DRAFT_CHECK}
          checkedDraftText={SAMPLE_DRAFT_TEXT}
          isChecking={false}
          checkingStage={0}
          onDraftChange={vi.fn()}
          onSectionChange={vi.fn()}
          onCheck={vi.fn()}
          onOpenEvidence={vi.fn()}
          onNavigateProgress={vi.fn()}
        />
        <UploadedBriefView project={uploadedProject} onNavigate={vi.fn()} />
        <UploadedRubricView
          project={uploadedProject}
          onOpenEvidence={vi.fn()}
          onNavigate={vi.fn()}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "switch-test-locale" }));

    expect(screen.getByRole("heading", { name: "每项任务都有清晰的完成标准。" })).toBeInTheDocument();
    expect(screen.getByText("梳理作业说明并标记依据")).toBeInTheDocument();

    const firstTask = screen.getByTestId("task-p1");
    expect(within(firstTask).getByText("45 分钟")).toBeInTheDocument();
    expect(screen.getByLabelText("计划已完成 0%")).toHaveTextContent("0%");
    fireEvent.click(within(firstTask).getByRole("checkbox"));
    expect(onToggleTask).toHaveBeenCalledWith("p1");

    expect(screen.getByRole("heading", { name: "完成产能计算" })).toBeInTheDocument();
    expect(
      screen.getAllByText(/This suggests that staging may be the bottleneck\./).length,
    ).toBeGreaterThan(0);

    expect(screen.getByRole("heading", { name: uploadedProject.title })).toBeInTheDocument();
    expect(screen.getAllByText("Original criterion name").length).toBeGreaterThan(0);
    expect(screen.getByText("Original source excerpt must stay unchanged.")).toBeInTheDocument();
    expect(screen.getByText("Original uploaded title")).toBeInTheDocument();
    expect(screen.getByText("2026年9月24日")).toBeInTheDocument();
  });

  it("localizes built-in sample analysis while preserving source-language facts", () => {
    const plan = generateActionPlan(DEFAULT_PLAN_INPUT);

    render(
      <LocaleProvider>
        <ChineseControl />
        <OverviewView
          analysis={SAMPLE_ASSIGNMENT}
          onOpenEvidence={vi.fn()}
          onNavigate={vi.fn()}
        />
        <RubricView
          analysis={SAMPLE_ASSIGNMENT}
          draftResult={SAMPLE_DRAFT_CHECK}
          plan={plan}
          onOpenEvidence={vi.fn()}
        />
        <ActionPlanView
          plan={plan}
          onRebalance={vi.fn()}
          onToggleTask={vi.fn()}
          onNavigateDraft={vi.fn()}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "switch-test-locale" }));

    expect(
      screen.getByText(
        "诊断 LumaLane Market 到店取货流程中的一个优先约束，运用运营管理理论分析案例依据，并提出可行、可衡量的改进计划。",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "2,000 字报告" })).toBeInTheDocument();
    expect(screen.getByText("需要多少外部来源，对时效性有什么要求？")).toBeInTheDocument();

    expect(
      screen.getByText("整合案例事实与经核验的外部依据，同时清楚呈现假设和局限。"),
    ).toBeInTheDocument();
    expect(screen.getByText("整合定量与定性依据。")).toBeInTheDocument();
    expect(screen.getByText("论断到来源的依据矩阵")).toBeInTheDocument();
    expect(screen.getByText("缺少支持的行业论断")).toBeInTheDocument();

    const firstTask = screen.getByTestId("task-p1");
    expect(
      within(firstTask).getByText(
        "评分项：问题诊断 · 运营管理理论应用 · 依据与分析 · 建议质量 · 结构与学术表达",
      ),
    ).toBeInTheDocument();
    expect(within(firstTask).queryByText(/评分项：diagnosis/u)).not.toBeInTheDocument();

    expect(
      screen.getByRole("heading", { name: SAMPLE_ASSIGNMENT.title }),
    ).toBeInTheDocument();
    expect(screen.getByText(SAMPLE_ASSIGNMENT.course)).toBeInTheDocument();
    expect(screen.getByText("Evidence and analysis")).toBeInTheDocument();

    expect(
      localizeSampleOverviewFact(
        SAMPLE_ASSIGNMENT.id,
        "executiveSummary",
        SAMPLE_ASSIGNMENT.executiveSummary,
        "zh-CN",
      ),
    ).not.toBe(SAMPLE_ASSIGNMENT.executiveSummary);
    for (const requirement of [
      ...SAMPLE_ASSIGNMENT.deliverables,
      ...SAMPLE_ASSIGNMENT.learningObjectives,
      ...SAMPLE_ASSIGNMENT.constraints,
      ...SAMPLE_ASSIGNMENT.hiddenRequirements,
      ...SAMPLE_ASSIGNMENT.integrityGuidance,
    ]) {
      expect(
        localizeSampleRequirementText(
          SAMPLE_ASSIGNMENT.id,
          requirement.id,
          "label",
          requirement.label,
          "zh-CN",
        ),
      ).not.toBe(requirement.label);
      expect(
        localizeSampleRequirementText(
          SAMPLE_ASSIGNMENT.id,
          requirement.id,
          "description",
          requirement.description,
          "zh-CN",
        ),
      ).not.toBe(requirement.description);
    }
    for (const ambiguity of SAMPLE_ASSIGNMENT.ambiguities) {
      for (const field of ["question", "whyItMatters", "safeWorkingAssumption"] as const) {
        expect(
          localizeSampleAmbiguityText(
            SAMPLE_ASSIGNMENT.id,
            ambiguity.id,
            field,
            ambiguity[field],
            "zh-CN",
          ),
        ).not.toBe(ambiguity[field]);
      }
    }
    for (const criterion of SAMPLE_ASSIGNMENT.rubric) {
      expect(
        localizeSampleRubricSummary(
          SAMPLE_ASSIGNMENT.id,
          criterion.id,
          criterion.summary,
          "zh-CN",
        ),
      ).not.toBe(criterion.summary);
      for (const field of [
        "highPerformance",
        "evidenceNeeded",
        "reportSections",
        "commonRisks",
      ] as const) {
        criterion[field].forEach((item, index) => {
          expect(
            localizeSampleRubricListItem(
              SAMPLE_ASSIGNMENT.id,
              criterion.id,
              field,
              index,
              item,
              "zh-CN",
            ),
          ).not.toBe(item);
        });
      }
    }
  });
});
