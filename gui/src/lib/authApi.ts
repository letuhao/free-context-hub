/**
 * Human-auth (F-AUTH) REST client for the GUI — `/api/auth/*`.
 *
 * COOKIE-BASED. The session is carried by an httpOnly, SameSite session cookie
 * that the backend SETS on `/login` (or `/mfa/verify`) and CLEARS on `/logout`.
 * This client therefore:
 *   - never reads or writes the session cookie from JS (it can't — httpOnly),
 *   - always sends `credentials: "same-origin"` so the browser attaches the
 *     cookie to same-origin `/api/*` calls through the single-port gateway, and
 *   - forwards the double-submit CSRF token as `X-CSRF-Token` on every
 *     state-changing request.
 *
 * CSRF CONTRACT (reconciled against src/services/sessions.ts +
 * middleware/sessionAuth.ts): the server returns `csrf_token` in the RESPONSE
 * BODY of login / mfa/verify / register. It is NOT a readable cookie. We store
 * it client-side (sessionStorage, surviving reloads within the tab) and send it
 * back as `X-CSRF-Token` on cookie-authed mutations (logout, session revoke,
 * mfa enroll). csrfGuard only checks it for cookie-authenticated requests.
 *
 * Base-URL resolution mirrors `api.ts` (same-origin in the browser; internal URL
 * on the server). These pages are all client components, so the browser branch
 * is the one that runs.
 */

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

const CSRF_STORAGE_KEY = "ch_csrf_token";

/** Persist the CSRF token the backend returned in a login/mfa/register body. */
export function storeCsrfToken(token: string | undefined | null): void {
  if (typeof sessionStorage === "undefined") return;
  if (token) sessionStorage.setItem(CSRF_STORAGE_KEY, token);
}

/** Read the stored double-submit CSRF token. Returns undefined before login. */
function readCsrfToken(): string | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  return sessionStorage.getItem(CSRF_STORAGE_KEY) ?? undefined;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export class AuthApiError extends Error {
  status: number;
  /** Machine-readable code from the backend when present (e.g. "mfa_required",
   *  "locked", "invalid_credentials"). */
  code?: string;
  body?: unknown;
  constructor(status: number, message: string, code?: string, body?: unknown) {
    super(message);
    this.name = "AuthApiError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (!SAFE_METHODS.has(method)) {
    const csrf = readCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }

  const res = await fetch(`${resolveApiBase()}${path}`, {
    method,
    headers,
    // Attach the session cookie to same-origin gateway calls.
    credentials: "same-origin",
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // 204 / empty-body responses (logout, revoke) return undefined.
  const text = await res.text().catch(() => "");
  let json: any = undefined;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }

  if (!res.ok) {
    const message = json?.error ?? json?.message ?? text ?? `HTTP ${res.status}`;
    throw new AuthApiError(res.status, message, json?.code, json);
  }
  return (json as T) ?? (undefined as T);
}

// ── Contract types (reconciled against src/api/routes/{auth,me}.ts) ──

/**
 * Auth state for the GUI. There is NO `/api/auth/me`; auth state comes from
 * GET /api/me (routes/me.ts). We expose a thin `authenticated` view derived
 * from whether a principal is bound + auth_enabled.
 */
export interface AuthMe {
  authenticated: boolean;
  auth_enabled: boolean;
  principal_id?: string;
  display_name?: string;
  role?: "reader" | "writer" | "admin";
  /** null = global scope; a string = project-scoped. Used to gate global-admin-only UI. */
  project_scope?: string | null;
}

/** Raw GET /api/me body (routes/me.ts MeResponse). */
interface MeBody {
  role: "reader" | "writer" | "admin";
  project_scope: string | null;
  auth_enabled: boolean;
  // 'session' (DEFERRED-060): cookie-authenticated human session.
  key_source: "no_auth" | "env_token" | "db_key" | "session";
  principal: {
    principal_id: string;
    display_name: string;
    kind: "human" | "agent" | "system";
    status: "active" | "suspended" | "retired";
    is_root: boolean;
    is_system: boolean;
  } | null;
}

/**
 * Result of POST /api/auth/login. On success the backend sets the session
 * cookie and returns { status:"ok", aal, csrf_token }. When MFA is enrolled it
 * returns { status:"mfa_required", email } (no cookie). There is NO
 * mfa_token/factors — the /mfa/verify step re-submits email+password+code.
 * Lockout returns 429 with retry_after_seconds.
 */
export interface LoginResult {
  status: "ok" | "mfa_required";
  /** Present on status:"ok". */
  aal?: 1 | 2;
  /** Present on status:"ok" — store and send as X-CSRF-Token on mutations. */
  csrf_token?: string;
  /** Echoed on status:"mfa_required" so the page can carry it into /mfa/verify. */
  email?: string;
}

/** GET /api/auth/sessions row (routes/auth.ts shape). */
export interface SessionInfo {
  session_id: string;
  aal: 1 | 2;
  created_at: string;
  last_seen: string | null;
  ip: string | null;
  user_agent: string | null;
  expires_at: string | null;
  current: boolean;
}

/**
 * MFA enrollment payload — POST /api/auth/mfa/enroll (routes/auth.ts +
 * services/mfa.ts). There is NO qr_data_url; the page renders otpauth_uri +
 * secret for manual authenticator entry.
 */
export interface MfaEnrollment {
  factor_id: string;
  secret: string;
  otpauth_uri: string;
  backup_codes: string[];
}

export const authApi = {
  // ── Session identity (from /api/me, NOT /api/auth/me) ──
  me: async (): Promise<AuthMe> => {
    const body = await request<MeBody>("GET", "/api/me");
    return {
      authenticated: body.principal != null,
      auth_enabled: body.auth_enabled,
      principal_id: body.principal?.principal_id,
      display_name: body.principal?.display_name,
      role: body.role,
      project_scope: body.project_scope,
    };
  },

  // ── Login / logout ──
  login: async (body: { email: string; password: string }): Promise<LoginResult> => {
    const res = await request<LoginResult>("POST", "/api/auth/login", body);
    if (res.status === "ok") storeCsrfToken(res.csrf_token);
    return res;
  },

  /**
   * Complete an MFA challenge. The backend re-resolves the principal from email
   * and re-verifies the password, so all three must be re-submitted. On success
   * it sets the session cookie + returns a fresh csrf_token.
   */
  verifyMfa: async (body: { email: string; password: string; code: string }) => {
    const res = await request<{ status: "ok"; aal: 1 | 2; csrf_token: string }>(
      "POST",
      "/api/auth/mfa/verify",
      body,
    );
    storeCsrfToken(res.csrf_token);
    return res;
  },

  logout: () => request<{ status: "ok" }>("POST", "/api/auth/logout"),

  // ── Password reset (never locks the account) ──
  forgotPassword: (body: { email: string }) =>
    // Always 200 with a neutral body to avoid user enumeration.
    request<{ status: "ok" }>("POST", "/api/auth/password/forgot", body),

  resetPassword: (body: { token: string; password: string }) =>
    request<{ status: "ok"; principal_id: string }>("POST", "/api/auth/password/reset", body),

  /** [DEFERRED-061] Non-secret preview of a live invite by token (email/display_name) for /register.
   *  Returns null when the token doesn't match a live invite (the API answers 404). */
  invitePreview: async (token: string): Promise<{ email: string; display_name: string | null; intended_kind: "human" | "agent"; expires_at: string } | null> => {
    try {
      return await request("GET", `/api/auth/invite?token=${encodeURIComponent(token)}`);
    } catch (err) {
      if (err instanceof AuthApiError && err.status === 404) return null;
      throw err;
    }
  },

  // ── Registration (invite-only: accept token → principal + AAL1 session) ──
  register: async (body: { token: string; password: string; display_name?: string }) => {
    const res = await request<{
      status: "created";
      principal_id: string;
      display_name: string;
      csrf_token: string;
    }>("POST", "/api/auth/register", body);
    storeCsrfToken(res.csrf_token);
    return res;
  },

  /** Begin MFA enrollment — returns factor_id + secret + otpauth_uri + backup codes. */
  enrollMfa: (body: { label?: string } = {}) =>
    request<MfaEnrollment>("POST", "/api/auth/mfa/enroll", body),

  /** Confirm enrollment with the first TOTP code (needs the factor_id from enroll). */
  confirmMfa: (body: { factor_id: string; code: string }) =>
    request<{ status: "verified" }>("POST", "/api/auth/mfa/enroll/verify", body),

  // ── Sessions management ──
  listSessions: () => request<{ sessions: SessionInfo[] }>("GET", "/api/auth/sessions"),

  revokeSession: (sessionId: string) =>
    request<{ status: "revoked"; session_id: string }>(
      "DELETE",
      `/api/auth/sessions/${encodeURIComponent(sessionId)}`,
    ),

  /** [DEFERRED-061] Revoke all of my sessions except the current one ("sign out everywhere else"). */
  revokeOtherSessions: () =>
    request<{ status: "ok"; revoked: number }>("POST", "/api/auth/sessions/revoke-others"),
};
