import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PDF/DOCX parsers run on the server only.
  serverExternalPackages: ["unpdf", "mammoth"],
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
};

export default nextConfig;
