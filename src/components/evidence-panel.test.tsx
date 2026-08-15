import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EvidencePanel } from "@/components/evidence-panel";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LocaleProvider } from "@/components/locale-provider";
import { SAMPLE_ASSIGNMENT } from "@/lib/sample-data";

afterEach(cleanup);

describe("EvidencePanel", () => {
  it("localizes panel chrome while preserving source names, locators, and excerpts", () => {
    const evidence =
      SAMPLE_ASSIGNMENT.evidence.find((item) => item.locator.page) ??
      SAMPLE_ASSIGNMENT.evidence[0];
    const source = SAMPLE_ASSIGNMENT.sourceDocuments.find(
      (item) => item.id === evidence.documentId,
    );

    render(
      <LocaleProvider>
        <LanguageSwitcher />
        <EvidencePanel
          analysis={SAMPLE_ASSIGNMENT}
          evidenceId={evidence.id}
          onClose={vi.fn()}
        />
      </LocaleProvider>,
    );

    const language = screen.getByRole("combobox");
    fireEvent.change(language, { target: { value: "en" } });
    expect(
      screen.getByRole("heading", { name: "Exact excerpt" }),
    ).toBeInTheDocument();
    const excerpt = screen.getByText(evidence.excerpt, { selector: "blockquote" });

    fireEvent.change(language, {
      target: { value: "zh-CN" },
    });

    expect(screen.getByRole("heading", { name: "原文摘录" })).toBeInTheDocument();
    expect(screen.getByText(source?.name ?? "")).toBeInTheDocument();
    expect(
      screen.getByText(evidence.excerpt, { selector: "blockquote" }),
    ).toBe(excerpt);
    if (evidence.locator.page) {
      expect(document.body).toHaveTextContent(`第 ${evidence.locator.page} 页`);
    }
    if (evidence.locator.section) {
      expect(document.body).toHaveTextContent(evidence.locator.section);
    }
    expect(
      screen.getAllByRole("button", { name: "关闭原文依据面板" }),
    ).toHaveLength(2);
  });
});
