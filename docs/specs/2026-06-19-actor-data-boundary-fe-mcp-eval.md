# Actor Data Boundary — FE + MCP scenario-coverage evaluation

**Status:** EVAL (design coverage) · **Date:** 2026-06-19 · **Branch:** `feature/actor-data-boundary`
**Inputs:** the 8 drafts (`identity, delegation, authorization, access-control-v2, login, register,
sessions, nhi-access-review`) + the two design specs (`-mcp-fe-design.md`, `-standards-gap.md`).
**Method:** walk each realistic end-to-end journey for each actor across the designed surface; verdict
per step — ✓ covered · ⚠ partial · ✗ gap. This is a **coverage** check (can the actor finish the task
with what's drawn?), NOT a mechanism-correctness check (that is proven in code under the per-phase
cold-start adversary reviews — paper can't prove txn/lock correctness, per the v1–v5 non-convergence).

---

## A. Human operator / root journeys

| # | Journey | Surface used | Verdict |
|---|---|---|---|
| A1 | **First install → become root, turn enforcement ON** | login state-5 hand-waves "Set up login →"; identity posture banner | ✗ **G1** no root-bootstrap screen/flow |
| A2 | Invite a teammate → they register → starter grant | register.html (invite modal + accept) + identity directory | ✓ |
| A3 | Log in with password + MFA | login states 1–2 | ✓ |
| A4 | Lost authenticator → recover | login: backup-code + forgot-password | ⚠ **G5** no "lost BOTH factors" / admin MFA-reset path |
| A5 | See who can access what | delegation tree + access-control-v2 effective-access | ✓ |
| A6 | "Why was agent X denied?" | authorization why-inspector + decision log | ✓ (strong) |
| A7 | Revoke a compromised actor now | identity suspend + access-control revoke | ✓ |
| A8 | Manage my own sessions / sign out everywhere | sessions.html | ✓ |
| A9 | Periodic stale-credential review | nhi-access-review | ✓ |
| A10 | **Find these pages** (navigation / IA) | breadcrumbs say "Governance"/"Settings" but no nav grouping drawn | ✗ **G2** no IA/sidebar integration |
| A11 | First-run with zero principals/grants | — | ⚠ **G4** no empty/onboarding states |

## B. Scoped human (project admin / member)

| # | Journey | Surface | Verdict |
|---|---|---|---|
| B1 | Project admin grants within own project only | delegation grant modal + subtree check + reject state | ✓ |
| B2 | Member sees only their scope (no global directory) | spec says list_principals scope-filtered | ⚠ partial — FE doesn't show the *scoped* (non-admin) directory view |
| B3 | Member tries to grant upward/sideways | delegation reject card | ✓ |

## C. Agent journeys (MCP)

| # | Journey | Tool / surface | Verdict |
|---|---|---|---|
| C1 | Cold-start agent: "who am I?" | `whoami` | ✓ |
| C2 | Action denied → "why? what do I lack?" | `explain_authorization` (mirrors FE why-inspector) | ✓ (strong symmetry) |
| C3 | Pre-flight check before acting | `explain_authorization` (read-only sim) | ✓ |
| C4 | Delegate a subtask to a sub-agent | `grant_capability` (+ needs to pick grantee) | ⚠ **G6** can agent enumerate/choose grantee + self-mint a child key via MCP, without a human? REST exists; MCP self-service unclear |
| C5 | **Key expires / rotated mid-run** → recover | — | ✗ **G3** no agent-facing credential-expiry error contract or re-auth path |
| C6 | One-shot CI agent gets short-lived cred | nhi ephemeral mint (human-initiated) | ⚠ same as G6 (who mints — human only?) |
| C7 | Asserted actor_id rejected | authorization REJECT row + spec contract | ✓ |

## D. Cross-cutting / edge

| # | Scenario | Surface | Verdict |
|---|---|---|---|
| D1 | Cross-project read → no existence leak | authz decision `OUT_OF_SCOPE` → NOT_FOUND | ✓ |
| D2 | Suspended principal acts | `PRINCIPAL_INACTIVE` everywhere | ✓ |
| D3 | Root short-circuit is visible/audited | authorization ROOT_SHORT_CIRCUIT row | ✓ |
| D4 | One person who is human **and** runs agents (1 principal, session + api_key)? | model allows (kind=attribute) | ⚠ **G7** UX never shows a principal holding both credential types |
| D5 | **Rebind** a key to a different principal | access-control-v2 "Rebind" button | ⚠ **G11** rebind = re-point identity = privilege change; no guard/warning/audit shown |
| D6 | Scale: 1000 grants / millions of authz rows | tree + log have filters | ⚠ **G8** tree doesn't collapse/virtualize; log pagination only |
| D7 | Governance (refer-back, voting, sealed Codices) | "later" disabled tab | ✓ (intentionally deferred) |
| D8 | Vietnamese operator, English drafts | — | LOW **G10** i18n not considered |

---

## Gap list (prioritized)

**HIGH (blocks a core journey / unreachable):**
- **G1 — Root-bootstrap & enforcement-flip flow.** The foundation's whole premise is "root set
  out-of-band at install." There is no screen/spec for: configure root credential → create first
  human principal → flip `MCP_AUTH_ENABLED` on → confirm you're not locked out. login state-5 only
  links a nonexistent "Set up login →". *Fix:* a first-run bootstrap draft + a documented CLI/seed path
  (the F1 "root configured out-of-band" must have a concrete operator UX, even if minimal).
- **G2 — Navigation / information architecture.** 8 new pages, zero nav. Need a "Governance" sidebar
  group (Identity, Delegation, Authorization, NHI Access Review) + Settings placement (Access Control,
  Sessions & Security) + where login/register sit (pre-auth shell). Without it the screens are orphans.
  *Fix:* a sidebar-v3 / nav draft, integrate with existing `components/sidebar.html`.

**MED (real, has a workaround or narrower blast radius):**
- **G3 — Agent credential-expiry / re-auth contract.** Once keys enforce expiry + rotation, an agent
  *will* hit an expired key mid-run. Define the error shape (`CREDENTIAL_EXPIRED`) + recovery (human
  re-issues / ephemeral re-mint) so agents fail safe, not silently loop.
- **G6 — Agent self-service scope via MCP.** Decide explicitly: can an agent `grant_capability` to a
  child and mint an ephemeral child key through MCP (bounded by its own subtree), or is all minting
  human-only? Either is fine — but it must be a stated rule, or sub-agent fan-out has no credential path.
- **G11 — "Rebind key → principal" is a privilege-change vector.** Re-pointing a credential to a
  higher-privileged principal is an escalation. Needs admin-only + explicit warning + audit event, or
  remove rebind in favor of revoke+reissue.

**LOW (polish / later):**
- G4 empty/first-run states · G5 lost-both-factors admin reset · G7 dual-credential principal UX ·
  G8 tree/log scale (collapse + virtualize) · G10 i18n.

---

## Resolution (2026-06-19 — full close)

- **G1 — CLOSED.** `docs/gui-drafts/pages/bootstrap.html` (first-run: establish root out-of-band via
  `ROOT_BOOTSTRAP_TOKEN` / `npm run bootstrap:root` → create operator principal → flip enforcement with a
  lockout guard that verifies you can sign in first).
- **G2 — CLOSED.** `docs/gui-drafts/components/sidebar-v3-governance.html` (Governance nav group +
  Settings sub-tree + signed-in-as account footer + IA route map + scope-gated visibility; pre-auth shell
  for login/register/bootstrap).
- **G3 / G6 / G11 — RESOLVED** as contract decisions in `-mcp-fe-design.md` §3b (CREDENTIAL_EXPIRED error;
  agent self-service bounded by subtree incl. `mint_ephemeral_key`; rebind removed in favor of
  revoke+reissue).
- **G4 / G5 / G7 / G8 / G10 — DEFERRED** (DEFERRED-042; build-time polish, no design blocker).

## Verdict
The **core boundary loop is well covered and the FE↔MCP symmetry is the design's strength** — the
human "why inspector" and the agent `explain_authorization` are the same explanation, and every verdict
carries its reason (the audit/explanation requirement holds end-to-end). The coverage holes are at the
**edges of the lifecycle**, not the center: **bootstrap (G1)** and **reachability (G2)** are the two
that genuinely block adoption and should be closed before/with F1; G3/G6/G11 are contract decisions to
nail down before the matching code phase. None of these reopen the governance-OS paper loop — they're
finite UX/contract gaps with concrete fixes.
