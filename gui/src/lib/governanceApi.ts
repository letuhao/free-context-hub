/**
 * Governance REST client (Stream S2 — actor-data-boundary completion).
 *
 * This module is the GUI client for the S1 governance routes (principals,
 * grants, authz, bootstrap) + the widened `/api/me`. Per the warp frozen
 * interface (§2.4), S2 owns its OWN client module and imports the shared
 * fetch/error helpers from `@/lib/api` WITHOUT modifying that file.
 *
 * The S1 routes are ABSENT at this slice's BASE commit — this client codes
 * to the DOCUMENTED contract in the completion plan §4 (S1 brief) and the
 * design doc (`2026-06-19-actor-data-boundary-mcp-fe-design.md`). The exact
 * request/response shapes here are the S1-contract assumptions recorded for
 * the integrator to reconcile against S1's actual responses.
 *
 * Endpoints assumed (S1 brief §4):
 *   GET  /api/principals                 → { principals: PrincipalSummary[] }
 *   GET  /api/principals/:id             → PrincipalDetail
 *   POST /api/principals                 → { principal: PrincipalSummary }
 *   PATCH /api/principals/:id/status     → { principal: PrincipalSummary }
 *   GET  /api/grants?...                 → { grants: GrantRow[] }
 *   POST /api/grants                     → { grant: GrantRow }
 *   DELETE /api/grants/:id               → { status: 'revoked' | 'noop' }
 *   GET  /api/authz/decisions?...        → { decisions: DecisionRow[]; total_count; stats }
 *   POST /api/authz/explain              → ExplainResult
 *   GET  /api/bootstrap/status           → BootstrapStatus      (pre-auth)
 *   POST /api/bootstrap/root             → { status; ... }      (pre-auth, token-gated)
 *   POST /api/bootstrap/operator         → { status; principal } (pre-auth)
 *   POST /api/bootstrap/enforce          → { status; ready }    (pre-auth)
 *   GET  /api/me                         → MeResponse (widened with `principal`)
 *   POST /api/api-keys                   → { key, key_id }       (S5-extended body)
 */

// ── Base / fetch helpers (mirrors api.ts; NOT importing private internals) ──
// We re-derive the same same-origin base resolution as api.ts so this module is
// self-contained and never edits the frozen api.ts. (§2.4: "import the base
// fetch/error helpers" — api.ts does not export `request`, so we reuse the same
// minimal logic here, which is the documented convention.)

function resolveApiBase(): string {
  if (typeof window !== "undefined") {
    return process.env.NEXT_PUBLIC_CONTEXTHUB_API_URL ?? "";
  }
  return (
    process.env.CONTEXTHUB_INTERNAL_API_URL ??
    process.env.NEXT_PUBLIC_CONTEXTHUB_API_URL ??
    "http://localhost:3001"
  );
}

const API_TOKEN = process.env.NEXT_PUBLIC_CONTEXTHUB_TOKEN;

async function gRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (API_TOKEN) headers["Authorization"] = `Bearer ${API_TOKEN}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  const res = await fetch(`${resolveApiBase()}${path}`, {
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

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) sp.set(k, String(v));
  }
  return sp.toString();
}

// ──────────────────────────────────────────────────────────────────────────
// Vocabulary types (verbatim from the design doc §1 — the frozen contract).
// ──────────────────────────────────────────────────────────────────────────

export type PrincipalKind = "human" | "agent" | "system";
export type PrincipalStatus = "active" | "suspended" | "retired";
export type Capability = "read" | "write" | "admin" | "delegate";
export type ScopeType = "global" | "project" | "topic" | "task" | "group";

/** Directory-row shape. The S1 `GET /api/principals` joins counts for the list. */
export interface PrincipalSummary {
  principal_id: string;
  kind: PrincipalKind;
  status: PrincipalStatus;
  display_name: string;
  is_root: boolean;
  is_system: boolean;
  created_at: string;
  /** join-derived counts (S1 list route); optional so a thin list still renders. */
  key_count?: number;
  grant_count?: number;
  last_seen_at?: string | null;
}

/** A credential bound to a principal (G7: mixed session + api_key). */
export interface BoundCredential {
  /** 'api_key' | 'session' — G7 dual-credential principal. */
  credential_type: "api_key" | "session";
  credential_id: string;
  name: string | null;
  key_prefix: string | null;
  status: "active" | "expired" | "revoked";
  expires_at: string | null;
  last_used_at: string | null;
}

export interface GrantRow {
  grant_id: string;
  grantee_principal: string;
  grantee_display_name?: string;
  grantee_kind?: PrincipalKind;
  scope_type: ScopeType;
  scope_id: string | null;
  capability: Capability;
  granted_by: string;
  granted_by_display_name?: string;
  granted_at: string;
  revoked_at: string | null;
}

export interface PrincipalDetail extends PrincipalSummary {
  credentials: BoundCredential[];
  grants: GrantRow[];
}

// ── Authorization decision-log + explain ──

export type DecisionResult = "allow" | "deny" | "reject";

/** One append-only authz.decision row (the S1 net-new read layer). */
export interface DecisionRow {
  decision_id: string;
  principal_id: string | null;
  principal_display_name: string | null;
  action: string;
  resource: string;
  result: DecisionResult;
  reason: string;
  matched_grant_id: string | null;
  created_at: string;
}

export interface DecisionStats {
  total: number;
  allowed: number;
  denied: number;
  root_short_circuits: number;
  /** allowed / total, 0..1 — UI renders as a percentage. */
  allow_rate: number;
}

export interface DecisionsPage {
  decisions: DecisionRow[];
  total_count: number;
  stats: DecisionStats;
}

/** Mirrors the backend ExplainResult (authorize.ts). */
export interface ExplainResult {
  decision: { allow: boolean; reason: string };
  matched_grant?: GrantRow | null;
  scope_chain: unknown | null;
}

// ── Bootstrap (pre-auth wizard) ──

export interface BootstrapStatus {
  has_root: boolean;
  has_operator: boolean;
  enforcement_enabled: boolean;
  /** checklist the enforce step gates on (bootstrap.html step 3). */
  ready: {
    root_established: boolean;
    operator_can_sign_in: boolean;
    mfa_enrolled: boolean;
    agent_key_count: number;
  };
}

// ── /api/me (widened by S1 to carry the authenticated principal) ──

export interface MePrincipal {
  principal_id: string;
  kind: PrincipalKind;
  status: PrincipalStatus;
  display_name: string;
  is_root: boolean;
  /** auth assurance level surfaced for the account footer badge (e.g. AAL1/AAL2). */
  aal?: string | null;
  /** the caller's strongest grant summary for the footer (e.g. "delegate@global"). */
  grant_summary?: string | null;
}

export interface MeResponse {
  role: "reader" | "writer" | "admin";
  project_scope: string | null;
  auth_enabled: boolean;
  key_source: "no_auth" | "env_token" | "db_key";
  /** widened by S1 — absent at BASE, so all consumers treat it as optional. */
  principal?: MePrincipal | null;
}

// ── Access-page key-create (S2 re-declares locally per §2.5; does NOT import nhiApi) ──

export interface CreateApiKeyRequest {
  name: string;
  role?: "reader" | "writer" | "admin";
  project_scope?: string;
  /** §2.5: expiry default ≠ Never (ISO timestamp). */
  expires_at: string;
  /** §2.5/§2.1: S5 wires the route passthrough; the binding is live once S5 merges. */
  principal_id?: string;
}

export interface CreateApiKeyResponse {
  key: string;
  key_id: string;
  principal_id?: string | null;
}

export interface ApiKeyItem {
  key_id: string;
  name: string;
  key_prefix: string;
  role: string;
  project_scope: string | null;
  expires_at: string | null;
  last_used_at: string | null;
  revoked: boolean;
  created_at: string;
  /** F1b/F2 — the principal this credential authenticates to. May be null on legacy keys. */
  principal_id?: string | null;
  principal_display_name?: string | null;
}

// ──────────────────────────────────────────────────────────────────────────
// Client surface.
// ──────────────────────────────────────────────────────────────────────────

export const governanceApi = {
  // ── Principals ──
  listPrincipals: () =>
    gRequest<{ principals: PrincipalSummary[] }>("GET", "/api/principals"),

  getPrincipal: (id: string) =>
    gRequest<PrincipalDetail>("GET", `/api/principals/${encodeURIComponent(id)}`),

  createPrincipal: (body: { kind: PrincipalKind; display_name: string }) =>
    gRequest<{ principal: PrincipalSummary }>("POST", "/api/principals", body),

  setPrincipalStatus: (id: string, status: PrincipalStatus) =>
    gRequest<{ principal: PrincipalSummary }>(
      "PATCH",
      `/api/principals/${encodeURIComponent(id)}/status`,
      { status },
    ),

  // ── Grants ──
  listGrants: (filter: { principal_id?: string; scope?: string; include_revoked?: boolean } = {}) =>
    gRequest<{ grants: GrantRow[] }>("GET", `/api/grants?${qs(filter)}`),

  grantCapability: (body: {
    grantee_principal: string;
    capability: Capability;
    scope_type: ScopeType;
    scope_id?: string | null;
  }) => gRequest<{ grant: GrantRow }>("POST", "/api/grants", body),

  revokeGrant: (grantId: string) =>
    gRequest<{ status: "revoked" | "noop" }>(
      "DELETE",
      `/api/grants/${encodeURIComponent(grantId)}`,
    ),

  // ── Authorization ──
  listDecisions: (params: {
    principal_id?: string;
    result?: "deny" | "reject" | "root";
    days?: number;
    limit?: number;
    offset?: number;
  } = {}) => gRequest<DecisionsPage>("GET", `/api/authz/decisions?${qs(params)}`),

  explain: (body: { principal_id?: string; action: string; resource: string }) =>
    gRequest<ExplainResult>("POST", "/api/authz/explain", body),

  // ── Bootstrap (pre-auth) ──
  bootstrapStatus: () =>
    gRequest<BootstrapStatus>("GET", "/api/bootstrap/status"),

  bootstrapRoot: (body: { token: string }) =>
    gRequest<{ status: string }>("POST", "/api/bootstrap/root", body),

  bootstrapOperator: (body: { email: string; password: string }) =>
    gRequest<{ status: string; principal?: PrincipalSummary }>(
      "POST",
      "/api/bootstrap/operator",
      body,
    ),

  bootstrapEnforce: (body: { acknowledged: boolean }) =>
    gRequest<{ status: string; ready: boolean }>("POST", "/api/bootstrap/enforce", body),

  // ── Identity (the widened me, §2.4 F5) ──
  me: () => gRequest<MeResponse>("GET", "/api/me"),

  // ── API keys (access page — S2 owns this client call per §2.5) ──
  listApiKeys: () => gRequest<{ keys: ApiKeyItem[] }>("GET", "/api/api-keys"),

  createApiKey: (body: CreateApiKeyRequest) =>
    gRequest<CreateApiKeyResponse>("POST", "/api/api-keys", body),

  revokeApiKey: (keyId: string) =>
    gRequest<{ status: string }>("DELETE", `/api/api-keys/${encodeURIComponent(keyId)}`),
};
