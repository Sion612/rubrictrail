import { Bug, Code2, GitPullRequestArrow, type LucideIcon } from "lucide-react";

export const COMMUNITY_URLS = {
  source: "https://github.com/Sion612/rubrictrail",
  report:
    "https://github.com/Sion612/rubrictrail/issues/new?template=bug_report.yml",
  contribute:
    "https://github.com/Sion612/rubrictrail/blob/main/CONTRIBUTING.md",
} as const;

const COMMUNITY_ITEMS: ReadonlyArray<{
  href: (typeof COMMUNITY_URLS)[keyof typeof COMMUNITY_URLS];
  label: string;
  detail: string;
  icon: LucideIcon;
}> = [
  {
    href: COMMUNITY_URLS.source,
    label: "View source",
    detail: "Read the code and project history.",
    icon: Code2,
  },
  {
    href: COMMUNITY_URLS.report,
    label: "Report a problem",
    detail: "Use fictional examples only.",
    icon: Bug,
  },
  {
    href: COMMUNITY_URLS.contribute,
    label: "Contribute",
    detail: "Start with the contributor guide.",
    icon: GitPullRequestArrow,
  },
];

export function CommunityLinks() {
  return (
    <nav className="community-links" aria-label="RubricTrail community">
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
            <strong>{label}</strong>
            <small>{detail}</small>
          </span>
        </a>
      ))}
    </nav>
  );
}
