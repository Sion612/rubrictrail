import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  COMMUNITY_URLS,
  CommunityLinks,
} from "@/components/community-links";

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
});
