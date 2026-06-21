/**
 * Human-auth (F-AUTH) REST client for the GUI — `/api/auth/*`.
 *
 * COOKIE-BASED. The session is carried by an httpOnly, SameSite session cookie
 * that the backend SETS on `/login` (or `/mfa/verify`) and CLEARS on `/logout`.
 * This client therefore:
 *   - never reads or writes the cookie from JS (it can't — httpOnly),
 *   - always sends `credentials: "same-origin"` so the browser attaches the
 *     cookie to same-origin `/api/*` calls through the single-port gateway, and
 *   - forwards the double-submit CSRF token (read from the non-httpOnly
 *     `ch_csrf` cookie the backend issues alongside the session) on every
 *     state-changing request, per the S3 contract (§4 → middleware/sessionAuth
 *     "CSRF for cookie state-changes").
 *
 * This is a thin TYPED client coded against the DOCUMENTED S3 contract
 * (2026-06-21-actor-data-boundary-COMPLETION-plan §4 — "S3 — F-AUTH backend").
 * The S3 endpoints are ABSENT at this slice's BASE; the client compiles and the
 * pages render against it (or a mock) without S3 present. See the "S3 contract
 * assumptions" note in the slice report for the exact shapes assumed.
 *
 * Base-URL resolution mirrors `api.ts` (same-origin in the browser; internal URL
 * on the server) but is duplicated locally because `api.ts` is a FROZEN magnet
 * this slice must not edit (§2.4). These pages are all client components, so the
 * browser branch is the one that runs.
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

const CSRF_COOKIE = "ch_csrf";

/** Read the non-httpOnly double-submit CSRF token the backend issues with the
 *  session cookie. Returns undefined on the server or before first login. */
function readCsrfToken(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const m = document.cookie.match(new RegExp(`(?:^|; )${CSRF_COOKIE}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : undefined;
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

// ── S3 contract types (documented shapes; see slice report) ──

export interface AuthMe {
  authenticated: boolean;
  /** Present once a session exists. */
  principal_id?: string;
  email?: string;
  display_name?: string;
  /** Achieved assurance level for the current session. */
  aal?: 1 | 2;
  role?: "reader" | "writer" | "admin";
  /** Mirrors api.ts:getCurrentUser — true when MCP_AUTH_ENABLED. */
  auth_enabled: boolean;
}

/** Result of POST /api/auth/login. When MFA is required the backend returns
 *  `mfa_required` and a short-lived `mfa_token` to carry into /mfa/verify
 *  (no session cookie is set yet). When lockout trips it returns 429 with
 *  `retry_after_seconds`. On full success it sets the session cookie. */
export interface LoginResult {
  status: "ok" | "mfa_required";
  mfa_required?: boolean;
  /** Opaque token threaded into /mfa/verify; never a credential. */
  mfa_token?: string;
  /** Factors offered for the challenge. */
  factors?: Array<"totp" | "webauthn" | "backup_code">;
  me?: AuthMe;
}

export interface SessionInfo {
  session_id: string;
  /** This is the session making the request. */
  current: boolean;
  user_agent: string | null;
  /** Pretty device label derived server-side, e.g. "Chrome on Windows". */
  device_label: string | null;
  ip: string | null;
  location: string | null;
  aal: 1 | 2;
  mfa: boolean;
  created_at: string;
  last_active_at: string | null;
  /** ISO timestamps for the policy windows, when computed server-side. */
  idle_expires_at: string | null;
  absolute_expires_at: string | null;
  /** Anomaly flag, e.g. login from a new location. */
  flagged?: boolean;
}

export interface AuthPolicy {
  require_mfa: boolean;
  /** Re-auth (absolute) window, seconds. */
  reauth_window_seconds: number;
  /** Idle timeout, seconds. */
  idle_timeout_seconds: number;
  /** Read-only summary of brute-force protection posture. */
  lockout_enforced: boolean;
}

/** MFA enrollment payload — the backend issues a server-rendered QR as a
 *  data-URL so the GUI needs NO browser QR dependency (§2.7 / M1: dep-free). */
export interface MfaEnrollment {
  /** otpauth:// URI (also usable to render a QR client-side if ever needed). */
  otpauth_uri: string;
  /** PNG/SVG data-URL of the QR, rendered server-side. The page just <img>s it. */
  qr_data_url: string;
  /** Base32 secret shown as the manual-entry fallback. */
  secret: string;
}

export interface BackupCodesResult {
  /** Shown exactly once; stored hashed server-side. */
  backup_codes: string[];
}

export interface InvitePreview {
  email: string;
  inviter_display_name: string | null;
  kind: "human" | "agent";
  expires_at: string;
  /** Already-accepted / expired invites surface here so the page can refuse. */
  valid: boolean;
}

export const authApi = {
  // ── Session identity ──
  me: () => request<AuthMe>("GET", "/api/auth/me"),

  // ── Login / logout ──
  login: (body: { email: string; password: string }) =>
    request<LoginResult>("POST", "/api/auth/login", body),

  /** Complete an MFA challenge. On success the backend sets the session cookie. */
  verifyMfa: (body: {
    mfa_token: string;
    method: "totp" | "webauthn" | "backup_code";
    code?: string;
    /** WebAuthn assertion JSON, when method === "webauthn". */
    assertion?: unknown;
  }) => request<{ status: "ok"; me?: AuthMe }>("POST", "/api/auth/mfa/verify", body),

  logout: () => request<void>("POST", "/api/auth/logout"),

  // ── Password reset (never locks the account) ──
  forgotPassword: (body: { email: string }) =>
    // Always 200 with a neutral body to avoid user enumeration.
    request<{ status: "ok" }>("POST", "/api/auth/password/forgot", body),

  resetPassword: (body: { token: string; password: string }) =>
    request<{ status: "ok" }>("POST", "/api/auth/password/reset", body),

  // ── Registration (invite-only) ──
  getInvite: (token: string) =>
    request<InvitePreview>("GET", `/api/auth/register?token=${encodeURIComponent(token)}`),

  /** Accept an invite: registers the principal + sets the password. Returns the
   *  authenticated `me` but registration is not complete until MFA is enrolled. */
  register: (body: { token: string; display_name: string; password: string }) =>
    request<{ status: "ok"; me?: AuthMe }>("POST", "/api/auth/register", body),

  /** Begin MFA enrollment — returns the server-rendered QR data-URL + secret. */
  enrollMfa: () => request<MfaEnrollment>("POST", "/api/auth/mfa/enroll"),

  /** Confirm enrollment with the first TOTP code; returns one-time backup codes. */
  confirmMfa: (body: { code: string }) =>
    request<BackupCodesResult>("POST", "/api/auth/mfa/enroll/confirm", body),

  // ── Sessions management ──
  listSessions: () => request<{ sessions: SessionInfo[] }>("GET", "/api/auth/sessions"),

  revokeSession: (sessionId: string) =>
    request<void>("DELETE", `/api/auth/sessions/${encodeURIComponent(sessionId)}`),

  /** Revoke every session except the current one. */
  revokeOtherSessions: () => request<void>("DELETE", "/api/auth/sessions?scope=others"),

  // ── Auth policy (admin/root; read for everyone) ──
  getPolicy: () => request<AuthPolicy>("GET", "/api/auth/policy"),

  updatePolicy: (body: Partial<AuthPolicy>) =>
    request<AuthPolicy>("PATCH", "/api/auth/policy", body),
};
