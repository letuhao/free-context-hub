# DEFERRED-050 — DESIGN (D2: derive-from-principal + JOIN filter)

auth OFF (inert). 2 files. No migration, no new substrate.

## 1. The notification user IS the authenticated principal
New pure helper in `src/api/routes/activity.ts`:
```ts
export const LOCAL_NOTIFICATION_USER = 'gui-user';
export function notificationUserOf(req: Request): string {
  return callerPrincipalOf(req) ?? LOCAL_NOTIFICATION_USER;
}
```
All 4 handlers use it and **never read a request `user_id`**:
- `GET /api/notifications`        → `userId = notificationUserOf(req)`, `actingPrincipalId = callerPrincipalOf(req)`
- `PATCH /api/notifications` (mark-read) → `userId = notificationUserOf(req)`
- `GET /api/notifications/settings`  → `userId = notificationUserOf(req)` (keeps its existing read@project gate)
- `PUT /api/notifications/settings`  → `userId = notificationUserOf(req)` (keeps its existing write@project gate)

Under auth-ON the principal id keys notifications/settings → a caller only ever touches its own. Under auth-OFF
`callerPrincipalOf` is null → `'gui-user'` (today's dev default; existing settings rows + GUI keep working).

## 2. Defense-in-depth: filter listNotifications to readable projects (D2)
`listNotifications` (service) gains `actingPrincipalId?`. It fetches the joined rows for the user (capped at a
hard bound so unread_count stays accurate for a dormant per-user feed), then keeps a row iff it has **no**
`project_id` (a non-project-scoped personal notification) OR the principal can `read` that project:
```ts
const visible: Notification[] = [];
for (const r of rows) {
  if (!r.project_id || (await authorize(actingPrincipalId, 'read', { kind: 'project', id: r.project_id })).allow) {
    visible.push(r);
  }
}
const unread = visible.filter((r) => !r.read);
return { items: (unreadOnly ? unread : visible).slice(0, limit), unread_count: unread.length };
```
auth-OFF → `authorize` short-circuits ALLOW → every row kept (unchanged). The SQL no longer applies `unreadOnly`
/`limit` (they move to JS so the authz filter runs first); the fetch is bounded by a `MAX_SCAN` cap (e.g. 500) —
a per-user notification feed never approaches it, and it's documented.

## Acceptance criteria
1. `notificationUserOf` returns the principal under auth-ON and `'gui-user'` under auth-OFF, and NEVER the
   request-supplied `user_id` (proven by a pure test passing a req that carries both).
2. All 4 handlers derive the user via `notificationUserOf` (no `req.*.user_id` read remains).
3. `listNotifications` drops rows whose `project_id` the principal cannot read; keeps null-project rows;
   `unread_count` reflects the filtered set. auth-OFF keeps all.
4. Full suite green, tsc clean. `MCP_AUTH_ENABLED` NOT touched.
