/**
 * Actor Data Boundary — Stream S5 (NHI hardening) GUI client.
 *
 * Own client module per the COMPLETION-plan §2.4 convention: no slice edits the
 * shared gui/src/lib/api.ts. This module talks to the S5 backend surface only:
 *   - GET  /api/access-review            (log-based access review + stats)
 *   - POST /api/api-keys/:id/rotate       (mint successor + bounded overlap)
 *   - POST /api/api-keys/ephemeral        (short-TTL principal-bound credential)
 *   - DELETE /api/api-keys/:id            (revoke — reused on the review table)
 *   - PATCH (set-expiry) is expressed as a re-mint-free rotate w/ overlap; the
 *     "set expiry" row action simply revokes-and-replaces via rotate when needed.
 *
 * Browser → same-origin relative URLs (the single-port gateway proxies /api/*).
 */

const BASE = typeof window !== "undefined"
  ? (process.env.NEXT_PUBLIC_CONTEXTHUB_API_URL ?? "")
  : (process.env.CONTEXTHUB_INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_CONTEXTHUB_API_URL ?? "http://localhost:3001");
const TOKEN = process.env.NEXT_PUBLIC_CONTEXTHUB_TOKEN;

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let message: string;
    try {
      message = JSON.parse(text).error ?? text;
    } catch {
      message = text || `HTTP ${res.status}`;
    }
    throw new Error(`API error (${res.status}): ${message}`);
  }
  return res.json() as Promise<T>;
}

// ── Shapes (mirror the S5 backend) ──

export interface AccessReviewKey {
  key_id: string;
  name: string;
  key_prefix: string;
  role: string;
  project_scope: string | null;
  expires_at: string | null;
  last_used_at: string | null;
  revoked: boolean;
  created_at: string;
  principal_id: string | null;
  principal_name: string | null;
  age_days: number;
  days_since_used: number | null;
  unused_90d: boolean;
  never_expires: boolean;
  ownerless: boolean;
}

export interface AccessReviewStats {
  total_active: number;
  unused_90d: number;
  never_expires: number;
  ownerless: number;
}

export interface AccessReviewResult {
  stats: AccessReviewStats;
  keys: AccessReviewKey[];
}

export interface RotateResult {
  status: "rotated";
  key: string;
  previous_key_id: string;
  old_expires_at: string | null;
  key_id: string;
  name: string;
  key_prefix: string;
  role: string;
  project_scope: string | null;
  expires_at: string | null;
  principal_id: string | null;
}

export interface EphemeralResult {
  status: "created";
  key: string;
  expires_at: string;
  key_id: string;
  name: string;
  key_prefix: string;
  role: string;
  principal_id: string | null;
}

export const nhiApi = {
  /** Log-based access review: at-risk keys + stat-card counts. */
  accessReview: () => request<AccessReviewResult>("GET", "/api/access-review"),

  /**
   * Rotate a key — mint a successor bound to the same principal/role/scope. The
   * old key auto-expires after `overlap_ms` (default server-side 7d; 0 = revoke now).
   */
  rotateKey: (keyId: string, overlapMs?: number) =>
    request<RotateResult>("POST", `/api/api-keys/${keyId}/rotate`, overlapMs === undefined ? {} : { overlap_ms: overlapMs }),

  /** Mint a short-TTL, principal-bound credential. `ttlMs` default 1h, capped 24h. */
  mintEphemeral: (params: { name: string; role?: string; project_scope?: string; principal_id?: string; ttlMs?: number }) =>
    request<EphemeralResult>("POST", "/api/api-keys/ephemeral", {
      name: params.name,
      role: params.role,
      project_scope: params.project_scope,
      principal_id: params.principal_id,
      ttl_ms: params.ttlMs,
    }),

  /** Revoke a key (review-table row action). */
  revokeKey: (keyId: string) => request<{ status: string; key_id: string }>("DELETE", `/api/api-keys/${keyId}`),
};
