import type { Metadata, Viewport } from "next";
import { brand } from "@/lib/config";
import "./globals.css";

const description =
  "Turn your syllabus, PDFs and PYQs into an intelligent study plan that continuously adapts to your progress.";

export const metadata: Metadata = {
  title: { default: `${brand.appName} — AI-Powered Adaptive Study Planning`, template: `%s · ${brand.appName}` },
  description,
  applicationName: brand.appName,
  authors: [{ name: brand.developer, url: brand.githubUrl }],
  creator: brand.developer,
  publisher: brand.company,
  keywords: ["StudyOS", "AI study planner", "AI study assistant", "syllabus planner", "personalized study plan", "adaptive study planner", "AI learning assistant"],
  openGraph: {
    title: `${brand.appName} — AI-Powered Adaptive Study Planning`,
    description,
    siteName: brand.appName,
    type: "website",
  },
  twitter: { card: "summary", title: `${brand.appName} — AI-Powered Adaptive Study Planning`, description },
};

export const viewport: Viewport = { themeColor: "#1e2b4a", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:ital,wght@0,400;0,700;1,400&family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,600;12..96,700&display=swap"
        />
      </head>
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
