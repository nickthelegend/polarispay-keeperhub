import path from "node:path";

import type { NextConfig } from "next";

const nextConfig = {
  // Turbopack will not follow a workspace symlink that points outside its
  // inferred root, so @polarispay/db resolves to nothing and every data route
  // 500s with "Module not found". Pointing the root at the monorepo fixes it.
  turbopack: {
    root: path.join(__dirname, "..", ".."),
  },
  // @polarispay/db ships TypeScript source rather than a build step, so Next
  // has to compile it like first-party code. Without this the workspace import
  // resolves to nothing and every data route 500s with "Module not found".
  transpilePackages: ["@polarispay/db"],
  typescript: {
    // Type errors now fail the build (the app typechecks clean).
    ignoreBuildErrors: false,
  },
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Access-Control-Allow-Credentials", value: "true" },
          { key: "Access-Control-Allow-Origin", value: "*" }, // In production, restrict this to specific origins
          { key: "Access-Control-Allow-Methods", value: "GET,DELETE,PATCH,POST,PUT,OPTIONS" },
          { key: "Access-Control-Allow-Headers", value: "X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, x-wallet-address" },
        ],
      },
    ];
  },
};

export default nextConfig;

