import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["docx", "mammoth", "docx-preview", "puppeteer"],
  experimental: {
    // Large Apollo/CSV exports (multipart) — default middleware buffer is 10MB
    middlewareClientMaxBodySize: "100mb",
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
};

export default nextConfig;
