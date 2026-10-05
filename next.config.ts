import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";

// The app serves no third-party scripts, frames or images. The only outside resources are Google Fonts
// (see src/app/layout.tsx). Next.js injects small inline scripts to boot, hence 'unsafe-inline' for
// scripts; everything else is locked to this origin. Google's sign-in is a navigation, so it needs
// form-action. `unsafe-eval` is only for the development server's hot reload.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "frame-ancestors 'none'",
  ...(dev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // Ignored over plain HTTP, so it is harmless on localhost. No includeSubDomains or preload: those are
  // decisions for whoever owns the whole domain.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image (`node server.js`); ignored by Vercel.
  output: "standalone",
  poweredByHeader: false,
  // PDF/DOCX parsers run on the server only.
  serverExternalPackages: ["unpdf", "mammoth"],
  experimental: { serverActions: { bodySizeLimit: "2mb" } },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Everything except the file viewer. That route sets its own, stricter policy (`default-src 'none';
      // sandbox`), and a header from this file would replace it.
      { source: "/((?!api/documents/[^/]+/file).*)", headers: [{ key: "Content-Security-Policy", value: csp }] },
    ];
  },
};

export default nextConfig;
