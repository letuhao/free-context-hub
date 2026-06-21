# Actor-Data-Boundary — Completion Plan (the human-facing half)

**Status:** PLAN (for next session) · **Date:** 2026-06-21 · **Branch:** `feature/actor-data-boundary` (not yet PR'd)
**Why this exists:** the branch built the **agent-facing** half of the actor-data-boundary (principals, grants,
`authorize()`, decision log, api-keys, the MCP tools, the hardened flip) but the **human-facing half** — the
governance GUI, human login (F-AUTH), and NHI hardening — was *designed with HTML drafts + backend services* and
then **never built and never tracked.** The `MCP_AUTH_ENABLED` flip even shipped ahead of F-AUTH, which the design
(`standards-gap.md` §3) defines as a precondition ("auth ON = human login enforced"). This doc is the durable
tracker that closes that gap. Grounded in a full draft-vs-GUI audit (6 parallel comparators, 2026-06-21).

> **Authoritative design sources:** `docs/specs/2026-06-19-actor-data-boundary-standards-gap.md` (F-AUTH + NHI),
> `…-mcp-fe-design.md` + `…-fe-mcp-eval.md` (governance GUI, gaps G1–G10), and the HTML drafts in
> `docs/gui-drafts/pages/` + `…/components/`. DEFERRED-041 (F-AUTH) / DEFERRED-042 (FE polish) are the stubs.

---

## 1. Draft-vs-GUI gap matrix (all 39 pages + 21 components)

**Legend:** ✅ built (often exceeds draft) · ⚠️ partial/regressed · ❌ missing entirely.

### Built and on-plan — NO work (the knowledge/project product)
`dashboard`, `dashboard-onboarding`, `onboarding`(→/getting-started), `lessons`, `lesson-types`, `review-inbox`
(→/review), `chat`, `guardrails`, `agent-audit`(→/agents), `notifications`(merged into /activity), `documents`,
`knowledge-docs/graph/search`, `extraction-mode-selector/progress/review`, `analytics`, `jobs`, `layout`,
`settings`, `settings-models`, `projects-overview`(v2), `project-create`(modal), `project-settings`,
`projects-git/groups/sources`. **Components:** 18/20 built (`ui/*`, `no-project-guard`, `project-selector`,
`rich-editor`). — *These exceed their drafts; verified, not re-listed below.*

### ⚠️ Minor / optional gaps (polish track)
| Item | Status | Gap | Size |
|---|---|---|---|
| `lesson-detail` | ⚠️ | slide-over built; missing "Related Lessons" (semantic) section; no deep-link `/lessons/[id]` | S |
| `settings-models` | ⚠️ | providers + feature-assignment persisted to localStorage only, not backend | S (skip if env-driven) |
| `extraction-mode-selector`/`-progress` | ⚠️ | whole-doc flow built; no per-page subset selection / per-page status+retry grid | S (skip if not required) |
| `feature-toggles` (component) | ⚠️ | logic inlined in project-settings; not a reusable component | XS (refactor only) |

### ❌ The three MISSING tracks (the real work)
| Draft | Track | Status |
|---|---|---|
| `identity.html` → /identity | Governance GUI | ❌ page + REST |
| `delegation.html` → /delegation | Governance GUI | ❌ page + REST |
| `authorization.html` → /authorization | Governance GUI | ❌ page + **decision-log read API (nothing reads `authz_decisions`)** |
| `bootstrap.html` → /bootstrap | Governance GUI | ❌ first-run wizard + REST |
| `sidebar-v3-governance.html` | Governance GUI | ❌ governance nav group + account footer + scope-gating |
| `access-control-v2.html` → /settings/access | Governance GUI | ⚠️ page exists but is the OLD role model; no principal binding / grants reframe |
| `login.html` → /login | F-AUTH | ❌ everything |
| `register.html` → /register | F-AUTH | ❌ everything |
| `sessions.html` → /settings/sessions | F-AUTH | ❌ everything |
| `nhi-access-review.html` → /governance/access-review | NHI | ❌ page + rotate/ephemeral/access-review API |

---

## 2. Track A — Governance GUI (the human half of F1/F2)

**Backend is built at the service+MCP layer; it has ZERO REST surface and ZERO GUI.** The single biggest backend
gap: the `authz_decisions` table is *written* (`authorize.ts:255`) but **nothing reads it** — the authorization
page needs a net-new read/query layer.

**Backend (new REST over existing services):**
- **[S]** `src/api/routes/principals.ts` — `GET /` (`listPrincipals`), `GET /:id` (+ join api_keys & grants),
  `POST /` (`createPrincipal`), `PATCH /:id/status` (`setPrincipalStatus`). Mount `/api/principals`. admin-gated.
- **[S]** `src/api/routes/grants.ts` — `GET /` (`listGrants`, filters), `POST /` (`grantCapability`),
  `DELETE /:id` (`revokeGrant`). Mount `/api/grants`. (Tree built client-side from `granted_by` edges.)
- **[M]** `src/api/routes/authorization.ts` — `GET /decisions` (**net-new** paginated/filtered/windowed read of
  `authz_decisions` + stats), `POST /explain` (`explainAuthorization`). Mount `/api/authz`.
- **[S]** `src/api/routes/bootstrap.ts` — `GET /status`, `POST /root` (`bootstrapRoot`), `POST /operator`,
  `POST /enforce` (`assertEnforceReady` + a "test-login-succeeded" lockout guard). Mount **before** `bearerAuth`
  (pre-auth), `ROOT_BOOTSTRAP_TOKEN`-gated.
- **[XS]** Extend `/api/me` → return the authenticated principal (REST `whoami`) for the sidebar footer.

**GUI (port from drafts):**
- **[M]** `gui/src/app/identity/page.tsx` — principal directory, root card, AUTH ON/OFF posture banner, slide-over
  (bound credentials [G7: mixed session+api_key] + grants + status control), empty/first-run states [G4].
- **[M]** `gui/src/app/delegation/page.tsx` — delegation tree (collapsible + lazy for scale [G8]) ⇄ flat table,
  grant modal w/ subtree-bound preview, revoke.
- **[M]** `gui/src/app/authorization/page.tsx` — stats, why-inspector (→ `/api/authz/explain`), decision log
  (reason tokens, tab filters, server-side windowing [G8]).
- **[S]** `gui/src/app/bootstrap/page.tsx` — 3-step pre-auth wizard (root token → operator account → enforce flip
  w/ lockout guard). No sidebar shell.
- **[S]** Rework `gui/src/app/settings/access/page.tsx` — surface `principal_id` per key, reframe role→grants,
  rename "Rebind"→"Revoke" (design §3b/G11).
- **[S]** `gui/src/components/sidebar.tsx` — add **Governance** group (Identity, Delegation, Authorization, NHI
  Access Review), Settings sub-items (Access Control, Sessions & Security), signed-in-as footer, scope-gated
  visibility. (G2 — without it the four pages are orphans.)

## 3. Track B — F-AUTH (human authentication) · closes DEFERRED-041

**Fully designed (`standards-gap.md` §3–6), zero built.** Per NIST 800-63B + OWASP ASVS V6. The shipped
gateway-token GUI shim (`gui/src/proxy.ts` + `CONTEXTHUB_GATEWAY_TOKEN`) is a **stopgap that violates the design**
(single shared super-credential) and must be **retired** once this lands.

**Backend:**
- **[M]** Migration `0071_human_auth.sql` — `human_credentials` (argon2id, failed_count, soft/hard lock),
  `mfa_factors`, `sessions` (aal, idle/absolute expiry, revoke), `invites`, `auth_tokens` (verify/reset).
- **[S]** add `argon2` dep; `src/services/passwordCredentials.ts` (hash/verify, ≥12-char + breach check).
- **[M]** `src/services/sessions.ts` (cookie httpOnly+SameSite, AAL, re-auth windows) + `src/api/middleware/sessionAuth.ts`
  wired ALONGSIDE `bearerAuth` (load-bearing ordering at `src/api/index.ts:101`) + CSRF for cookie state-changes.
- **[M]** `src/services/mfa.ts` (TOTP + WebAuthn + hashed backup codes).
- **[S]** `src/services/lockout.ts` (soft increasing-delay + hard, ≤100 fails/hr, **reset-never-locks**).
- **[S]** `src/services/invites.ts` (issue/accept → register principal, optional subtree-bounded starter grant).
- **[M]** `src/api/routes/auth.ts` — `/login`, `/mfa/verify`, `/logout`, `GET|DELETE /sessions`, `/register`,
  `/password/forgot|reset`, `/mfa/enroll`. Mount `/api/auth` **excluded from the blanket `bearerAuth` gate**.
- **[S]** `routes/invites.ts` (admin `POST /api/invites`).

**GUI (port from drafts):**
- **[M]** `gui/src/app/login/page.tsx` (password, MFA challenge, soft-lock, forgot, auth-off notice) + pre-auth shell.
- **[M]** `gui/src/app/register/page.tsx` (accept-invite, email-verify, MFA enroll, backup codes).
- **[S]** `gui/src/app/settings/sessions/page.tsx` (active sessions + revoke + auth policy [AAL/timeout]).
- **[S]** `gui/src/lib/api.ts` — `/api/auth/*` client; switch browser `/api` to session-cookie; **remove the
  gateway-token shim** from `proxy.ts` + `CONTEXTHUB_GATEWAY_TOKEN` from compose/.env.

## 4. Track C — NHI hardening · `standards-gap.md` §3 NHI

*(Note: `api_keys.expires_at` IS enforced at validate-time — `apiKeys.ts:276` — the spec row is stale. The real
gaps are below.)*
- **[M]** `GET /api/access-review` + `reviewApiKeys()` — age, last_used, unused-≥90d, never-expires, ownerless.
- **[M]** `POST /api/api-keys/:id/rotate` + `rotateApiKey()` — successor + overlap window, old auto-expires (txn).
- **[S]** `POST /api/api-keys/ephemeral` + `createEphemeralApiKey()` — short-TTL, principal-bound; MCP `mint_ephemeral_key`.
- **[S]** GUI: add **expiry field** (default ≠ Never) + **principal picker** to the generate modal in
  `settings/access/page.tsx` (currently sends neither — GUI keys are non-expiring + unbound).
- **[M]** GUI: `gui/src/app/governance/access-review/page.tsx` — stat cards + review table (revoke / set-expiry / rotate).

## 5. Polish track (P) — the ⚠️ items from §1
- **[S]** lesson-detail "Related Lessons" · **[S]** model-providers persistence (optional) ·
  **[S]** per-page extraction controls (optional) · **[XS]** extract `FeatureToggles` component (optional).

---

## 6. Parallel fan-out plan (file-disjoint streams + reconcile nodes)

Six streams. **Shared-file collision points** (per CLAUDE.md "never parallel-edit hub files"):
`src/api/index.ts` (route mounts — Streams 1,3,5), `gui/src/components/sidebar.tsx` (nav — Streams 1-GUI,3-GUI),
`package.json` (test list — all), `migrations/` (sequential numbers). **Mitigation:** each stream writes its own
NEW files; the three shared files are edited only at a **reconcile node** (one integrator applies all mounts/nav/test-list
edits in sequence) — OR run streams in worktrees and resolve the 3 hub files at merge.

| Stream | Owns (disjoint new files) | Depends on | Notes |
|---|---|---|---|
| **S1 Governance REST** | `src/api/routes/{principals,grants,authorization,bootstrap}.ts` + authz_decisions query | — | foundation for S2; mount at reconcile |
| **S2 Governance GUI** | `gui/src/app/{identity,delegation,authorization,bootstrap}/` + access rework | S1 endpoints (or mock) | sidebar edit at reconcile |
| **S3 F-AUTH backend** | `migrations/0071…`, `src/services/{passwordCredentials,sessions,mfa,lockout,invites}.ts`, `routes/{auth,invites}.ts`, `middleware/sessionAuth.ts` | — | **safety-sensitive** |
| **S4 F-AUTH GUI** | `gui/src/app/{login,register}/`, `settings/sessions/`, pre-auth shell; retire proxy shim | S3 endpoints | sidebar/footer at reconcile |
| **S5 NHI** | `apiKeys` service+route extensions, `governance/access-review/` page | — | rides on built api_keys |
| **S6 Polish** | lesson-detail, model-persist, extraction grids, FeatureToggles | — | independent, low-risk |

**Sequencing within streams:** schema → service → route → GUI. **S3 ordering is load-bearing:** password+sessions+lockout
before `routes/auth.ts`; `/api/auth/login|register|password/*` must be reachable WITHOUT a credential.

**Safety-sensitive (mandatory, CLAUDE.md policy):** S1 (authz decision-log exposure) and S3 (new authentication +
session + lockout primitive) each require a **cold-start hostile-actor adversary** (multi-pass) at REVIEW/POST-REVIEW.

---

## 7. Correcting the premature flip
The running stack is hardened (auth-ON) but has **no human login** — only the shared-admin gateway-token shim,
GUI bound to `0.0.0.0:3002`. Until F-AUTH (Track B) lands, recommended interim postures (pick one):
1. **Revert to dev** (`docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`) — no exposure; or
2. **Localhost-bind** the GUI (`127.0.0.1:3002:3000`) + treat the shim as explicitly temporary.
The re-flip to hardened is correct ONLY once human login is enforced (the design's actual definition of auth-ON).
