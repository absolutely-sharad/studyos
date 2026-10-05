import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/config";

// Read at request time so the runtime AUTH_URL is used, not whatever was set when the image was built.
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/dashboard", "/plan", "/syllabus", "/topics/", "/setup", "/settings", "/study/", "/onboarding"],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
