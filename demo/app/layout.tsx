import type { Metadata } from "next";
import "@/app/globals.css";
import { localeBootstrapScript } from "@/lib/i18n/preferences";
import {
  PUBLIC_DEMO_DESCRIPTION,
  PUBLIC_DEMO_SOCIAL_IMAGE_URL,
  PUBLIC_DEMO_TITLE,
  PUBLIC_DEMO_URL,
} from "./public-demo-metadata";

export const metadata: Metadata = {
  metadataBase: new URL(PUBLIC_DEMO_URL),
  title: PUBLIC_DEMO_TITLE,
  description: PUBLIC_DEMO_DESCRIPTION,
  alternates: {
    canonical: PUBLIC_DEMO_URL,
  },
  openGraph: {
    type: "website",
    url: PUBLIC_DEMO_URL,
    siteName: "RubricTrail",
    title: PUBLIC_DEMO_TITLE,
    description: PUBLIC_DEMO_DESCRIPTION,
    images: [
      {
        url: PUBLIC_DEMO_SOCIAL_IMAGE_URL,
        width: 1200,
        height: 630,
        alt: "RubricTrail fictional assignment rubric workspace",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: PUBLIC_DEMO_TITLE,
    description: PUBLIC_DEMO_DESCRIPTION,
    images: [
      {
        url: PUBLIC_DEMO_SOCIAL_IMAGE_URL,
        alt: "RubricTrail fictional assignment rubric workspace",
      },
    ],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function DemoRootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: localeBootstrapScript() }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
