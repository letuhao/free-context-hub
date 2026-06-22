# Fix Plan — Auth-ON GUI Walkthrough Findings (2026-06-22)

Source of findings: [`docs/qc/walkthrough-findings.md`](../qc/walkthrough-findings.md).
Tracker: [`docs/qc/RELEASE_READINESS.md`](../qc/RELEASE_READINESS.md) (FIX-5 + this batch).

## Key discovery that reshapes the plan

The human-login stack is **already built**, contrary to the stale "F-AUTH unbuilt" note:

- `gui/src/app/login/page.tsx` (329 lines: login / MFA / forgot-password stages)
- `gui/src/app/bootstrap/page.tsx` (first-run wizard) + `gui/src/app/register/page.tsx`
- `gui/src/lib/authApi.ts` — login/logout/me/register + CSRF + httpOnly session cookie
- `gui/src/components/account-footer.tsx` — "signed in as …" + sign-out → `/login`
- Backend: `POST /api/auth/{login,mfa/verify,register,logout}`, `GET /api/me`,
  `/api/bootstrap/*`, `/api/principals` (list + by-id, admin-gated)
- `api.ts request()` uses same-origin `fetch` (default `credentials:"same-origin"`), so
  **once a session cookie is set, every `api.*` data call carries it automatically** — no
  Bearer needed.

**So the real FIX-5 bug is narrow:** there is **no gate that redirects an unauthenticated
user to `/login`**. Under enforced auth a protected page just renders full chrome and lets
its data calls 401 silently (degrading to a misleading "create your first project"). Wire
the gate and the entire GUI works via login → session cookie. The baked-Bearer hack then
becomes unnecessary and gets removed.

---

## Sprint W1 — FIX-5: GUI auth gate (🔴 release blocker) · size M

Goal: an unauthenticated human on the hardened stack lands on `/login`, signs in, and the
whole GUI works via the session cookie. No baked client token.

- **W1.1 AuthGate + AuthContext.** New `gui/src/components/auth-gate.tsx` wrapping the
  non-pre-auth branch of `app-shell.tsx`. On mount (and route change) calls `authApi.me()`:
  - `auth_enabled === false` → render children (dev/auth-OFF; unchanged behavior).
  - 401 / `authenticated === false` under enforced auth → `router.replace('/login?next=' +
    encodeURIComponent(pathname))`.
  - authenticated → provide `{ principal_id, display_name, role }` via React context
    (consumed by W2) and render children.
  - While the check is in flight → a lightweight full-screen spinner (kills the
    empty-dashboard / "create your first project" flash).
- **W1.2 First-run routing.** If `me()` is 401 AND `GET /api/bootstrap/status`-equivalent
  signal says no operator exists yet, route to `/bootstrap` instead of `/login`. (If the
  login page already CTAs to bootstrap, this is a nicety — keep minimal.)
- **W1.3 `next` redirect.** `/login` reads `?next=` and `router.replace`s there after a
  successful login/MFA (default `/`).
- **W1.4 End-to-end verify (evidence gate).** Mint/register a real operator → log in
  through the GUI → confirm `/api/me` 200, dashboard + lessons + coordination data all load
  with NO baked token (rebuild gui WITHOUT `NEXT_PUBLIC_CONTEXTHUB_TOKEN`). Confirm api.ts
  cookie is actually sent (it should be by same-origin default; if a `NEXT_PUBLIC_*_API_URL`
  override is ever set, add explicit `credentials:"same-origin"`).
- **W1.5 Tests.** Unit-test the gate decision matrix (auth-off / 401 / authenticated /
  loading). Playwright: unauthenticated → redirected to `/login`.

DoD: fresh hardened stack, no token baked, human logs in via GUI, all 6 new pages + the
dashboard work. `docs/qc/RELEASE_READINESS.md` FIX-5 → CLEAR.

## Sprint W2 — Actor-identity UX (🟡, depends on W1) · size M  ⟨scope decision⟩

Goal: stop showing raw UUIDs and stop making humans type actor-ids.

- **W2.1 Prefill actor fields** from the AuthContext principal (editable, defaulted to the
  logged-in `principal_id`): coordination charter `created_by`; topic-detail board
  "acting as" + motion/request/dispute actor inputs; decision-bodies add-member + proxy;
  intake submit + triage "you".
- **W2.2 Resolve UUID → display_name.** `useActorNames()` hook backed by `GET /api/principals`
  (cache the id→display_name map; fall back to a shortened UUID on miss). Apply to: topic
  roster, event-log "by", motions "by/seconded by", body members, leases `agent_id`, intake
  "by". Caveat: `/api/principals` is admin-gated — fine for the typical admin operator; for
  non-admin operators either (a) accept shortened-UUID fallback, or (b) later enrich the
  coordination list endpoints to return `display_name` server-side (out of scope here).
- **W2.3 Tests.** Hook unit test (map + fallback); Playwright spot-check a resolved name.

DoD: no raw UUIDs on coordination/governance surfaces; actor fields default to the
logged-in principal.

## Sprint W3 — Small GUI correctness/polish fixes · size S

- **W3.1 🟠 Motion action guard.** `topics/[id]/page.tsx:575` — gate second/vote/against/
  abstain/veto/tally on the motion's own active status (e.g. `['proposed','seconded',
  'voting'].includes(m.status)`), not just `!isClosed`. Unit/Playwright: terminal motion
  shows no action buttons.
- **W3.2 🟡 Sidebar nav active-state.** Replace `startsWith('/coordination')`-style matching
  with exact/longest-prefix so `/coordination/leases`, `/governance/decision-bodies`,
  `/governance/intake` highlight their own items.
- **W3.3 🟡 Motion field label.** Add a label/placeholder ("voting window (min)") to the
  `deadline_minutes` input.
- **W3.4 🔵 (optional) Reflect error wrapper** — friendlier "couldn't reach the chat model"
  message wrapping the raw upstream JSON.

## Sprint W4 — Runbook + cleanup · size S

- **W4.1 🔵 Auth bring-up runbook.** Document the required order in README/ops:
  `migrate:coordination-actors` → `/api/bootstrap/*` (root + operator) → enforce-ready check
  → flip `MCP_AUTH_ENABLED` → human login. The backend FATAL-refuses to boot otherwise.
- **W4.2 Cleanup the QC hack.** `npx tsx scripts/revoke-qc-key.ts` (revoke key + grant),
  delete `scripts/mint-qc-key.ts` / `revoke-qc-key.ts`, rebuild gui WITHOUT the baked
  token, re-verify the login flow on the clean hardened stack.

---

## Sequencing & sizing

W1 → W2 (W2 consumes W1's AuthContext) ; W3 and W4.1 are independent (any order) ; W4.2
runs last (after W1 proves login works without the token). Trunk-based: commit each sprint
to `main`/branch incrementally; update `SESSION_PATCH.md` + `RELEASE_READINESS.md` per
sprint.

Total: ~M+M+S+S. All testable via TDD except pure layout. Safety-sensitive review applies
to **W1** (auth gate is an authz-adjacent boundary) — run a cold-start adversary pass on the
redirect/enforcement logic before marking FIX-5 clear.

## Open scope decision

**Is W2 (actor-identity UX) in scope for v0.1.0, or deferred?** The pages are fully
functional without it (you type/paste UUIDs); it's pure usability polish but a visible one.
W1 + W3 + W4 already produce a secure, working, shippable GUI.
