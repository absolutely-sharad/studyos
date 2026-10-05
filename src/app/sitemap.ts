import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/config";

// Read at request time so the runtime AUTH_URL is used, not whatever was set when the image was built.
export const dynamic = "force-dynamic";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/about", "/credits", "/signup", "/login"].map((path) => ({
    url: `${siteUrl}${path}`,
    changeFrequency: path === "/" ? "weekly" : "monthly",
    priority: path === "/" ? 1 : 0.5,
  }));
}
