import type { Metadata } from "next";
import { localeBootstrapScript } from "@/lib/i18n/preferences";
import "./globals.css";

export const metadata: Metadata = {
  title: "RubricTrail — From brief to evidence · 从作业要求到原文依据",
  description:
    "A local-first assignment planner with English and Simplified Chinese interface support. 本地优先、支持中英文界面的作业规划工具。",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: localeBootstrapScript() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
