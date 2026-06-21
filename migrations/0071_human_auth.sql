-- Actor Data Boundary F-AUTH (Stream S3) — human authentication + session + lockout substrate.
--
-- Closes DEFERRED-041. Per NIST 800-63B (AAL1/AAL2, re-auth + idle windows) and OWASP ASVS V6
-- (soft + hard lockout, ≤100 fails/hr, reset MUST NOT lock, ≥12-char passwords). Design:
-- docs/specs/2026-06-19-actor-data-boundary-standards-gap.md §3–6.
--
-- The principal (F1, migration 0064) stays the SINGLE subject of authorize(). This migration adds
-- the *human* credential type: a password (argon2id) + optional MFA factors that establish a SESSION
-- (cookie), which then authenticates per-request. No change to the F2 grants / authorize() model.
--
-- Runs inside one transaction (src/db/applyMigrations.ts BEGIN/COMMIT per file). No CONCURRENTLY.

-- ── A. human_credentials — one password credential per (human) principal ──────────────────────────
-- OWASP ASVS V6: argon2id hash; soft-lock (transient, increasing-delay) vs hard-lock (sticky, admin
-- reset). failed_count drives the soft backoff. A reset/forgot flow MUST clear locks (ASVS 2.2.3),
-- never set them — enforced in the service layer, not here.
CREATE TABLE IF NOT EXISTS human_credentials (
  principal_id      UUID PRIMARY KEY REFERENCES principals(principal_id) ON DELETE CASCADE,
  -- argon2id PHC string ($argon2id$v=19$m=...,t=...,p=...$salt$hash). The full record carries its own
  -- params, so a later params bump re-verifies old hashes and can rehash-on-login transparently.
  password_hash     TEXT NOT NULL,
  pw_updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Soft lockout: count of CONSECUTIVE failed logins since the last success. Reset to 0 on success
  -- or on password reset. Drives the increasing-delay soft lock (service computes the window).
  failed_count      INTEGER NOT NULL DEFAULT 0,
  -- When set and in the future, login is soft-locked until this instant (transient — clears itself).
  soft_locked_until TIMESTAMPTZ NULL,
  -- Sticky hard lock (e.g. after crossing the hard threshold). Only an admin reset / password reset
  -- clears it. While true, login is refused regardless of soft window.
  hard_locked       BOOLEAN NOT NULL DEFAULT false,
  -- Last successful login (audit / inactivity review).
  last_login_at     TIMESTAMPTZ NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE human_credentials IS
  'Actor Data Boundary F-AUTH — password (argon2id) credential for human principals. Establishes a session. OWASP ASVS V6 soft/hard lockout.';
COMMENT ON COLUMN human_credentials.failed_count IS
  'Consecutive failed logins since last success; drives soft increasing-delay lock. Cleared on success and on password reset.';
COMMENT ON COLUMN human_credentials.soft_locked_until IS
  'Transient soft-lock expiry. Login refused while now() < this. Self-clearing — distinct from hard_locked.';
COMMENT ON COLUMN human_credentials.hard_locked IS
  'Sticky lock; cleared only by admin/password reset. Reset flow must NEVER set this (OWASP 2.2.3).';

-- ── B. mfa_factors — AAL2 second factors (TOTP / WebAuthn) ────────────────────────────────────────
-- A principal reaches AAL2 once it holds ≥1 VERIFIED factor. Backup codes are stored hashed in
-- backup_codes (sha256, single-use; the service strikes a code on use).
CREATE TABLE IF NOT EXISTS mfa_factors (
  factor_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id  UUID NOT NULL REFERENCES principals(principal_id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN ('totp', 'webauthn')),
  -- TOTP: the base32 shared secret (kept server-side; surfaced once as a QR data-URL at enroll time).
  -- WebAuthn: the credential public-key / id blob. Opaque to the data layer.
  secret        TEXT NOT NULL,
  -- Hashed (sha256) single-use recovery codes, JSON array of {hash, used_at|null}. NULL = none issued.
  backup_codes  JSONB NULL,
  label         TEXT NULL,
  verified_at   TIMESTAMPTZ NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE mfa_factors IS
  'Actor Data Boundary F-AUTH — MFA factors (TOTP/WebAuthn). A principal with >=1 verified factor authenticates at AAL2.';

CREATE INDEX IF NOT EXISTS mfa_factors_principal_idx ON mfa_factors (principal_id);
-- At most one VERIFIED totp factor per principal (re-enroll replaces). WebAuthn may hold several.
CREATE UNIQUE INDEX IF NOT EXISTS mfa_factors_one_verified_totp_uniq
  ON mfa_factors (principal_id) WHERE type = 'totp' AND verified_at IS NOT NULL;

-- ── C. sessions — cookie-backed session, NIST re-auth + idle windows, revocable ───────────────────
-- session_id is the opaque value; the cookie carries a SIGNED form of it (HMAC, service-side) so a
-- stolen DB row alone cannot forge a cookie, and a forged cookie without the signing secret is
-- rejected before any DB hit. aal records the level reached at establishment (1 password-only, 2 MFA).
CREATE TABLE IF NOT EXISTS sessions (
  session_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id    UUID NOT NULL REFERENCES principals(principal_id) ON DELETE CASCADE,
  aal             SMALLINT NOT NULL DEFAULT 1 CHECK (aal IN (1, 2)),
  -- CSRF double-submit token bound to this session (compared against the X-CSRF-Token header on
  -- cookie-authenticated state-changing requests).
  csrf_token      TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen       TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Absolute expiry (NIST re-auth window — e.g. 12h@AAL2 / 30d@AAL1). Past it ⇒ session invalid.
  expires_at      TIMESTAMPTZ NOT NULL,
  -- Idle expiry (NIST 15-min idle for AAL3; configurable). Slides forward on each authenticated hit.
  idle_expires_at TIMESTAMPTZ NOT NULL,
  ip              TEXT NULL,
  user_agent      TEXT NULL,
  -- Set on logout / admin revoke. A revoked session is invalid regardless of the expiry windows.
  revoked_at      TIMESTAMPTZ NULL
);

COMMENT ON TABLE sessions IS
  'Actor Data Boundary F-AUTH — human browser session. NIST 800-63B absolute + idle re-auth windows; revocable; AAL recorded.';
COMMENT ON COLUMN sessions.csrf_token IS
  'Per-session double-submit CSRF token; matched against X-CSRF-Token on cookie-auth state-changing requests.';

CREATE INDEX IF NOT EXISTS sessions_principal_idx ON sessions (principal_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at) WHERE revoked_at IS NULL;

-- ── D. invites — register = accept an invite issued by root/admin ─────────────────────────────────
-- An invite is the ONLY path to a new human principal (no open self-signup). It optionally carries a
-- subtree-bounded starter grant template applied when accepted. Single-use, short-TTL.
CREATE TABLE IF NOT EXISTS invites (
  invite_id       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- The opaque invite token is presented out-of-band; only its sha256 hash is stored (a leaked DB row
  -- cannot be redeemed). The email is the intended recipient (informational + verify binding).
  token_hash      TEXT NOT NULL UNIQUE,
  email           TEXT NOT NULL,
  intended_kind   TEXT NOT NULL DEFAULT 'human' CHECK (intended_kind IN ('human', 'agent')),
  display_name    TEXT NULL,
  -- Optional starter grant applied on accept: {scope_type, scope_id, capability}. NULL = no grant.
  grant_template  JSONB NULL,
  created_by      UUID NULL REFERENCES principals(principal_id) ON DELETE SET NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  accepted_at     TIMESTAMPTZ NULL,
  -- The principal created when the invite was accepted (audit trail).
  accepted_principal UUID NULL REFERENCES principals(principal_id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE invites IS
  'Actor Data Boundary F-AUTH — admin-issued, single-use, short-TTL invite. Register = accept invite → new principal (+ optional starter grant).';

CREATE INDEX IF NOT EXISTS invites_email_idx ON invites (email) WHERE accepted_at IS NULL;

-- ── E. auth_tokens — single-use, short-TTL email-verify / password-reset tokens ───────────────────
-- Only the sha256 hash is stored. purpose distinguishes verify vs reset. A reset token redemption
-- clears lockout (ASVS 2.2.3) — enforced in the service, recorded here as the single-use anchor.
CREATE TABLE IF NOT EXISTS auth_tokens (
  token_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  principal_id UUID NOT NULL REFERENCES principals(principal_id) ON DELETE CASCADE,
  purpose      TEXT NOT NULL CHECK (purpose IN ('email_verify', 'password_reset')),
  token_hash   TEXT NOT NULL UNIQUE,
  expires_at   TIMESTAMPTZ NOT NULL,
  consumed_at  TIMESTAMPTZ NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE auth_tokens IS
  'Actor Data Boundary F-AUTH — single-use short-TTL tokens (email_verify | password_reset). Hash-only storage; reset redemption clears lockout (OWASP 2.2.3).';

CREATE INDEX IF NOT EXISTS auth_tokens_principal_purpose_idx
  ON auth_tokens (principal_id, purpose) WHERE consumed_at IS NULL;
