import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Gateway CSRF / cross-site guard (Next.js Proxy — formerly Middleware).
 *
 * The single-port gateway proxies `/api/*` and `/mcp` to an internal backend
 * that, by default, has no authentication and previously relied on the MCP
 * SDK's localhost Host-header check for DNS-rebinding protection. Routing
 * through this proxy rewrites the Host header (→ `mcp`), which neutralizes that
 * check. To stop a malicious website from driving backend calls through a
 * victim's browser, we reject cross-site requests to the proxied paths here,
 * BEFORE the rewrite forwards them.
 *
 * Decision is based on the browser-set, non-spoofable `Sec-Fetch-Site` header
 * (all modern browsers send it on every request; JS cannot override it):
 *   - same-origin / same-site / none  → allow (the GUI itself, direct nav)
 *   - cross-site                      → block unless the Origin is allowlisted
 *
 * Non-browser clients (agents, curl, the e2e harness, server-to-server) send no
 * `Sec-Fetch-Site` — they are allowed, because the browser CSRF vector does not
 * apply to them and they authenticate with bearer tokens when auth is enabled.
 * As a fallback for older browsers that send `Origin` but not `Sec-Fetch-Site`,
 * a cross-origin `Origin` on a state-changing method is also blocked.
 *
 * Allow extra origins (a separate-origin frontend) via GATEWAY_ALLOWED_ORIGINS
 * (comma-separated). Keep this in sync with the backend's CORS_ALLOWED_ORIGINS.
 */

const ALLOWED_ORIGINS = (process.env.GATEWAY_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function blocked(reason: string) {
  return NextResponse.json(
    { error: `Forbidden: cross-site request to gateway rejected (${reason})` },
    { status: 403 },
  );
}

export function proxy(req: NextRequest) {
  // Let CORS preflight through; the backend CORS layer answers it.
  if (req.method === "OPTIONS") return NextResponse.next();

  const site = req.headers.get("sec-fetch-site");
  const origin = req.headers.get("origin");
  const isMcp = req.nextUrl.pathname === "/mcp" || req.nextUrl.pathname.startsWith("/mcp/");
  const stateChanging = !SAFE_METHODS.has(req.method);

  const originAllowed = origin !== null && ALLOWED_ORIGINS.includes(origin);

  if (site) {
    // Browser request — trust Sec-Fetch-Site.
    if (site === "cross-site" && !originAllowed) {
      return blocked(`sec-fetch-site=${site}`);
    }
    return NextResponse.next();
  }

  // No Sec-Fetch-Site. Either a non-browser client (allow) or an old browser.
  // For old browsers, block cross-origin requests that can change state, or any
  // cross-origin request to the all-powerful /mcp endpoint.
  if (origin && !originAllowed) {
    let crossOrigin = true;
    try {
      crossOrigin = new URL(origin).host !== req.headers.get("host");
    } catch {
      crossOrigin = true;
    }
    if (crossOrigin && (stateChanging || isMcp)) {
      return blocked("cross-origin");
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/mcp", "/mcp/:path*"],
};
