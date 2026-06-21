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
 * Endpoints (reconciled against the ACTUAL S1 backend routes — src/api/routes/*):
 *   GET   /api/principals                → { principals: PrincipalSummary[] }
 *   GET   /api/principals/:id            → { principal, credentials, grants }
 *   POST  /api/principals                → { status:'created'; principal }
 *   PATCH /api/principals/:id/status     → { status:'updated'; principal }
 *   GET   /api/grants?...                → { grants: GrantRow[] }
 *   POST  /api/grants                    → { status:'created'; grant }
 *   DELETE /api/grants/:id               → { status; grant_id }
 *   GET   /api/authz/decisions?...       → { decisions: DecisionRow[]; next_cursor; stats }  (keyset)
 *   POST  /api/authz/explain             → { decision:{allow,reason,matched_grant_id?}; scope_chain }
 *   GET   /api/bootstrap/status          → BootstrapStatus      (pre-auth, token-gated)
 *   POST  /api/bootstrap/root            → { status; principal; key? }   (pre-auth, token-gated)
 *   POST  /api/bootstrap/operator        → { status:'created'; principal } (pre-auth, token-gated)
 *   POST  /api/bootstrap/enforce         → { status:'enforce_ready'; root_principal_id } (pre-auth, token-gated)
 *   GET   /api/me                        → MeResponse (carries `principal | null`)
 *   POST  /api/api-keys                  → { key, key_id, principal_id? }
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

async function gRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  extraHeaders?: Record<string, string>,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (API_TOKEN) headers["Authorization"] = `Bearer ${API_TOKEN}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (extraHeaders) Object.assign(headers, extraHeaders);

  const res = await fetch(`${resolveApiBase()}${path}`, {
    method,
    headers,
    // Same-origin so the session cookie rides along on browser calls (the
    // governance routes accept either a Bearer key or a session cookie).
    credentials: "same-origin",
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

/**
 * Directory-row shape — EXACTLY the columns `GET /api/principals` returns
 * (services/principals.ts Principal). The backend does NOT join key/grant
 * counts, so those are derived client-side from the detail endpoint when
 * needed; the optional fields below are kept so consumers degrade gracefully.
 */
export interface PrincipalSummary {
  principal_id: string;
  kind: PrincipalKind;
  status: PrincipalStatus;
  display_name: string;
  is_root: boolean;
  is_system: boolean;
  created_at: string;
}

/**
 * A credential bound to a principal — the raw api_keys row the
 * `GET /api/principals/:id` route returns under `credentials` (it filters
 * listApiKeys() to the principal; no `credential_type`/`status` synthesis).
 */
export interface BoundCredential {
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
}

/** One grant edge — EXACTLY the columns services/grants.ts returns (no joined
 *  display names; the GUI enriches names client-side from the principals list). */
export interface GrantRow {
  grant_id: string;
  grantee_principal: string;
  scope_type: ScopeType;
  scope_id: string | null;
  capability: Capability;
  granted_by: string;
  granted_at: string;
  revoked_at: string | null;
  /** Not returned by the backend — enriched client-side from the principals list. */
  grantee_display_name?: string;
  grantee_kind?: PrincipalKind;
  granted_by_display_name?: string;
}

/** Response of `GET /api/principals/:id` (route returns three siblings, not a flat merge). */
export interface PrincipalDetail {
  principal: PrincipalSummary;
  credentials: BoundCredential[];
  grants: GrantRow[];
}

// ── Authorization decision-log + explain ──

/** One row of the decision log — EXACTLY the authz_decisions columns
 *  (services/authzDecisions.ts AuthzDecisionRow). `allow` is a BOOLEAN. */
export interface DecisionRow {
  decision_id: string;
  ts: string;
  principal_id: string | null;
  action: string;
  resource_kind: string;
  resource_id: string | null;
  allow: boolean;
  reason: string;
  matched_grant_id: string | null;
  origin: string;
}

/** Aggregate roll-up over the same filter window (getAuthzDecisionStats). */
export interface DecisionStats {
  total: number;
  allowed: number;
  denied: number;
  by_reason: Record<string, number>;
  by_action: Record<string, number>;
  by_origin: Record<string, number>;
  distinct_principals: number;
}

/** Keyset-paginated page (NOT total_count/offset). */
export interface DecisionsPage {
  decisions: DecisionRow[];
  next_cursor: string | null;
  stats: DecisionStats;
}

/** Mirrors the backend ExplainResult (authorize.ts): the decision carries the
 *  matched grant id inline; there is no joined grant object. */
export interface ExplainResult {
  decision: { allow: boolean; reason: string; matched_grant_id?: string };
  scope_chain: unknown | null;
}

// ── Bootstrap (pre-auth wizard) ──

/** EXACTLY what `GET /api/bootstrap/status` returns (routes/bootstrap.ts). */
export interface BootstrapStatus {
  has_root: boolean;
  root_principal_id: string | null;
  has_usable_credential: boolean;
  enforce_ready: boolean;
  enforce_blocker: string | null;
}

// ── /api/me (carries the authenticated principal | null) ──

/** EXACTLY the MePrincipal subset the backend surfaces (routes/me.ts). No
 *  `aal`/`grant_summary` — those are NOT in the response. */
export interface MePrincipal {
  principal_id: string;
  display_name: string;
  kind: PrincipalKind;
  status: PrincipalStatus;
  is_root: boolean;
  is_system: boolean;
}

export interface MeResponse {
  role: "reader" | "writer" | "admin";
  project_scope: string | null;
  auth_enabled: boolean;
  key_source: "no_auth" | "env_token" | "db_key";
  /** The authenticated principal, or null when none is bound (env-token / auth-off). */
  principal: MePrincipal | null;
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

/** The bootstrap routes are token-gated (X-Bootstrap-Token). Helper that
 *  attaches the token header to a bootstrap call. */
function bootstrapHeaders(token: string): Record<string, string> {
  return { "X-Bootstrap-Token": token };
}

export const governanceApi = {
  // ── Principals ──
  listPrincipals: () =>
    gRequest<{ principals: PrincipalSummary[] }>("GET", "/api/principals"),

  getPrincipal: (id: string) =>
    gRequest<PrincipalDetail>("GET", `/api/principals/${encodeURIComponent(id)}`),

  createPrincipal: (body: { kind: PrincipalKind; display_name: string }) =>
    gRequest<{ status: string; principal: PrincipalSummary }>("POST", "/api/principals", body),

  setPrincipalStatus: (id: string, status: PrincipalStatus) =>
    gRequest<{ status: string; principal: PrincipalSummary }>(
      "PATCH",
      `/api/principals/${encodeURIComponent(id)}/status`,
      { status },
    ),

  // ── Grants ──
  // Backend filter keys: grantee_principal, scope_type, scope_id, granted_by, include_revoked.
  listGrants: (filter: {
    grantee_principal?: string;
    scope_type?: ScopeType;
    scope_id?: string;
    granted_by?: string;
    include_revoked?: boolean;
  } = {}) => gRequest<{ grants: GrantRow[] }>("GET", `/api/grants?${qs(filter)}`),

  grantCapability: (body: {
    grantee_principal: string;
    capability: Capability;
    scope_type: ScopeType;
    scope_id?: string | null;
  }) => gRequest<{ status: string; grant: GrantRow }>("POST", "/api/grants", body),

  revokeGrant: (grantId: string) =>
    gRequest<{ status: string; grant_id: string }>(
      "DELETE",
      `/api/grants/${encodeURIComponent(grantId)}`,
    ),

  // ── Authorization ── keyset-paginated; filters: principal_id, action, allow, origin, since, until, limit, cursor.
  listDecisions: (params: {
    principal_id?: string;
    action?: string;
    allow?: boolean;
    origin?: string;
    since?: string;
    until?: string;
    limit?: number;
    cursor?: string;
  } = {}) => gRequest<DecisionsPage>("GET", `/api/authz/decisions?${qs(params)}`),

  explain: (body: {
    principal_id?: string;
    action: string;
    resource: { kind: string; id?: string };
  }) => gRequest<ExplainResult>("POST", "/api/authz/explain", body),

  // ── Bootstrap (pre-auth, ROOT_BOOTSTRAP_TOKEN-gated on EVERY route incl. /status) ──
  bootstrapStatus: (token: string) =>
    gRequest<BootstrapStatus>("GET", "/api/bootstrap/status", undefined, bootstrapHeaders(token)),

  bootstrapRoot: (token: string, body: { display_name?: string } = {}) =>
    gRequest<{ status: string; principal: PrincipalSummary; key?: string }>(
      "POST",
      "/api/bootstrap/root",
      body,
      bootstrapHeaders(token),
    ),

  // [DEFERRED-063] Issues a single-use OPERATOR INVITE (not a bare principal); the operator then
  // registers at /register with the returned token to create their login.
  bootstrapOperator: (token: string, body: { email: string; display_name?: string }) =>
    gRequest<{ status: string; invite_id: string; invite_token: string; email: string; expires_at: string }>(
      "POST",
      "/api/bootstrap/operator",
      body,
      bootstrapHeaders(token),
    ),

  bootstrapEnforce: (token: string) =>
    gRequest<{ status: string; root_principal_id: string }>(
      "POST",
      "/api/bootstrap/enforce",
      {},
      bootstrapHeaders(token),
    ),

  // ── Identity (the widened me) ──
  me: () => gRequest<MeResponse>("GET", "/api/me"),

  // ── API keys (access page — S2 owns this client call per §2.5) ──
  listApiKeys: () => gRequest<{ keys: ApiKeyItem[] }>("GET", "/api/api-keys"),

  createApiKey: (body: CreateApiKeyRequest) =>
    gRequest<CreateApiKeyResponse>("POST", "/api/api-keys", body),

  revokeApiKey: (keyId: string) =>
    gRequest<{ status: string }>("DELETE", `/api/api-keys/${encodeURIComponent(keyId)}`),
};
