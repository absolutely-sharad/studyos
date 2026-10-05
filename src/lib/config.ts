export const brand = {
  appName: process.env.NEXT_PUBLIC_APP_NAME || "StudyOS",
  company: process.env.NEXT_PUBLIC_COMPANY_NAME || "Sharad Solutions",
  developer: process.env.NEXT_PUBLIC_DEVELOPER_NAME || "Sharad Singh Kushwaha",
  githubUrl: process.env.NEXT_PUBLIC_GITHUB_URL || "https://github.com/absolutely-sharad",
  /** Never guessed — set NEXT_PUBLIC_LINKEDIN_URL to show the link. */
  linkedinUrl: process.env.NEXT_PUBLIC_LINKEDIN_URL || "",
  version: "1.0.0",
  tagline: "AI-powered adaptive study planning.",
};

/**
 * Public origin, used for canonical links, the sitemap and social previews.
 * NEXT_PUBLIC_ values are baked in at build time, so set this before `npm run build`.
 */
export const siteUrl = (
  process.env.NEXT_PUBLIC_APP_URL ||
  process.env.AUTH_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "") ||
  "http://localhost:3000"
).replace(/\/+$/, "");

export const LEVEL_FACTOR = {
  BEGINNER: 1.3,
  INTERMEDIATE: 1,
  ADVANCED: 0.6,
  UNSURE: 1.1,
} as const;

export const LEVEL_START_MASTERY = {
  BEGINNER: 0,
  INTERMEDIATE: 30,
  ADVANCED: 60,
  UNSURE: 10,
} as const;

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
