import type { Metadata } from "next";

import "@/app/globals.css";

export const metadata: Metadata = {
  title: "RubricTrail dormant workspace test harness",
  robots: { index: false, follow: false },
};

export default function WorkspaceHarnessLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
