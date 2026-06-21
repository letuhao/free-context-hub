# DEFERRED-050 — CLARIFY: user-scoped notification identity

**Date:** 2026-06-21 · **Branch:** `feature/actor-data-boundary` · **Size:** M (2 files) · auth OFF (inert).
A F2g `MCP_AUTH_ENABLED`-flip prerequisite.

## What the code ACTUALLY does (verified — and it corrects the deferred's premise)

The deferred said the fix "needs the user↔principal identity mapping (the 'who is the human behind this key'
model), which F2 did not build." **Investigation shows that mapping already exists and no new substrate is
needed** — F1's principal IS the human identity, and every authenticated request already carries it via
`callerPrincipalOf(req)` (returns the api-key-bound `principal_id`, or null under auth-off).

Findings:
1. **`notifications` is never written.** `createNotification` (activity.ts:127) has **zero callers** anywhere in
   `src/`. So `listNotifications` always returns empty and `markNotificationsRead` always updates 0 rows — the
   list/mark feature is **dormant/vestigial** today. (The 24 MB grep hit was GUI build artifacts, not callers.)
2. **`user_id` is free-text, caller-supplied.** `notifications.user_id` / `notification_settings.user_id` are
   `TEXT`. The 4 handlers in `src/api/routes/activity.ts` take `user_id` straight from the request
   (`req.query.user_id` / `req.body.user_id`), defaulting to the literal `'gui-user'` for settings. There is no
   `users` table and no link to principals — `user_id` is an arbitrary string.
3. **The list/mark handlers have NO authz**; the settings handlers ARE project-gated (read/write@project, commit
   8aa736f) but still key by caller-supplied `user_id`. So the isolation axis the deferred flagged (the
   authenticated identity must equal the requested user) is genuinely unguarded — passing `user_id=<victim>`
   would read/mutate another user's notifications/settings. **Not live-exploitable for list/mark today only
   because the table is empty**; settings IS writable cross-user within a project.

## The fix (no new substrate): the notification user IS the authenticated principal

Derive the notification `user_id` from `callerPrincipalOf(req)` and **ignore any request-supplied `user_id`** on
all 4 handlers (`GET /api/notifications`, `PATCH /api/notifications` mark-read, `GET/PUT /api/notifications/
settings`). Under auth-ON each principal sees only its own; under auth-OFF fall back to a fixed dev id
(`'gui-user'`, preserving today's dev behavior and existing settings rows). This closes the cross-user
isolation hole with a one-file change — because the principal already IS the user.

**Consequence (deliberate contract change):** the `/api/notifications*` endpoints no longer honor a request
`user_id`; it's derived. The GUI already omits `user_id` on the hot paths (sidebar/list pass `project_id`), so
this doesn't break the GUI. Existing `notification_settings` rows keyed `'gui-user'` keep matching under
auth-off; under auth-on a principal starts with empty settings (recreatable; the feature is dormant) — no
migration required.

## The decision for you

**Defense-in-depth on the `listNotifications` JOIN?** `listNotifications` returns `a.project_id/title/detail/
actor` from `activity_log` via the JOIN. Even with `user_id = principal`, a notification created for me about a
project I later lost access to could leak that project's metadata.
- **D1 — derive-from-principal only (recommended, minimal).** Closes the isolation hole; the JOIN leak is moot
  today (no notifications are ever created) and would only matter once someone wires `createNotification` to
  only-entitled events. 1 logic concern, smallest surface.
- **D2 — derive-from-principal + filter the JOIN to readable projects.** Also intersect the returned rows with
  the projects the principal can `read`, so even a mis-created notification can't leak project metadata.
  Defense-in-depth, ~1 extra query per list call; aligns with the careful posture but adds code for a path
  that's dormant today.

I recommend **D1** (and a code-comment noting the JOIN-filter as the wiring-time follow-up), since the feature
is dormant and principal-isolation already closes the practical hole — but D2 is cheap if you want belt-and-suspenders.

## Acceptance criteria
1. All 4 notification handlers derive `user_id` from `callerPrincipalOf(req)`; a request-supplied `user_id` is
   ignored. Under auth-OFF, a fixed dev fallback (`'gui-user'`).
2. A test: under auth-ON, principal A cannot read/mark/configure principal B's notifications/settings by passing
   `user_id=B` (the request field is ignored; A only ever touches its own).
3. (If D2) `listNotifications` returns only rows whose `project_id` the principal can read.
4. auth-OFF behavior unchanged (GUI still works; `'gui-user'` fallback). Full suite green, tsc clean.
5. `MCP_AUTH_ENABLED` flip NOT touched.

## Out of scope
- Wiring `createNotification` to real events (the feature stays dormant — separate product work).
- A `users` table / human-vs-principal distinction (not needed; the principal is the identity).
