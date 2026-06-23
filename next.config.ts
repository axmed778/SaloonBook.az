import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Keep server-only packages out of the client bundle.
  serverExternalPackages: ["@prisma/client", "bullmq", "ioredis"],
};

export default nextConfig;
