# Actor-Data-Boundary — Completion Plan (the human-facing half) · `/warp`

**Status:** PLAN — warp DESIGN+PLAN complete · **REVIEW(des) GO** (slicing cleared, 3 adversary passes, §6) ·
BUILD fan-out awaits PO go · **Date:** 2026-06-21
**Branch:** `feature/actor-data-boundary` (not yet PR'd) · **Mode:** `/warp` (6 file-disjoint streams)

**Why this exists:** the branch built the **agent-facing** half of the actor-data-boundary (principals, grants,
`authorize()`, decision log, api-keys, the MCP tools, the hardened `MCP_AUTH_ENABLED` flip) but the
**human-facing half** — the governance GUI, human login (F-AUTH), and NHI hardening — was *designed with HTML
drafts + backend services* and then **never built and never tracked.** The flip even shipped ahead of F-AUTH,
which the design (`standards-gap.md` §3) defines as its precondition ("auth ON = human login enforced"). This doc
is the durable warp execution plan that closes that gap. Grounded in a full draft-vs-GUI audit (6 parallel
comparators, 2026-06-21) and a fresh code-state verification pass (2026-06-21, recorded inline below).

> **Authoritative design sources:** `docs/specs/2026-06-19-actor-data-boundary-standards-gap.md` (F-AUTH + NHI),
> `…-mcp-fe-design.md` + `…-fe-mcp-eval.md` (governance GUI, gaps G1–G10), the HTML drafts in
> `docs/gui-drafts/pages/` + `…/components/`. DEFERRED-041 (F-AUTH) / DEFERRED-042 (FE polish) / DEFERRED-058 are
> the stubs this plan discharges.

---

## 0. TRIAGE-pre — parallelization rubric (warp gate)

| # | Question | Answer |
|---|---|---|
| 1 | ≥2 independent boundaries? | **YES** — governance REST/GUI, human-auth backend/GUI, NHI, and polish are four conceptually separate surfaces. |
| 2 | Write-sets path-prefix disjoint? | **YES, after the §2 frozen interface resolves three magnets** (`src/api/index.ts` mounts, `sidebar.tsx` nav, `settings/access/page.tsx`, `gui/src/lib/api.ts`). Without that resolution they collide — so the resolution is mandatory, not optional. |
| 3 | Can the shared interface be FROZEN now? | **YES** — all referenced services already exist (verified §2.6); the only shared decisions are route-mount order, the one migration number, the nav contract, and the GUI-client module convention. All settled in §2. |
| 4 | No shared-write magnet hidden in a slice? | **YES, by construction** — §2 hoists every magnet (`index.ts`, `sidebar.tsx`, migration counter, `api.ts`, `access/page.tsx`) OUT of the slices into the frozen interface or a single owner. |

**Verdict: GO for `/warp`.** Bias-to-serial check: the work is genuinely additive across four surfaces with a
freezable contract; serial `/loom` would cost ~4× wall-clock for no safety gain once the magnets are hoisted.

---

## 1. Draft-vs-GUI gap matrix (condensed — full audit in commit 976fd16)

**Legend:** ✅ built (often exceeds draft) · ⚠️ partial/regressed · ❌ missing entirely.

**Built, NO work** (the knowledge/project product): dashboard, lessons, lesson-types, review, chat, guardrails,
agents, activity, documents, knowledge/{docs,graph,search}, extraction-*, analytics, jobs, settings,
settings/models, projects/{overview,groups,git,sources}, project-create/settings. 18/20 components built.

**⚠️ Polish gaps → Stream S6:**
| Item | Gap | Size |
|---|---|---|
| `lesson-detail` | slide-over built; missing "Related Lessons" (semantic) + no deep-link `/lessons/[id]` | S |
| `settings/models` | providers + feature-assignment persisted to localStorage only, not backend | S (skip if env-driven) |
| `extraction-mode-selector`/`-progress` | whole-doc flow built; no per-page subset selection / per-page status+retry grid | S (skip if not required) |
| `feature-toggles` | logic inlined in project-settings; not a reusable component | XS (refactor only) |

**❌ The three MISSING tracks (the real work):**
| Draft | Family | Status |
|---|---|---|
| `identity.html` → /identity | A Governance | ❌ page + REST |
| `delegation.html` → /delegation | A Governance | ❌ page + REST |
| `authorization.html` → /authorization | A Governance | ❌ page + **decision-log read API (nothing reads `authz_decisions` — verified §2.6)** |
| `bootstrap.html` → /bootstrap | A Governance | ❌ first-run wizard + REST |
| `sidebar-v3-governance.html` | A Governance | ❌ governance nav group + account footer + scope-gating |
| `access-control-v2.html` → /settings/access | A Governance | ⚠️ exists but is the OLD role model; no principal binding / grants reframe |
| `login.html` → /login | B F-AUTH | ❌ everything |
| `register.html` → /register | B F-AUTH | ❌ everything |
| `sessions.html` → /settings/sessions | B F-AUTH | ❌ everything |
| `nhi-access-review.html` → /governance/access-review | C NHI | ❌ page + rotate/ephemeral/access-review API |

---

## 2. FROZEN INTERFACE (no slice may edit these decisions or files)

These are the shared surfaces. Every value below is settled now; the BUILD slices treat them as **read-only
contract**. The files named here are touched **only at the reconcile node** by a single integrator, or by the
single owner named.

### 2.1 Route-mount table — `src/api/index.ts` (RECONCILE-NODE file, integrator only)
Mount order is load-bearing: the blanket gate is `app.use('/api', bearerAuth)` at `src/api/index.ts:101`.
Pre-auth routes MUST mount **before** line 101; everything else after.

| Path | Router (new file) | Position vs `bearerAuth` | Stream | Gate |
|---|---|---|---|---|
| `/api/auth` | `routes/auth.ts` | **BEFORE** (excluded from blanket gate) | S3 | none (login/register/reset reachable w/o credential) |
| `/api/bootstrap` | `routes/bootstrap.ts` | **BEFORE** (pre-auth) | S1 | `ROOT_BOOTSTRAP_TOKEN` |
| `/api/principals` | `routes/principals.ts` | after | S1 | admin |
| `/api/grants` | `routes/grants.ts` | after | S1 | admin |
| `/api/authz` | `routes/authorization.ts` | after | S1 | admin |
| `/api/invites` | `routes/invites.ts` | after | S3 | admin |
| `/api/access-review` | extends `routes/apiKeys.ts`* | after | S5 | admin |
| `/api/api-keys/:id/rotate`, `/api/api-keys/ephemeral` | extends `routes/apiKeys.ts`* | after | S5 | admin |

\* **`routes/apiKeys.ts` is owned exclusively by S5** for this warp (it is already mounted; S5 adds handlers inside
it, no new mount line → no `index.ts` edit needed for the api-key extensions; only `/api/access-review` needs a
new mount line, applied at reconcile).

**Rule:** no slice edits `src/api/index.ts`. Each route-owning slice exports its router from its own new file and
records its required mount line in its brief; the integrator applies all mount lines in the order above at §5.

### 2.2 Migration allocation (the one-migration-per-warp magnet)
- **`migrations/0071_human_auth.sql` is allocated to S3 (F-AUTH) ONLY.** Latest on branch = `0070` (verified).
  (Note: a pre-existing duplicate `0067_*` pair exists — allocate `0071` strictly by max-number, not file-count.)
- **All other streams are migration-free.** Confirmed:
  - S1 governance: pure REST over existing tables (`principals`, `grants`, `authz_decisions`) — no DDL.
  - S5 NHI: rotation = `createApiKey` successor + `UPDATE api_keys SET expires_at` (overlap window); ephemeral =
    `createApiKey` with short `expires_at`. `api_keys` already has `expires_at`, `last_used_at`, `principal_id`,
    `revoked` (mig 0041/0064). **No new column required.** Optional key-lineage column (`succeeded_by`) is
    **deferred** — do NOT add it in this warp (would create a second migration magnet).
- No slice other than S3 may add a file under `migrations/`.

### 2.3 Sidebar nav contract — `gui/src/components/sidebar.tsx` (RECONCILE-NODE file, integrator only)
Current `NAV_ITEMS` is a flat grouped array (verified). The integrator adds, at reconcile, exactly one new
**Governance** group + an account footer, per this frozen spec — no slice edits the file:
```
Governance (new group, scope-gated: visible only to admin principals)
  /identity              "Identity"            (S2 page)
  /delegation            "Delegation"          (S2 page)
  /authorization         "Authorization"       (S2 page)
  /governance/access-review  "NHI Access Review" (S5 page)
Settings (existing group — add two sub-items)
  /settings/access       "Access Control"      (exists; S2 reworks the page)
  /settings/sessions     "Sessions & Security" (S4 page)
Account footer (new): "signed in as {principal.display_name}" + sign-out → reads /api/me (S1 extension)
```
Each GUI slice records its nav line(s) in its brief; the integrator transcribes them. `/bootstrap`, `/login`,
`/register` are **pre-auth, NOT in the sidebar** — shell suppression is the integrator's `layout.tsx` gate (§2.10),
not a per-page concern.

### 2.4 GUI API-client convention (resolves the `gui/src/lib/api.ts` magnet)
`gui/src/lib/api.ts` is a shared magnet (S2/S4/S5 all need clients). **Resolution:** no slice edits it. Each GUI
slice creates its **own** client module and imports it directly in its pages:
- S2 → `gui/src/lib/governanceApi.ts` (principals, grants, authz, bootstrap, me)
- S4 → `gui/src/lib/authApi.ts` (login, mfa, logout, sessions, register, password)
- S5 → `gui/src/lib/nhiApi.ts` (access-review, rotate, ephemeral, expiry/principal on create)
The base `fetch`/error helpers in `api.ts` are **read-only** to slices (import, don't modify).
- **The `me`/principal field (F5):** the shared `api.ts:getCurrentUser()` and backend `MeResponse` currently lack
  `principal`/`display_name`. The backend widening is **S1** (owns `me.ts`). On the GUI side, no slice touches
  frozen `api.ts:getCurrentUser` — instead **S2's `governanceApi.ts` exposes `me()`** returning the widened
  principal, and the integrator's sidebar account-footer reads `governanceApi.me()` (NOT `api.getCurrentUser()`).
- **Key-create client (F2):** S2 does NOT reuse `api.createApiKey` (no `principal_id` field) and does NOT import
  `nhiApi` (unavailable in S2's isolated worktree). S2's `governanceApi.ts` declares its own key-create call
  (with `principal_id` + `expires_at`) — see §2.5.

### 2.5 `settings/access/page.tsx` single-owner rule (resolves the S2∩S5 magnet)
Both the governance rework (principal binding, role→grants reframe, Rebind→Revoke) **and** the NHI generate-modal
change (add expiry field + principal picker) touch `gui/src/app/settings/access/page.tsx`. **Resolution: S2 owns
this file outright.** S2's brief absorbs the NHI generate-modal requirement (expiry default ≠ Never + principal
picker), wired to **S2's own `governanceApi.ts` key-create call** — S2 re-declares the create request shape
(`{ name, role?, project_scope?, expires_at, principal_id }`) locally; it does NOT import `nhiApi` (cross-worktree,
absent at S2's BASE) and does NOT edit frozen `api.ts`. S5's GUI write-set EXCLUDES `settings/access/` — S5 GUI is
only the new `governance/access-review/` page. (S5 and S2 hit the same backend `POST /api/api-keys` endpoint via
separate client modules; the endpoint's request contract is the shared frozen surface, not either client file.)
**Backend owner:** the `createApiKey` *service* already accepts + validates `principal_id` (added F1b,
`apiKeys.ts:50`), but the *route* destructures only `{name,role,project_scope,expires_at}` (`routes/apiKeys.ts:26`)
— **S5 (sole owner of `routes/apiKeys.ts`) adds the `principal_id` passthrough.** S2's access-page principal-binding
is live-correct only once S5 merges; integrate order (§5) places S5 before S2 for exactly this reason.

### 2.6 Verified code-state (the contract is real)
- `authz_decisions` is **written** (`authorize.ts:255`) and read **only by tests** — the S1 decision-log read API
  is genuinely net-new. ✓
- Services all exist: `listPrincipals/createPrincipal/setPrincipalStatus/getPrincipal` (`principals.ts`),
  `listGrants/revokeGrant` (`grants.ts`), `grantCapability/revokeGrantAuthorized` (`grantCapability.ts`),
  `explainAuthorization` (`authorize.ts:389`), `bootstrapRoot/assertEnforceReady` (`bootstrap.ts`),
  `listApiKeys/createApiKey/revokeApiKey/validateApiKey` (`apiKeys.ts`). ✓
- `api_keys.expires_at` IS enforced at validate-time (the standards-gap row claiming otherwise is **stale**). ✓
- `/api/me` (`routes/me.ts`) returns project/feature body; S1 extends it to include the authenticated principal. ✓

### 2.7 Dependency & env additions
- **S3 owns** the `argon2` dependency add (root `package.json`) — the only slice that edits root **backend** deps.
- **S4 owns** `gui/package.json` (M1) — the only slice that could add a **browser** dep (MFA QR / WebAuthn). Prefer
  dep-free where possible (TOTP enrollment via a server-issued QR data-URL avoids a client QR lib); if a browser
  dep is unavoidable, S4 adds it as sole owner. No other GUI slice touches `gui/package.json` this warp.
- **S4 owns** retiring `CONTEXTHUB_GATEWAY_TOKEN` (compose + `.env` + `gui/src/proxy.ts`) — the only slice that
  touches the proxy shim. This is gated: do it **only when S4's session-cookie path is proven live** (§7).

### 2.8 MCP tool-registry magnet — `src/mcp/index.ts` (RECONCILE-NODE file, integrator only)
`src/mcp/index.ts` is the single global MCP tool registry (~4900 lines, ~103 inline `registerTool` calls). S5's
`mint_ephemeral_key` tool registers here — a classic shared-write magnet (every prior phase that added a tool
edited it). **Rule:** S5 does NOT edit it. S5 records its complete `registerTool('mint_ephemeral_key', …)` block
(handler delegating to `createEphemeralApiKey`, with the input schema) in its brief; the integrator transcribes it
at reconcile. No other slice registers a tool this warp. (Caught by REVIEW(des) adversary F1.)

### 2.9 Env-schema magnet — `src/env.ts` (RECONCILE-NODE file, integrator only)
`src/env.ts` is the single Zod env schema. S3's NIST 800-63B / ASVS V6 work is config-driven — session-signing
secret, cookie name/SameSite/idle+absolute timeouts, lockout thresholds (≤100 fails/hr), argon2id params.
Hardcoding any of these is a defect the §6 S3 adversary will (correctly) reject, so they MUST be env keys.
**Rule:** no slice edits `src/env.ts`. Each backend slice records the env keys it needs (S3: the full
auth/session/lockout/argon2 set; S5: only if rotation-overlap or ephemeral-TTL are made configurable) in its
brief; the integrator adds them at reconcile. Slices reference the keys through the existing accessor and the new
keys resolve at integration. (Caught by REVIEW(des) adversary F3.)

### 2.10 GUI shell magnet — `gui/src/app/layout.tsx` + pre-auth route list (RECONCILE-NODE, integrator only)
The single root `gui/src/app/layout.tsx:34` renders `<Sidebar/>` **unconditionally** for every route; there are NO
route groups and NO nested layouts (verified). In Next.js App Router a child page **cannot** suppress a parent
layout's shell. So the pre-auth pages — `/login`, `/register` (S4), `/bootstrap` (S2) — that must render
shell-less force an edit to this one shared file. Both S2 and S4 need it ⇒ shared-write magnet. **Resolution
(minimal, no mass route-group rename):** the integrator makes the root layout render a small client `AppShell`
that gates `<Sidebar/>` on `usePathname()` against a **frozen pre-auth route list**:
```
PRE_AUTH_ROUTES = ['/login', '/register', '/bootstrap']   // shell-less; everything else gets <Sidebar/>
```
**Rule:** no slice edits `gui/src/app/layout.tsx`. Each GUI slice that adds a pre-auth page records the route in
its brief; the integrator adds it to `PRE_AUTH_ROUTES` and applies the conditional-shell edit once at reconcile.
S4's "pre-auth shell component" is the *visual* pre-auth chrome for its own pages — it does NOT and cannot
suppress the inherited sidebar; only the §2.10 layout gate does that. (Caught by REVIEW(des) adversary-2 N3.)

---

## 3. SLICE TABLE — six streams, write-sets proven pairwise-disjoint

Write-sets are path-prefixes. Disjointness is by inspection (no two `writes[]` share a prefix; none writes a §2
frozen-interface file). `reads[]` are declared so the REVIEW(des) Adversary can check for under-declared coupling.

| Stream | Family | writes[] (disjoint, NEW unless noted) | reads[] | depends | safety |
|---|---|---|---|---|---|
| **S1 Governance REST** | A | `src/api/routes/{principals,grants,authorization,bootstrap}.ts`; `src/services/authzDecisions.ts` (new read/query layer); edit `src/api/routes/me.ts` (sole owner) | services in §2.6; `authz_decisions` schema | — | **YES — authz decision-log exposure** |
| **S2 Governance GUI** | A | `gui/src/app/{identity,delegation,authorization,bootstrap}/`; `gui/src/lib/governanceApi.ts`; rework `gui/src/app/settings/access/page.tsx` (sole owner, incl. NHI modal per §2.5) | S1 routes (§2.1) or mock; S5 `POST /api/api-keys` body contract (§2.5 — declare locally, do **NOT** import `nhiApi`) | S1 | no |
| **S3 F-AUTH backend** | B | `migrations/0071_human_auth.sql`; `src/services/{passwordCredentials,sessions,mfa,lockout,invites}.ts`; `src/api/routes/{auth,invites}.ts`; `src/api/middleware/sessionAuth.ts`; `argon2` dep | `bearerAuth` ordering (§2.1); `principals.ts` | — | **YES — new authN + session + lockout primitive** |
| **S4 F-AUTH GUI** | B | `gui/src/app/{login,register}/`; `gui/src/app/settings/sessions/`; `gui/src/lib/authApi.ts`; pre-auth shell component; `gui/package.json` (sole owner, browser deps, §2.7/M1); retire `gui/src/proxy.ts` shim + `CONTEXTHUB_GATEWAY_TOKEN` (§2.7) | S3 routes; §7 posture | S3 | no (but touches proxy/env — §7 gated) |
| **S5 NHI** | C | extend `src/services/apiKeys.ts` + `src/api/routes/apiKeys.ts` (sole owner); `gui/src/app/governance/access-review/`; `gui/src/lib/nhiApi.ts` | `api_keys` schema (§2.2); MCP `mint_ephemeral_key` reg | — | borderline (credential rotation) |
| **S6 Polish** | — | `gui/src/app/lessons/[id]/`; `gui/src/components/feature-toggles.tsx`; edits within `lessons`/`settings-models`/`extraction-*` (own subtrees) | — | — | no |

**Disjointness proof (pairwise):** S1=backend `routes/*`+`services/authzDecisions`+`me.ts`; S3=backend
`services/*auth*`+`routes/{auth,invites}`+`migrations`+`middleware` — disjoint from S1 (no shared route file;
`me.ts`∉S3). S5=`apiKeys.*` only on backend — disjoint from S1,S3. GUI: S2=`{identity,delegation,authorization,
bootstrap,settings/access}`+`governanceApi`; S4=`{login,register,settings/sessions}`+`authApi`+`proxy`; S5-GUI=
`governance/access-review`+`nhiApi`; S6=`lessons*`+`feature-toggles`+`settings-models`+`extraction-*` — no shared
prefix. The **integrator-owned reconcile-node magnets** — in **no** slice write-set — are:
(1) `src/api/index.ts` (§2.1), (2) `migrations/` counter (§2.2), (3) `gui/src/components/sidebar.tsx` (§2.3),
(4) `gui/src/lib/api.ts` (§2.4), (5) `src/mcp/index.ts` (§2.8), (6) `src/env.ts` (§2.9),
(7) `gui/src/app/layout.tsx` (§2.10 shell gate), (8) root `package.json` (§2.7), and
(9) the append-only docs `SESSION_PATCH.md`/`DEFERRED.md` (§5). Nine magnets, all integrator-only. ∎

---

## 4. Per-stream hermetic briefs

Each brief references ONLY the §2 frozen interface + its own write-set. Sequencing within a stream: schema →
service → route → GUI.

### S1 — Governance REST  *(safety-sensitive)*
New REST over existing services. **The biggest gap: `authz_decisions` has no reader** — build it.
- `src/services/authzDecisions.ts` — paginated/filtered/windowed query of `authz_decisions` (by principal, action,
  allow/deny, time window) + aggregate stats. This is the net-new read layer.
- `routes/principals.ts` — `GET /` (`listPrincipals`), `GET /:id` (+ join api_keys & grants), `POST /`
  (`createPrincipal`), `PATCH /:id/status` (`setPrincipalStatus`). admin-gated. Mount `/api/principals`.
- `routes/grants.ts` — `GET /` (`listGrants`, filters), `POST /` (`grantCapability`), `DELETE /:id`
  (`revokeGrant`). admin-gated. Mount `/api/grants`. (Tree built client-side from `granted_by` edges.)
- `routes/authorization.ts` — `GET /decisions` (the new windowed read + stats), `POST /explain`
  (`explainAuthorization`). admin-gated. Mount `/api/authz`.
- `routes/bootstrap.ts` — `GET /status`, `POST /root` (`bootstrapRoot`), `POST /operator`, `POST /enforce`
  (`assertEnforceReady` + a "test-login-succeeded" lockout guard). Mount **before** `bearerAuth`,
  `ROOT_BOOTSTRAP_TOKEN`-gated.
- Edit `routes/me.ts` (sole owner) — return the authenticated principal (REST `whoami`) for the sidebar footer.
- **Acceptance:** all routes 401/403 correctly under auth-ON; `GET /api/authz/decisions` returns rows the agent
  half wrote; `tsc` + new route tests green. **Mount lines recorded for reconcile (§5); do NOT edit `index.ts`.**

### S2 — Governance GUI
Port from `docs/gui-drafts/pages/{identity,delegation,authorization,bootstrap}.html` + `sidebar-v3-governance`.
- `identity/page.tsx` — principal directory, root card, AUTH ON/OFF posture banner, slide-over (bound credentials
  [G7: mixed session+api_key] + grants + status control), empty/first-run states [G4].
- `delegation/page.tsx` — delegation tree (collapsible + lazy for scale [G8]) ⇄ flat table, grant modal w/
  subtree-bound preview, revoke.
- `authorization/page.tsx` — stats, why-inspector (→ `POST /api/authz/explain`), decision log (reason tokens, tab
  filters, server-side windowing [G8] via `GET /api/authz/decisions`).
- `bootstrap/page.tsx` — 3-step pre-auth wizard (root token → operator account → enforce flip w/ lockout guard).
  No sidebar shell.
- Rework `settings/access/page.tsx` (sole owner) — surface `principal_id` per key, reframe role→grants, rename
  "Rebind"→"Revoke" (design §3b/G11), **and** add the NHI generate-modal fields (expiry default ≠ Never +
  principal picker) wired to S2's own `governanceApi.ts` key-create call — S2 re-declares the request shape
  locally and does **NOT** import `nhiApi` (cross-worktree, absent at S2's BASE); the shared surface is the
  `POST /api/api-keys` body contract S5 extends, not the client file (§2.5).
- `gui/src/lib/governanceApi.ts` — clients for the S1 endpoints + `/api/me`.
- **Record for reconcile:** nav lines (§2.3) — Governance group {Identity, Delegation, Authorization} + account
  footer; and the pre-auth route `/bootstrap` for the §2.10 `PRE_AUTH_ROUTES` list (the wizard is shell-less).
- **Acceptance:** four pages render against live S1 (or a recorded mock); access page shows principal bindings;
  `gui build` green.

### S3 — F-AUTH backend  *(safety-sensitive — closes DEFERRED-041)*
Per NIST 800-63B + OWASP ASVS V6. Ordering is load-bearing.
- `migrations/0071_human_auth.sql` — `human_credentials` (argon2id, failed_count, soft/hard lock), `mfa_factors`,
  `sessions` (aal, idle/absolute expiry, revoke), `invites`, `auth_tokens` (verify/reset).
- add `argon2` dep (§2.7); `services/passwordCredentials.ts` (hash/verify, ≥12-char + breach check).
- `services/sessions.ts` (cookie httpOnly+SameSite, AAL, re-auth windows); `services/mfa.ts` (TOTP + WebAuthn +
  hashed backup codes); `services/lockout.ts` (soft increasing-delay + hard, ≤100 fails/hr, **reset-never-locks**);
  `services/invites.ts` (issue/accept → register principal, optional subtree-bounded starter grant).
- `middleware/sessionAuth.ts` — wired ALONGSIDE `bearerAuth` (ordering at `index.ts:101`) + CSRF for cookie
  state-changes. **Records its wiring for reconcile; does NOT edit `index.ts`.**
- `routes/auth.ts` — `/login`, `/mfa/verify`, `/logout`, `GET|DELETE /sessions`, `/register`,
  `/password/forgot|reset`, `/mfa/enroll`. Mount `/api/auth` **before** the blanket gate (§2.1).
- `routes/invites.ts` — admin `POST /api/invites`.
- **Record (do NOT edit the magnet):** the env keys for `src/env.ts` (§2.9) — session-signing secret, cookie
  name/SameSite/idle+absolute timeout, lockout thresholds, argon2id params — for the integrator to apply.
- **Acceptance:** login→session-cookie→authenticated `/api/me` works; lockout triggers + reset bypasses lock;
  `/api/auth/login` reachable WITHOUT a credential; migration applies clean; unit + route tests green.

### S4 — F-AUTH GUI
Port from `login.html` / `register.html` / `sessions.html`.
- `login/page.tsx` (password, MFA challenge, soft-lock, forgot, auth-off notice) + pre-auth shell component.
- `register/page.tsx` (accept-invite, email-verify, MFA enroll, backup codes).
- `settings/sessions/page.tsx` (active sessions + revoke + auth policy [AAL/timeout]).
- `gui/src/lib/authApi.ts` — `/api/auth/*` client; switch browser `/api` calls to session-cookie.
- **Retire the shim (§2.7, gated):** remove the gateway-token path from `gui/src/proxy.ts` +
  `CONTEXTHUB_GATEWAY_TOKEN` from compose/.env — **only after** the cookie path is proven live (§7).
- The "pre-auth shell component" is the visual chrome for `/login`+`/register` only; it does **NOT** suppress the
  inherited sidebar (impossible from a child page) — shell suppression is the integrator's §2.10 `layout.tsx` gate.
- **Record for reconcile:** nav line `/settings/sessions` "Sessions & Security" + account-footer sign-out; and the
  pre-auth routes `['/login','/register']` for the §2.10 `PRE_AUTH_ROUTES` list.
- **Acceptance:** login page authenticates via cookie end-to-end; sessions page lists+revokes; shim removed and
  GUI still reaches `/api` via cookie; `/login`+`/register` render shell-less once §2.10 lands; `gui build` green.

### S5 — NHI hardening
`standards-gap.md` §3 NHI. Migration-free (§2.2).
- `services/apiKeys.ts` (extend, sole owner) — `reviewApiKeys()` (age, last_used, unused-≥90d, never-expires,
  ownerless); `rotateApiKey()` (successor + overlap window, old auto-expires, txn); `createEphemeralApiKey()`
  (short-TTL, principal-bound).
- `routes/apiKeys.ts` (extend, sole owner) — `GET /api/access-review`, `POST /api/api-keys/:id/rotate`,
  `POST /api/api-keys/ephemeral`; **wire the `principal_id` passthrough** into the existing `POST /` (service
  already validates it, `apiKeys.ts:50` — only the route destructure is missing, F2/§2.5). Only `/api/access-review`
  needs a new mount line (reconcile §5).
- **Record (do NOT edit the magnet):** the `registerTool('mint_ephemeral_key', …)` block for `src/mcp/index.ts`
  (§2.8) — handler delegating to `createEphemeralApiKey` + input schema — for the integrator to transcribe.
- `gui/src/app/governance/access-review/page.tsx` — stat cards + review table (revoke / set-expiry / rotate).
- `gui/src/lib/nhiApi.ts` — clients for S5's own access-review page. (S2 does NOT import this; S2 targets the same
  `POST /api/api-keys` endpoint via its own client — the shared surface is the endpoint contract, §2.5.)
- **Acceptance:** access-review lists at-risk keys; rotate produces a working successor while the old key still
  validates during overlap then expires; ephemeral key expires on schedule; tests green.

### S6 — Polish (independent, low-risk)
- `lessons/[id]/page.tsx` deep-link + "Related Lessons" (semantic) section.
- `settings/models` backend persistence (optional — skip if env-driven).
- per-page extraction controls grid (optional — skip if not required).
- extract `gui/src/components/feature-toggles.tsx` from project-settings (XS refactor).
- **Acceptance:** each shipped item builds + renders; optional items explicitly marked skipped if deferred.

---

## 5. MERGE PLAN — reconcile node + integrate order

**Pre-flight:** commit these DESIGN artifacts FIRST so worktree slices base on a HEAD that contains them.
`BASE` = that commit. `git worktree list` clean before fan-out.

**Integrate order** (dependencies: S2←S1, S4←S3; S5 publishes a sig S2 reads):
1. **S1** (governance REST) — foundation.
2. **S3** (F-AUTH backend) — independent foundation; lands alongside S1.
3. **S5** (NHI backend+GUI) — extends the `POST /api/api-keys` body contract (`principal_id` passthrough) that S2's
   access page targets; must land before S2 for that binding to be live-correct.
4. **S2** (governance GUI) — consumes S1 + the S5 create sig.
5. **S4** (F-AUTH GUI) — consumes S3; shim retirement gated on §7.
6. **S6** (polish) — anytime; no deps.

**Reconcile node — runs AFTER all six slice branches are merged (N4):** the magnet edits below import slice
exports (e.g. the footer reads S2's `governanceApi.me()`, the MCP block calls S5's `createEphemeralApiKey`), so
they MUST follow every merge or they reference symbols not yet present. Integrator applies, in this order — these
are the ONLY edits to the magnet files:
1. `src/api/index.ts` — apply all mount lines from §2.1 in the table's order (pre-auth: `/api/auth`,
   `/api/bootstrap` before line 101; rest after). Wire `sessionAuth` alongside `bearerAuth` per S3's recorded note.
2. `src/env.ts` (§2.9) — add the env keys each backend slice recorded (S3 auth/session/lockout/argon2 set; S5 if any).
3. `src/mcp/index.ts` (§2.8) — transcribe S5's recorded `registerTool('mint_ephemeral_key', …)` block.
4. `gui/src/components/sidebar.tsx` — add the Governance group + Settings sub-items + account footer per §2.3
   (footer reads `governanceApi.me()`, §2.4), transcribing each slice's recorded nav lines.
5. `gui/src/app/layout.tsx` (§2.10) — apply the conditional-shell gate; set
   `PRE_AUTH_ROUTES = ['/login','/register','/bootstrap']` from the routes S2+S4 recorded.
6. Root `package.json` — S3's `argon2` dep + each slice's new test-list entries (each slice records its test files).
7. compose/`.env` — S4's `CONTEXTHUB_GATEWAY_TOKEN` removal (gated, §7).
8. Append-only docs `docs/sessions/SESSION_PATCH.md` + `docs/deferred/DEFERRED.md` — **integrator-only** (no slice
   writes them; CLAUDE.md conflict-magnet rule). Discharge DEFERRED-041/042/058 here.

**Disjointness dividend:** integrating the six branches touches non-overlapping write-sets → a sequential merge
**cannot** conflict on them. **A conflict on any write-set ⇒ HALT_REDESIGN** (the slicing was wrong; do not patch
— return to DESIGN). The only expected "merges" are the nine magnet files above (§3), edited solely by the integrator.

**RECONCILE proof:** full suite (`npm test` + `npx tsc --noEmit` + `cd gui && npm run build`); then a live
`docker compose up -d --build` smoke (≥2 services touched) exercising: login→cookie→`/api/me`, a governance page
load, an access-review rotate. Stale images ⇒ false-green; rebuild touched images.
**Mandatory pre-auth reachability check (F4):** a route test asserting `POST /api/auth/login` and
`GET /api/bootstrap/status` return **non-401 with NO Authorization header** under `MCP_AUTH_ENABLED=true` — guards
the silent integrator failure where pre-auth routes get pasted into the post-`bearerAuth` block (chicken-and-egg
lockout that compiles and passes isolated tests but breaks live).
**Mandatory key-binding contract check (N1):** a test that creates a key via the access-page client path WITH a
`principal_id`, then asserts `GET /api/api-keys` shows that `principal_id` non-null — pins the S2-client ⇄
S5-route `POST /api/api-keys` body contract (a route that silently drops an unknown field would otherwise lose the
binding with no error).
**Mandatory shell check (N3):** a GUI test asserting `/login`, `/register`, `/bootstrap` render WITHOUT the
sidebar and all authed routes render WITH it (guards a mistyped `PRE_AUTH_ROUTES`).

---

## 6. Safety-sensitive review gates (mandatory — CLAUDE.md policy)

Two streams introduce load-bearing primitives and each requires a **cold-start hostile-actor adversary**
(read-files-only, multi-pass; expect 3–4 passes to saturate) at REVIEW-CODE/POST-REVIEW:
- **S1** — authz **decision-log exposure** (`GET /api/authz/decisions` leaks who-tried-what; verify tenant scope,
  admin gate, no PII over-fetch, no IDOR on principal filter).
- **S3** — new **authentication + session + lockout** primitive (verify: login reachable pre-auth but rate-limited;
  lockout can't lock out reset; session cookie httpOnly+SameSite+CSRF; AAL enforced; argon2id params; no user
  enumeration on login/forgot).
- **S5** — borderline (credential rotation): verify rotate is a transaction, overlap window bounded, ephemeral TTL
  enforced at validate-time, no privilege escalation via principal-bind.
The REVIEW(des) Adversary on the **slicing itself** was run before fan-out (hidden coupling / under-declared
`reads` / a magnet smuggled into a slice). **Result: cleared in 3 cold-start passes** — saturation curve
3 BLOCK → 1 BLOCK → 0 BLOCK (the policy's expected 3→2→1→0 shape):
- **Pass 1** (3 BLOCK): F1 `src/mcp/index.ts` registry, F2 access-page key-create coupling, F3 `src/env.ts` schema —
  un-hoisted shared-write magnets the first draft's proof missed. + F4/F5 WARN.
- **Pass 2** (1 BLOCK): N3 `gui/src/app/layout.tsx` — single root layout renders `<Sidebar/>` unconditionally; the
  pre-auth pages need shell-less rendering, which a Next.js child page cannot do. + N1/N2 WARN.
- **Pass 3** (0 BLOCK → **GO**): all closed with live-code evidence; the §2.10 conditional-shell gate verified
  viable (Server-Component layout + client `AppShell` + `usePathname` prerenders, no flash). Residual M1 WARN
  (`gui/package.json` browser-dep) folded into §2.7. **Slicing is sound.**

---

## 7. Correcting the premature flip (interim posture)

The running stack is hardened (auth-ON) but has **no human login** — only the shared-admin gateway-token shim,
GUI bound to `0.0.0.0:3002`. Until F-AUTH (Family B) lands, pick one interim posture:
1. **Revert to dev** (`docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d`) — no exposure; or
2. **Localhost-bind** the GUI (`127.0.0.1:3002:3000`) + treat the shim as explicitly temporary.

The re-flip to hardened is correct ONLY once human login is enforced (the design's definition of auth-ON). **S4's
shim retirement (§2.7) is the gate that makes the hardened posture legitimate** — sequence it last, after the
cookie path is proven live in the §5 smoke.

---

## 8. Execution status & next gate

This document is the warp **DESIGN + PLAN** deliverable (frozen interface §2 + slice table §3 + briefs §4 + merge
plan §5). **BUILD has NOT started.** The next step is the warp BUILD fan-out — six worktree sub-agents per §3/§4 —
which is a large, **safety-sensitive** effort (S1 + S3) and a PO-gated junction. **Awaiting explicit go-ahead**
before spawning slices. On go: commit this plan as BASE, run the REVIEW(des) Adversary on the slicing (§6), then
fan out.

DEFERRED discharged on completion: **041** (F-AUTH), **042** (FE polish), **058** (governance GUI tracker).
