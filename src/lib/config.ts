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
