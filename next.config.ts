import type { NextConfig } from "next";

const YEAR = "public, max-age=31536000, immutable";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  async headers() {
    return [
      {
        // the only mutable entry point (docs/contracts.md §5)
        source: "/data/:city/manifest.json",
        headers: [{ key: "Cache-Control", value: "public, max-age=300, must-revalidate" }],
      },
      {
        // content-hashed artifacts and sidecars
        source: "/data/:city/:file((?!manifest\\.json).*)",
        headers: [{ key: "Cache-Control", value: YEAR }],
      },
    ];
  },
};

export default nextConfig;
