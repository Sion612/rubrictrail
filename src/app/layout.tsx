import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RubricTrail — From brief to evidence",
  description:
    "A local-first, evidence-linked assignment planner for students.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
