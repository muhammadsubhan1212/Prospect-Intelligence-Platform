import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep native/heavy CJS packages external. Do NOT list puppeteer here —
  // Puppeteer 22+ is ESM-only; listing it triggers
  // "Package puppeteer can't be external / require() resolves to ESM" on every
  // compile. Headless load uses dynamic import() in headlessRender.js instead.
  serverExternalPackages: ["docx", "mammoth", "docx-preview"],
  experimental: {
    // Large Apollo/CSV exports (multipart) — default middleware buffer is 10MB
    middlewareClientMaxBodySize: "100mb",
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
};

export default nextConfig;
