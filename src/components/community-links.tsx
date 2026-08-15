"use client";

import { Bug, Code2, GitPullRequestArrow, type LucideIcon } from "lucide-react";
import { useLocalizedMessages } from "@/components/locale-provider";
import { workspaceEn, workspaceZhCN } from "@/lib/i18n/messages/workspace";

export const COMMUNITY_URLS = {
  source: "https://github.com/Sion612/rubrictrail",
  report:
    "https://github.com/Sion612/rubrictrail/issues/new?template=bug_report.yml",
  contribute:
    "https://github.com/Sion612/rubrictrail/blob/main/CONTRIBUTING.md",
} as const;

const COMMUNITY_ITEMS: ReadonlyArray<{
  href: (typeof COMMUNITY_URLS)[keyof typeof COMMUNITY_URLS];
  label: keyof typeof workspaceEn;
  detail: keyof typeof workspaceEn;
  icon: LucideIcon;
}> = [
  {
    href: COMMUNITY_URLS.source,
    label: "viewSource",
    detail: "viewSourceDetail",
    icon: Code2,
  },
  {
    href: COMMUNITY_URLS.report,
    label: "reportProblem",
    detail: "reportProblemDetail",
    icon: Bug,
  },
  {
    href: COMMUNITY_URLS.contribute,
    label: "contribute",
    detail: "contributeDetail",
    icon: GitPullRequestArrow,
  },
];

export function CommunityLinks() {
  const messages = useLocalizedMessages(workspaceEn, workspaceZhCN);

  return (
    <nav className="community-links" aria-label={messages.communityAria}>
      {COMMUNITY_ITEMS.map(({ href, label, detail, icon: Icon }) => (
        <a
          className="community-link"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          key={href}
        >
          <Icon aria-hidden="true" />
          <span>
            <strong>{messages[label]}</strong>
            <small>{messages[detail]}</small>
          </span>
        </a>
      ))}
    </nav>
  );
}
