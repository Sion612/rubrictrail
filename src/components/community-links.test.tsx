import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  COMMUNITY_URLS,
  CommunityLinks,
} from "@/components/community-links";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LocaleProvider } from "@/components/locale-provider";

afterEach(cleanup);

describe("CommunityLinks", () => {
  it("exposes fixed, named community destinations as safe external links", () => {
    render(<CommunityLinks />);

    const community = screen.getByRole("navigation", {
      name: "RubricTrail community",
    });
    const expectedLinks = [
      ["View source", COMMUNITY_URLS.source],
      ["Report a problem", COMMUNITY_URLS.report],
      ["Contribute", COMMUNITY_URLS.contribute],
    ] as const;

    for (const [name, href] of expectedLinks) {
      const link = within(community).getByRole("link", { name: new RegExp(name) });
      expect(link).toHaveAttribute("href", href);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      expect(link.tabIndex).toBe(0);
    }
  });

  it("localizes link guidance without changing the fixed destinations", () => {
    render(
      <LocaleProvider>
        <LanguageSwitcher />
        <CommunityLinks />
      </LocaleProvider>,
    );

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "zh-CN" },
    });

    const community = screen.getByRole("navigation", {
      name: "RubricTrail 开源社区",
    });
    expect(
      within(community).getByRole("link", { name: /查看源代码/ }),
    ).toHaveAttribute("href", COMMUNITY_URLS.source);
    expect(
      within(community).getByRole("link", { name: /报告问题/ }),
    ).toHaveAttribute("href", COMMUNITY_URLS.report);
    expect(community).toHaveTextContent("切勿提交真实作业内容");
  });
});
