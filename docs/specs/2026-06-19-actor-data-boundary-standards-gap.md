# Actor Data Boundary — Industry-standards gap + human-auth & NHI extension

**Status:** DESIGN (drafts) · **Date:** 2026-06-19 · **Branch:** `feature/actor-data-boundary`
**Parents:** [`-FOUNDATION.md`](./2026-06-19-actor-data-boundary-FOUNDATION.md) · [`-mcp-fe-design.md`](./2026-06-19-actor-data-boundary-mcp-fe-design.md)
**Closes (at design level):** DEFERRED-041 (browser session-login auth).

> Prompted by: "what do industry standards have vs. what we have? there's no register/login/permission
> screen?" — correct. The foundation covers the **authorization / delegation / machine-identity** axis
> (ahead of the curve for *agent* governance) but had **no human-authentication axis** at all. This doc
> records the gap against the standards and adds the two missing surfaces: **human AuthN** and **NHI
> hardening**, *without* changing the authorize()/grants model.

---

## 1. The three standard axes (what mature IAM has)

| Axis | Standard surfaces | Standards reference |
|---|---|---|
| **Human AuthN** | login, register/invite, SSO, **MFA** enroll+challenge, forgot/reset, email verify, **session mgmt** (active sessions, timeout, revoke), lockout | NIST 800-63B (AAL1 single / **AAL2 = MFA** / AAL3 hardware; re-auth 30d@AAL1, 12h+15min-idle@AAL3); OWASP ASVS V6 (soft/hard lockout, ≤100 fails/hr, reset must not lock out, ≥12-char passwords, anti-automation) |
| **AuthZ** | principals/users, groups, roles, permissions/policies, audit, access reviews | — (covered by foundation: grants + `authorize()` + decision log) |
| **Machine / NHI** | API keys/service accounts, **short-lived/ephemeral creds**, rotation+expiry, **access review (used in last 90d?)**, named owner, revalidate-before-prod | NHI governance best-practice (Okta / Token Security / Veza, 2025) |

## 2. Gap snapshot (✅ have · ⚠️ partial · ❌ missing)

```
Human AuthN     login ❌  register/invite ❌  MFA ❌  reset ❌  session-mgmt ❌  lockout ❌
AuthZ           principals ✅*  grants/roles ✅*  audit ✅  least-priv-scope ✅*  access-review ❌
Machine / NHI   api-keys ✅  rotation/expiry ⚠️(field exists, default Never, not enforced)
                ephemeral creds ❌  access-review(unused-90d) ❌  named-owner ⚠️(via principal)
                guardrails/policy ✅ (we exceed: runtime guardrails)
```
`*` = designed in the foundation drafts, not yet built.

**Reading:** we are *ahead* on agent governance (agents authenticate by API key = the modern machine-identity
pattern, no human login needed for them) and *behind* on the **human operator** browser login — exactly the
DEFERRED-041 hole. The foundation's `auth-off = single trusted operator` posture is valid *until* the gateway
is exposed to an untrusted network; this doc designs what must exist *before* that exposure.

---

## 3. Model extension — one subject, several credential types (no authz change)

The **principal** stays the single subject of `authorize()`. What we add is that a principal can be reached
by **more than one kind of credential**, and humans get a **session**:

```
Principal (human|agent|system)
  ├── credential: api_key            → used by agents (existing)         → authenticates directly per request
  └── credential: password + MFA     → used by humans (NEW)              → establishes a Session (cookie)
                                                                            → session authenticates per request
```

New tables/fields (F-AUTH phase; layered on F1 identity, does not alter F2 grants):

| Object | Fields | Notes |
|---|---|---|
| `human_credentials` | `principal_id`, `password_hash` (argon2id), `pw_updated_at`, `failed_count`, `soft_locked_until`, `hard_locked` | OWASP: soft vs hard lock; ≥12 chars; never lock via reset |
| `mfa_factors` | `principal_id`, `type` (totp\|webauthn), `secret/credential`, `verified_at` | AAL2 when ≥1 verified factor present |
| `sessions` | `session_id`, `principal_id`, `aal` (1\|2), `created_at`, `last_seen`, `expires_at`, `idle_expires_at`, `ip`, `user_agent`, `revoked_at` | NIST re-auth windows; revocable |
| `invites` | `invite_id`, `email`, `intended_kind`, `grant_template?`, `expires_at`, `accepted_at`, `created_by` | register = accept invite; root/admin issues |
| email-verify / reset tokens | single-use, short-TTL, rate-limited | reset MUST NOT lock the account (OWASP 2.23) |

NHI hardening fields (extend existing `api_keys`):

| Field / surface | Behavior |
|---|---|
| `api_keys.expires_at` | **enforced**; UI default no longer "Never" for agent keys |
| ephemeral keys | opt-in short-TTL (minutes/hours) credential for CI / one-shot agents |
| `api_keys.last_used_at` (exists) | feeds **access review**: "unused ≥90d → suggest revoke" |
| rotation | "rotate" action mints a successor + overlap window; old key auto-expires |
| named owner | already the bound principal; access-review surfaces ownerless/stale keys |

### Posture interaction (unchanged spirit)
- **auth OFF** = single-operator/dev: no human login required, caller = root/dev. (Today.)
- **auth ON** = human login enforced (session + AAL policy), agent keys enforced + scoped. Required before
  any untrusted-network exposure. This is the state the human-auth drafts depict.

---

## 4. MCP / API surface added

Human auth is **browser/REST**, not MCP (agents never log in). New REST endpoints (behind the gateway):
`POST /api/auth/login` (→ session, may require MFA step), `POST /api/auth/mfa/verify`,
`POST /api/auth/logout`, `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`,
`POST /api/auth/register` (accept invite), `POST /api/auth/password/forgot|reset`,
`POST /api/auth/mfa/enroll`. Admin: `POST /api/invites`, `GET /api/access-review`.

NHI additions (REST + MCP where an agent self-manages): `POST /api/keys/:id/rotate`,
`POST /api/keys/ephemeral`, plus the access-review read. No change to `authorize()` or the grant tools.

---

## 5. FE drafts produced (this pass)
- `docs/gui-drafts/pages/login.html` — login, MFA challenge, soft/hard lockout, forgot-password entry, auth-off notice.
- `docs/gui-drafts/pages/register.html` — invite accept / signup, email verify, password policy meter, MFA enroll (TOTP/WebAuthn).
- `docs/gui-drafts/pages/sessions.html` — active sessions (revoke, current device), auth policy (AAL/MFA required, timeout windows).
- `docs/gui-drafts/pages/nhi-access-review.html` — key rotation/expiry/ephemeral, access-review table (last-used, age, unused-90d → revoke).

## 6. Build sequencing (where this slots in F1–F4)
Human-auth is a **new phase F-AUTH**, sequenced *after* F1 (needs principals) and runnable in parallel with
F2/F3 (independent of grants). NHI hardening is small and rides on F1's `api_keys → principal`. Neither
changes the F2 boundary. **DEFERRED-041 → "designed; build in F-AUTH"** (no longer just a deferred stub).

## 7. Out of scope (still DLF-growth track)
Full SSO/SAML/OIDC federation, IAL identity-proofing (document verification), risk-based/adaptive auth,
SCIM provisioning. Note for later: these attach to the same principal + session model without a rewrite.
