import type { NextConfig } from "next";
import path from "path";

// Hermes dashboard reverse proxy.
// When HERMES_DASHBOARD_URL is set, /hermes-proxy/** is transparently forwarded
// to the hermes-agent dashboard so the HermesManage iframe loads same-origin.
const HERMES_DASH = process.env.HERMES_DASHBOARD_URL ?? "";

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    root: path.resolve(__dirname),
  },
  ...(HERMES_DASH
    ? {
        async rewrites() {
          return [
            {
              source: "/hermes-proxy/:path*",
              destination: `${HERMES_DASH}/:path*`,
            },
          ];
        },
      }
    : {}),
};

export default nextConfig;
