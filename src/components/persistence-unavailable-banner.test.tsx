import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LocaleProvider } from "@/components/locale-provider";
import { PersistenceUnavailableBanner } from "@/components/persistence-unavailable-banner";

afterEach(() => {
  cleanup();
});

describe("PersistenceUnavailableBanner", () => {
  it("exposes a persistent named region and backup action", () => {
    const onDownloadBackup = vi.fn();
    render(<PersistenceUnavailableBanner onDownloadBackup={onDownloadBackup} />);

    const region = screen.getByRole("region", {
      name: "Browser saving is unavailable",
    });
    expect(region).toHaveAccessibleDescription(
      "RubricTrail cannot safely write this project in this browser. New changes remain only in this tab. Download a backup before refreshing or closing this tab. Keep the JSON file private because it can contain notes and short excerpts.",
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Browser saving is unavailable. Download a project backup before closing this tab.",
    );
    expect(
      within(region).queryByRole("button", { name: /dismiss|close/i }),
    ).not.toBeInTheDocument();

    fireEvent.click(
      within(region).getByRole("button", { name: "Download project backup" }),
    );
    expect(onDownloadBackup).toHaveBeenCalledOnce();
  });

  it("explains the high-risk no-persistence state in Simplified Chinese", () => {
    render(
      <LocaleProvider>
        <LanguageSwitcher />
        <PersistenceUnavailableBanner onDownloadBackup={vi.fn()} />
      </LocaleProvider>,
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zh-CN" },
    });

    const region = screen.getByRole("region", { name: "浏览器保存不可用" });
    expect(region).toHaveAccessibleDescription(
      /刷新或关闭此标签页前请下载备份/,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "关闭此标签页前请下载项目备份",
    );
    expect(
      within(region).getByRole("button", { name: "下载项目备份" }),
    ).toBeInTheDocument();
  });
});
