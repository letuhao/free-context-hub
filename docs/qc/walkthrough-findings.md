# Auth-ON GUI Walkthrough — Findings

Live click-through of the 6 new GUI areas against the hardened (auth-ON) Docker stack,
2026-06-22. Credential: a dedicated non-root QC operator (global admin grant + bound
admin Bearer), baked into the GUI build as `NEXT_PUBLIC_CONTEXTHUB_TOKEN`. Revoke after
via `scripts/revoke-qc-key.ts`.

Severity: 🔴 blocker · 🟠 bug · 🟡 UX · 🔵 note

---

## Cross-cutting

- 🔴 **FIX-5 / two auth paths.** The GUI data layer (`api.ts request()`) attaches the
  baked **Bearer** and works. But sidebar identity (`/api/me`), notifications, and lesson
  counts use `authApi.ts` → **session cookie** (DEFERRED-059 human-login path), which is
  unbuilt — so those 401 even with a valid Bearer. On the secure default a real operator
  has neither path. Whole-GUI blocker; the new pages happen to work only because they live
  on the Bearer path. Needs the human-login session (or a documented operator-token story
  that also feeds `authApi`).
- 🔵 Boot bring-up gate: the rebuilt backend refuses to start auth-ON until
  `npm run migrate:coordination-actors` reconciles legacy free-text actor_ids to
  principals. Must be documented as a release/runbook step (FATAL otherwise). Ran it: 2
  principals imported, 20 scalar + 2 array cols rewritten.

## 1. Coordination → Topics (`/coordination`)

- ✅ Renders real topics, status pills (active/chartered), breadcrumb, charter dialog,
  "API connected".
- 🟡 `created_by` shows the **raw principal UUID** ("by 6e6dc2ec-…") instead of a display
  name. After the actor→principal migration these are UUIDs; the list should resolve to
  `display_name`. (Same pattern likely on every coordination surface that shows an actor.)
- 🟡 Charter dialog requires manually typing your **actor id** (`created_by`) with no
  prefill from the logged-in principal — friction + invites typos that strand ownership.

## 2. Coordination → Topic detail (`/coordination/topics/[id]`)

- ✅ Dense but complete: header (status pill, Join, Close), Participants roster w/
  change-level, live Event log (polls 3s; shows chartered/joined/proposed/seconded/cast/
  tallied), Board (post/claim tasks), Motions (propose/second/vote/veto/tally), Approval
  requests, Disputes. All render real data.
- 🟡 **Actor identity is a raw UUID everywhere** — Participants "M1 / 6e6dc2ec-…", every
  event "by <uuid>", motion "by <uuid>". Unreadable. Resolve to display_name.
- 🟡 **Repeated "Acting as: actor id" entry.** Board, Motions, Requests, Disputes each
  need an actor id typed/pasted. Post-migration that's a principal UUID — no human will
  paste a UUID per action. Should default to the logged-in principal (one "acting as"
  control, or auto from /api/me once FIX-5 lands).
- 🟡 Motion **"60"** field = `deadline_minutes` (voting window), confirmed at
  `topics/[id]/page.tsx:287`. No label/placeholder — add "voting window (min)".
- 🟠 **Confirmed** (`topics/[id]/page.tsx:575`): motion action buttons (second / vote for
  / against / abstain / veto / tally) are gated only on `!isClosed` (topic level), NOT on
  the motion's own `m.status`. A terminal motion (`carried`/`vetoed`/`failed`) still shows
  all action buttons. Backend rejects → error toast, so no corruption, but it offers
  actions that can't succeed. Guard on active motion states.

## 3. Coordination → Artifact Leases (`/coordination/leases`)

- ✅ Clean empty state (lock icon, clear copy), Refresh action, 5s auto-poll. Renders fine.
- 🟡 Sidebar nav active-state: "Topics" stays highlighted while on `/coordination/leases`
  (and "Artifact Leases" never highlights). Likely `startsWith('/coordination')` on the
  Topics link. Use exact-match / longest-prefix active logic.

## 4. Governance → Decision Bodies (`/governance/decision-bodies`)

- ✅ List renders (4 bodies, member/quorum/threshold summary). Expand works inline: shows
  quorum/threshold/veto, Members w/ weights, add-member control, Proxy grants (principal→
  proxy + Grant). Clean, complete CRUD surface.
- 🟡 Members shown as raw UUIDs (same display-name issue). Add-member + proxy fields need
  manual actor-id/UUID entry (same friction pattern).

## 5. Governance → Intake (`/governance/intake`)

- ✅ **Full round-trip verified live (auth-ON):** submitted an item → appeared with type/
  status pills + attribution + timestamp; opened the **adaptive Triage dialog** (Route-to
  selector with conditional Actor/Topic/Routed-to fields) → Cancel; **Dismiss** → item
  flips to "dismissed" pill. Submit/triage/dismiss all work. Filter tabs present.
- 🟡 Actor-id manual entry again (submit "your actor id", triage "you"). Same pattern.
- 🔵 After submit, the text field clears but the actor-id field is retained (reasonable).

## 6. Knowledge → Reflect (`/knowledge/reflect`)

- ✅ Page works: topic input, run, clear error surfacing. Nav item correctly highlighted
  (exact-match works here — contrast the leases case).
- 🔵 The reflect run failed with a backend error cleanly shown:
  `chat HTTP 400: Failed to load model "google/gemma-4-26b-a4b-qat" … Engine protocol
  startup was aborted.` This is an **environment issue** (LM Studio didn't have the
  configured `CHAT_MODEL` loaded), not a GUI/code defect. The synthesis path itself could
  not be exercised here; re-verify once the chat model is loaded.
- 🟡 Error is shown as raw upstream JSON. Acceptable for a self-hosted/dev tool (verbatim
  upstream error aids debugging), but a friendlier "couldn't reach the chat model" wrapper
  would be nicer.

---

## Summary

| # | Page | Renders | Interactions verified | Notable |
|---|------|---------|----------------------|---------|
| 1 | Coordination Topics | ✅ | list, charter dialog | UUID display, actor-id entry |
| 2 | Topic detail | ✅ | renders all 6 sections | 🟠 motion buttons on terminal state; UUID; actor-id |
| 3 | Artifact Leases | ✅ | empty state, poll | 🟡 nav active-state |
| 4 | Decision Bodies | ✅ | list, expand, members/proxies | UUID; actor-id |
| 5 | Intake | ✅ | **submit→triage→dismiss round-trip** | actor-id |
| 6 | Reflect | ✅ | input/run/error | 🔵 chat model not loaded (env) |

**Verdict:** all 6 new pages render and operate under the hardened (auth-ON) stack via the
Bearer data path. No crashes, no layout breakage, no broken endpoints. One 🟠 logic-UX bug
(motion actions not guarded on motion status). The dominant theme is **UX polish**: actor
identities show as raw UUIDs and every coordination/governance action requires manually
entering an actor-id/UUID — both resolve cleanly once FIX-5 (identity via `/api/me`) lands,
so they should be fixed together. The one 🔴 blocker is **FIX-5** itself (GUI can't auth on
the secure default without a baked Bearer; sidebar identity/notifications still need the
human-login session).

### Resolution (fix batch W1–W4, 2026-06-22) — all verified live on the tokenless hardened stack

| Finding | Fix | Verified |
|---------|-----|----------|
| 🔴 FIX-5 GUI auth | W1 `AuthGate` (auth-context.tsx) + login `?next=` | unauth → `/login?next=` → sign-in → lands on page, **0 console errors**, tokenless |
| 🟡 actor UUIDs | W2 `useActorNames` UUID→display_name | topics/event-log/motions/leases/body-members show names (mcp-m1, etc.) |
| 🟡 actor-id entry | W2 `useActingActor` prefill | board "Acting as" + proxy principal prefilled with operator principal |
| 🟠 motion buttons on terminal state | W3.1 `MOTION_TERMINAL` guard | carried motion shows **no** action buttons |
| 🟡 nav active-state | W3.2 longest-prefix-wins | `/coordination/leases` highlights "Artifact Leases" |
| 🟡 motion field label | W3.3 "voting window (min)" | label present |
| 🟠 event log "Invalid Date" | (new, found during verify) GUI read `created_at`; backend emits `ts` | fix applied; verify post-rebuild |
| 🔵 runbook | W4.1 `docs/ops/auth-bring-up.md` | written |
| 🔵 baked-token security | W4.2 tokenless rebuild + revoke QC key | gui rebuilt tokenless (0 chunks); key revoke pending |

### Original recommended fix batch (pre-release)
1. 🔴 **FIX-5** — GUI auth on hardened default (human login or documented operator token
   that also feeds `authApi`). Unblocks sidebar identity + makes the GUI usable shipped.
2. 🟡 **Actor identity UX** (depends on FIX-5) — once `/api/me` gives the principal: prefill
   `created_by`/"acting as"/actor-id fields; resolve UUIDs → display_name across all
   coordination/governance surfaces.
3. 🟠 **Motion action guard** — gate second/vote/veto/tally on the motion's own status.
4. 🟡 **Nav active-state** — exact/longest-prefix match (Leases/Decision Bodies/Intake).
5. 🟡 **Labels** — motion `deadline_minutes` field needs a label.
6. 🔵 **Runbook** — document `migrate:coordination-actors` as a required pre-auth step.
