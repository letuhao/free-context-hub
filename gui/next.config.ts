import type { NextConfig } from "next";

/**
 * Single-port gateway.
 *
 * The Next.js server is the ONE external entrypoint for human users *and*
 * agents. It proxies non-UI traffic to the internal backend over the Docker
 * network, so the REST API (:3001) and the MCP endpoint (:3000) never need to
 * be published externally:
 *
 *   /api/*  → REST backend   (CONTEXTHUB_INTERNAL_API_URL, default http://mcp:3001)
 *   /mcp    → MCP for agents  (CONTEXTHUB_INTERNAL_MCP_URL,  default http://mcp:3000)
 *
 * Future surfaces (another FE, a public API) get added here as one more rewrite
 * rule — they all enter through this single port instead of fragmenting.
 *
 * Rewrites stream responses transparently, so SSE (MCP GET, chat) works.
 */
const INTERNAL_API_URL =
  process.env.CONTEXTHUB_INTERNAL_API_URL ?? "http://mcp:3001";
const INTERNAL_MCP_URL =
  process.env.CONTEXTHUB_INTERNAL_MCP_URL ?? "http://mcp:3000";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${INTERNAL_API_URL}/api/:path*` },
      { source: "/mcp", destination: `${INTERNAL_MCP_URL}/mcp` },
      { source: "/mcp/:path*", destination: `${INTERNAL_MCP_URL}/mcp/:path*` },
    ];
  },
};

export default nextConfig;
