# 04 — Adversary & Abuse Scenarios (negative testing)

**Scope: authorized, white-hat defensive QC.** These scenarios probe free-context-hub's
own auth, tenant-isolation, injection, broken-flow, and abuse surfaces *before* an
open-source release. Nothing here is an instruction to attack a third party; every target
is the local stack we ship (gateway `http://localhost:3002`, backend bound to `127.0.0.1`).
The intent is to drive **negative tests** — each scenario states the ATTACK and the
REQUIRED DEFENSE (expected outcome = *blocked* with the correct status code, no data leak,
attempt audited). A scenario that "passes" means the defense held.

Grounded in real surfaces: `FEATURES.md`, `docs/features/08-access-control-identity.md`,
`docs/deferred-029-closeout.md`, and the implementing code (`src/api/middleware/auth.ts`,
`src/services/urlFetch.ts`, `src/services/exchange/pullFromRemote.ts`,
`src/services/lockout.ts`, `src/services/mfa.ts`, `src/services/artifacts.ts`,
`src/api/routes/bootstrap.ts`).

**Preconditions vocabulary.** `MCP_AUTH_ENABLED=true` (enforcement on) unless noted —
scenarios assume the hardened posture, since auth-off is "everything allowed" by design
(`callerScope=undefined` → UNRESTRICTED). "Scoped key for project A" = an `api_keys` row
with `project_scope='A'`. The DEFERRED-029 invariant under test: cross-tenant access yields
`NOT_FOUND` with the *same byte shape* as an unknown-id 404 (no existence oracle).

---

### SCN-ADV-01 — Cross-tenant lesson read with a project-A scoped key
- **Priority:** P0
- **Class:** (1) cross-tenant access
- **Surfaces:** REST `GET /api/lessons?project_id=B`, `POST /api/lessons/search`; MCP `list_lessons`, `search_lessons`
- **Preconditions:** Attacker holds a valid scoped api_key bound to `project_scope='A'`. Project B exists with known/guessed id and contains lessons.
- **Steps:**
  1. Call `GET /api/lessons?project_id=B` with the project-A Bearer token.
  2. Call `POST /api/lessons/search` with body `{ project_id: "B", query: "secret" }`.
  3. Repeat over MCP `list_lessons`/`search_lessons` with the same scoped token.
- **Expected (defense):**
  - `NOT_FOUND` / empty result with the **same byte shape** as an unknown-project 404 — no rows from B, no count, no "exists but forbidden" distinction (no existence oracle).
  - Identical behavior on REST and MCP (both inherit `assertCallerScope`).
  - Attempt recorded in agent/guardrail audit trail.
- **Watch for (real risk):** any B lesson content, ids, titles, or a 403-vs-404 difference that confirms B exists; MCP path leaking where REST blocks (transport divergence).

### SCN-ADV-02 — Cross-tenant write/update of another project's lesson
- **Priority:** P0
- **Class:** (1) cross-tenant access
- **Surfaces:** REST `PUT/PATCH /api/lessons/:id`, `PATCH .../status`; MCP `update_lesson`, `update_lesson_status`
- **Preconditions:** Scoped key for project A. A lesson id `L_b` belonging to project B (guessed or leaked).
- **Steps:**
  1. `PUT /api/lessons/L_b` with new content as the project-A key.
  2. `update_lesson_status(L_b, 'archived')` over MCP.
  3. Attempt the cross-table edge: link a B document to `L_b` (`linkDocumentToLesson`).
- **Expected (defense):**
  - `NOT_FOUND` (no oracle), no mutation to B's row, no version appended.
  - `assertLessonScope` checks **every** caller-supplied id (the SEC-4 "scope-check resource, miss secondary id" class) — both lesson and document scoped.
- **Watch for (real risk):** a 200/version-bump on B's lesson; the edge-write path mutating B because only one of the two ids was scope-checked.

### SCN-ADV-03 — Cross-tenant board / task / artifact reach
- **Priority:** P0
- **Class:** (1) cross-tenant access · (4) fencing
- **Surfaces:** MCP `list_board`, `claim_task`, `write_artifact`; REST `/api/topics/:id/tasks`, `/api/projects/:id/artifact-leases`
- **Preconditions:** Scoped key for project A. A topic/task/artifact id in project B.
- **Steps:**
  1. `list_board` / `GET /api/topics/B_topic/events` with the A key.
  2. `claim_task(B_task)` then `write_artifact(B_artifact, ...)`.
- **Expected (defense):**
  - `NOT_FOUND` from the DB-derive helpers (`assertTopicScope`, `assertTaskScope`, `assertArtifactScope`) — the entity's project_id is DB-derived and checked, not trusted from the caller.
  - No event appended to B's topic log.
- **Watch for (real risk):** B's task board contents returned; a claim/write landing on B; event-log injection into B's topic (the Adversary-#3 class).

### SCN-ADV-04 — Cross-tenant governance: motion/vote/dispute in another project
- **Priority:** P0
- **Class:** (1) cross-tenant access · (3) privilege escalation
- **Surfaces:** MCP `propose_motion`, `cast_vote`, `tally_motion`, `open_dispute`, `decide_request_step`; REST `/api/topics/:id/motions`, `/api/intake`
- **Preconditions:** Scoped key for project A. Known motion/request/intake id in project B.
- **Steps:**
  1. `cast_vote(B_motion, 'yes')` and `tally_motion(B_motion)`.
  2. `decide_request_step(B_request, 'approve')` to forge an approval in B's DoA matrix.
  3. `triage_intake` routing a B intake to an attacker-chosen topic id (the SEC-2 trap).
- **Expected (defense):**
  - `NOT_FOUND` via `assertMotionScope`/`assertRequestScope`/`assertIntakeScope`; the route `topic_id` in triage is itself scope-checked (SEC-2 fix), not just the intake.
  - No vote tallied, no request advanced, no coordination event written cross-tenant.
- **Watch for (real risk):** a governance outcome (approval/vote/veto) recorded in B; intake triage writing an event to a topic the caller never proved scope on.

### SCN-ADV-05 — Missing / malformed / forged Bearer token
- **Priority:** P0
- **Class:** (2) auth token
- **Surfaces:** REST blanket gate (`bearerAuth`), all `/api/*` except pre-auth bootstrap; MCP transport
- **Preconditions:** `MCP_AUTH_ENABLED=true`. Attacker has no valid credential.
- **Steps:**
  1. Call a protected endpoint with **no** `Authorization` header and no session cookie.
  2. Call with `Authorization: Basic ...` and with `Authorization: Bearer <random-256-bit>`.
  3. Call with a structurally valid but never-issued token.
- **Expected (defense):**
  - `401 Unauthorized` — `{ "error": "Unauthorized: missing Bearer token" }` (no header) and `{ "error": "Unauthorized: invalid token" }` (bad token).
  - `validateApiKey` is a SHA-256 hash lookup — a forged token cannot match without the plaintext.
  - Cookie-less, header-less requests are NOT silently allowed (only an *exact* session-cookie name defers to `sessionAuth`).
- **Watch for (real risk):** any 200 on a header-less request; a substring/suffix-collision cookie name triggering the `sessionAuth` defer; timing difference between "unknown key" and "valid key wrong scope" that enumerates keys.

### SCN-ADV-06 — Retired legacy workspace token still accepted on REST
- **Priority:** P0
- **Class:** (2) auth token
- **Surfaces:** REST `bearerAuth`, MCP `auth.ts`
- **Preconditions:** `MCP_AUTH_ENABLED=true` AND `MCP_LEGACY_TOKEN_DISABLED=true`. The deployment still has `CONTEXT_HUB_WORKSPACE_TOKEN` set in env (mid-migration).
- **Steps:**
  1. Call `GET /api/lessons` with `Authorization: Bearer <CONTEXT_HUB_WORKSPACE_TOKEN value>`.
  2. Repeat the same token over the MCP transport.
- **Expected (defense):**
  - `401` on BOTH transports — `{ "error": "Unauthorized: legacy single-shared token disabled — use a scoped api_keys token" }`. This is the SEC-7 fix: REST must mirror MCP, not just the doc claiming it.
  - A `logger.warn` records the rejected attempt with a token prefix (not the full secret).
- **Watch for (real risk):** REST accepting the legacy token while MCP rejects it (the exact SEC-7 documentation/implementation mismatch) — an admin-role bypass, since the legacy token maps to UNRESTRICTED/`callerScope=null`.

### SCN-ADV-07 — Expired / revoked ephemeral key reuse
- **Priority:** P1
- **Class:** (2) auth token
- **Surfaces:** MCP `mint_ephemeral_key`; REST `/api/api-keys`, `/api/access-review`
- **Preconditions:** Attacker captured a short-lived (1–24h) ephemeral key that has since expired or been revoked.
- **Steps:**
  1. Use the captured ephemeral key after its TTL window.
  2. Use a key after an admin revoked it via access-review.
- **Expected (defense):**
  - `401` — `validateApiKey` returns null for expired/revoked rows; no grace window.
  - Access-review reflects the key as stale/revoked.
- **Watch for (real risk):** a key validating past its `expires_at`; revocation that only hides the key in the UI but still validates server-side.

### SCN-ADV-08 — Privilege escalation via self-granted capability
- **Priority:** P0
- **Class:** (3) privilege escalation
- **Surfaces:** MCP `grant_capability`, `grant_proxy`, `grant_level`; REST `/api/grants`, `/api/authz`
- **Preconditions:** Attacker holds a `reader`-role or project-A-scoped key (not admin/global).
- **Steps:**
  1. `grant_capability` to grant themselves `admin` at `@global` scope.
  2. `grant_proxy` making themselves a proxy for the root/operator principal.
  3. `grant_capability` at scope B (a project they have no grant in).
- **Expected (defense):**
  - `403`/authorization-denied — granting requires an existing grant *at or above* the target scope; a reader/scoped principal cannot mint authority it doesn't hold (no privilege amplification).
  - `explain_authorization` for the would-be action returns "denied" with the missing-grant reason.
  - The attempted grant is NOT persisted.
- **Watch for (real risk):** a grant landing that the grantor had no authority to make; proxy chains that let A act as root; a scoped key writing a grant for a project outside its scope.

### SCN-ADV-09 — Fencing-token bypass on artifact write (stale holder)
- **Priority:** P0
- **Class:** (4) fencing-token bypass
- **Surfaces:** MCP `write_artifact`, `baseline_artifact`, `claim_artifact`, `renew_artifact`
- **Preconditions:** Attacker once held a claim on an artifact (fencing token N) but the claim expired/was superseded; a newer holder advanced `accepted_fencing_token` to M > N.
- **Steps:**
  1. Replay `write_artifact` with the stale `fencing_token=N` and the old `claim_id`.
  2. Try `write_artifact` with another actor's *live* claim id (claim not owned).
  3. Try a huge `fencing_token=Number.MAX_SAFE_INTEGER` with no live claim.
- **Expected (defense):**
  - `status: 'conflict'` with `reason: 'fencing_token_stale'` (token ≤ accepted), `'claim_not_owned'` (live claim, wrong actor — the HIGH-1 `c.actor_id = actorId` clause), or `'claim_not_live'`.
  - The guarded `UPDATE … WHERE … RETURNING` matches 0 rows; the re-SELECT only classifies — never re-attempts. No version appended, no event written.
  - Non-finite / NaN `fencing_token` → `BAD_REQUEST`.
- **Watch for (real risk):** a stale token overwriting a newer version (lost update); writing under another actor's claim; a TOCTOU window between the liveness check and the write (the checks must be fused into one atomic statement).

### SCN-ADV-10 — SSRF to cloud metadata / internal services via URL ingestion
- **Priority:** P0
- **Class:** (5) SSRF / DNS-rebinding
- **Surfaces:** REST `POST /api/documents/ingest-url`
- **Preconditions:** Attacker can submit a document URL (any authenticated writer). `ALLOW_PRIVATE_FETCH_FOR_TESTS` is unset (production).
- **Steps:**
  1. Ingest `http://169.254.169.254/latest/meta-data/iam/security-credentials/`.
  2. Ingest `http://localhost:3001/api/...`, `http://127.0.0.1`, `http://[::1]`, `http://10.0.0.5`, `http://100.64.0.1` (CGNAT), `http://[::ffff:127.0.0.1]` (IPv4-mapped).
  3. Use a decimal/octal/hex-encoded IP (`http://2130706433/`) and a `0x`/`017700000001` form.
- **Expected (defense):**
  - `403` `SSRF_BLOCKED` — `assertHostAllowed` DNS-resolves and rejects loopback / link-local / RFC1918 / CGNAT / multicast / reserved for IPv4 **and** IPv6 (incl. IPv4-mapped extraction). Scheme allowlist rejects non-http(s).
  - No outbound connection to the internal address; no metadata creds returned in the document body.
- **Watch for (real risk):** the metadata response stored as a document (credential exfil); a numeric-IP encoding form that bypasses `isPrivateIPv4` parsing; `file://`/`gopher://` accepted.

### SCN-ADV-11 — DNS-rebinding TOCTOU on URL ingestion and cross-instance pull
- **Priority:** P0
- **Class:** (5) SSRF / DNS-rebinding
- **Surfaces:** REST `POST /api/documents/ingest-url`; REST `POST /api/projects/:id/pull-from`
- **Preconditions:** Attacker controls a DNS name whose record flips: public IP on the validation lookup, `127.0.0.1`/RFC1918 on the connect.
- **Steps:**
  1. Ingest `http://rebind.attacker.test/doc.pdf` where the record returns a public IP first, then a private IP a moment later.
  2. Repeat against `pull-from` with `remote_url=http://rebind.attacker.test`.
  3. Chain a redirect (`302 → http://169.254.169.254`) to bypass per-hop checks.
- **Expected (defense):**
  - The validated address is **pinned** (`pinnedAgentForAddress`) — undici connects to the exact IP `assertHostAllowed` approved, so no second DNS lookup can occur (TOCTOU closed).
  - Each redirect hop re-runs `assertHostAllowed` (max 5 hops); cross-origin redirect strips `Authorization`.
- **Watch for (real risk):** a connect to a private IP after a public validation (rebind succeeded); a redirect hop reaching `169.254.169.254`; `Authorization` header forwarded to a redirected attacker origin.

### SCN-ADV-12 — Cross-instance pull pointed at an internal export endpoint
- **Priority:** P1
- **Class:** (5) SSRF · (1) cross-tenant
- **Surfaces:** REST `POST /api/projects/:id/pull-from`
- **Preconditions:** Authenticated writer for local project A. `remote_url` controllable.
- **Steps:**
  1. `pull-from` with `remote_url=http://127.0.0.1:3001`, `remote_project_id=B`, targeting local A — to siphon another local project's bundle into A.
  2. Inject control chars / CRLF into `api_key` (header-injection attempt).
  3. Supply a 10 KB `remote_project_id` and a non-zip `Content-Type` from the "remote".
- **Expected (defense):**
  - `403 ssrf_blocked` on the loopback origin (same `assertHostAllowed` guard); `assertAuthorized` first enforces **write on local A** before any remote call.
  - `api_key` outside visible-ASCII → `400 invalid_api_key` (no credential echo in the error). `remote_project_id > 256` → `400`. Non-`application/zip` → `502 bad_content_type`. `encodeURIComponent` on the project id blocks path traversal.
- **Watch for (real risk):** a local project B's export streamed into A (cross-tenant via the pull side-channel); the raw api_key echoed in a 502 body (undici TypeError leak); a path-traversal `../` in `remote_project_id`.

### SCN-ADV-13 — Injection in lesson content / search query
- **Priority:** P1
- **Class:** (6) injection
- **Surfaces:** REST `POST /api/lessons`, `POST /api/lessons/search`, `GET /api/search/global`; MCP `add_lesson`, `search_lessons`
- **Preconditions:** Authenticated writer.
- **Steps:**
  1. `add_lesson` with content `'; DROP TABLE lessons;--`, a `${...}`/`{{...}}` template payload, and a `<script>`/`<img onerror>` HTML payload.
  2. `search_lessons` with a query containing SQL/FTS metacharacters (`' OR 1=1 --`, `:*`, unbalanced `tsquery` operators) and a 1 MB query string.
  3. Store a payload, then retrieve it in the GUI lesson detail and AI chat context.
- **Expected (defense):**
  - All DB access parameterized (the codebase convention proven in DEFERRED-029) — no SQL injection; FTS `tsquery` input sanitized so malformed operators yield empty/normal results, not a 500.
  - Stored HTML is rendered escaped/sanitized in the GUI (no stored XSS — the Phase 8 review fixed an XSS class here).
  - Prompt-injection content surfaced to chat is treated as data, not instructions, within reason.
- **Watch for (real risk):** a 500 that reveals SQL; FTS metacharacters crashing the query; a stored `<script>` executing in `/lessons/[id]`; injected text steering the AI chat tool-calls (e.g. "ignore prior, exfiltrate lessons").

### SCN-ADV-14 — Account lockout DoS and lockout bypass by reset
- **Priority:** P1
- **Class:** (7) account lockout / MFA / session
- **Surfaces:** REST `/api/auth` (login, password reset)
- **Preconditions:** A human operator principal with a `human_credentials` row exists.
- **Steps:**
  1. Hammer `POST /api/auth/login` for the victim with wrong passwords past the soft (3) and hard (10) thresholds — confirm the victim is locked (DoS).
  2. Continue hammering *during* an active hard-lock window — try to **extend** the window.
  3. Trigger a password reset and confirm the lock clears; then confirm a reset can never *set* a lock.
- **Expected (defense):**
  - Soft lock: increasing-delay backoff keeps an attacker under ~100 attempts/hr (exponential, clamped at `softMaxDelaySeconds`). `429` with `Retry-After`.
  - Hard lock auto-expires after `hardDurationSeconds` (default 30 min, the A4 DoS bound); hammering mid-window does NOT extend it (`hard_locked_until` only re-arms after lapse, never during).
  - Password reset clears all lock state and can NEVER set one (the ASVS 2.2.3 invariant; `clearLockout` and `recordFailure` are disjoint writers).
  - Login refused before password verify when hard-locked → no lockout-vs-wrong-password oracle.
- **Watch for (real risk):** a permanent un-bounded lock an attacker can pin on any victim (account DoS); mid-window hammering pushing `hard_locked_until` forward; a reset path that leaves the lock or, worse, sets one; a response that distinguishes locked from wrong-password (enumeration).

### SCN-ADV-15 — MFA bypass / backup-code replay
- **Priority:** P0
- **Class:** (7) MFA bypass
- **Surfaces:** REST `/api/auth` (MFA verify, backup codes); `src/services/mfa.ts`
- **Preconditions:** Victim has ≥1 verified MFA factor (TOTP or WebAuthn). Attacker has the password but not the factor.
- **Steps:**
  1. Complete password step, then skip/omit the MFA step and try to obtain a session (`null`/empty TOTP, missing factor).
  2. Replay a previously-used TOTP code within the same 30s step; replay a backup code already consumed.
  3. Brute the 6-digit TOTP across many attempts.
- **Expected (defense):**
  - No AAL2 session without a verified factor — the MFA step is mandatory once a factor exists; a missing/blank code is rejected.
  - Backup codes are single-use: consumed codes are struck (sha256-hashed compare) and a replay is rejected.
  - TOTP brute-force is throttled by the same lockout backoff; codes are time-window bound.
- **Watch for (real risk):** a session minted after only the password step; a backup code that works twice; an unthrottled 6-digit TOTP brute (10^6 space); accepting a code from a far-off time window.

### SCN-ADV-16 — Session fixation / hijack / non-revocation
- **Priority:** P1
- **Class:** (7) session fixation
- **Surfaces:** REST `/api/auth` (login, logout), `/api/auth` session list; GUI `/settings/sessions`
- **Preconditions:** Attacker can plant or capture a session cookie value.
- **Steps:**
  1. Plant a known session cookie pre-login, authenticate the victim, and check whether the pre-login id is now authenticated (fixation).
  2. After the victim revokes a session in `/settings/sessions`, reuse the old cookie.
  3. Probe cookie flags (`HttpOnly`, `Secure`, `SameSite`) and the exact-name match in `bearerAuth`.
- **Expected (defense):**
  - A fresh session id is issued on login (the pre-auth value is not adopted — no fixation).
  - Revoked sessions are rejected immediately server-side; logout invalidates the cookie.
  - Session cookie is `HttpOnly` + `Secure` + `SameSite`; only an *exact* `SESSION_COOKIE_NAME` defers `bearerAuth` to `sessionAuth` (suffix-collision name cannot trigger the defer).
- **Watch for (real risk):** a planted cookie surviving login (fixation); a revoked session still valid; a missing `HttpOnly`/`SameSite` enabling theft/CSRF; a cookie named `x-<SESSION_COOKIE_NAME>` slipping past the exact-match guard.

### SCN-ADV-17 — Bootstrap-token abuse on a fresh / re-exposed deployment
- **Priority:** P0
- **Class:** (8) bootstrap-token abuse
- **Surfaces:** REST `/api/bootstrap/{status,root,operator,enforce}` (pre-auth router)
- **Preconditions:** `/api/bootstrap` is mounted before the auth gate. Attacker can reach it; `ROOT_BOOTSTRAP_TOKEN` is the only gate.
- **Steps:**
  1. Call `GET /api/bootstrap/status` with **no** token (recon: is root established? enforce-ready?).
  2. Call `POST /api/bootstrap/root` with a guessed/empty/wrong token to seed a rogue root.
  3. If a token is set but root already exists, replay `/root` to reissue/steal the root credential; brute the token with timing analysis.
  4. Issue a rogue `/operator` invite to an attacker-controlled email.
- **Expected (defense):**
  - Every route (incl. `/status`) is `ROOT_BOOTSTRAP_TOKEN`-gated — no token → `401`; the read is gated too, so it's not a recon oracle.
  - Token compare is constant-time SHA-256 (`secretsMatch` / `timingSafeEqual`) — no timing leak.
  - No configured token → `400` (refuses to bootstrap), not an open default.
  - `/operator` requires root to already exist and is attributed to root; the invite is single-use with an expiry.
- **Watch for (real risk):** `/status` answering without a token (deployment-state recon); a guessable/empty token seeding a rogue root → full takeover; a timing side-channel on the compare; `/root` reissuing a usable root credential to an unauthenticated caller.

### SCN-ADV-18 — Acting on a risky operation without check_guardrails
- **Priority:** P1
- **Class:** (9) guardrail bypass
- **Surfaces:** MCP `check_guardrails`, then `delete_workspace`, `ingest_git_history`, schema/migration paths; REST `/api/guardrails/check`
- **Preconditions:** Authenticated agent/principal with write authority on the target project.
- **Steps:**
  1. Call a destructive tool (`delete_workspace`, mass `update_lesson_status`, import with `policy=overwrite`) **without** first calling `check_guardrails`.
  2. Call `check_guardrails`, receive `pass:false`, then proceed anyway (ignore the gate).
  3. Forge a stale/forged "guardrail passed" assertion as input to the destructive call.
- **Expected (defense):**
  - The guardrail decision is **server-evaluated**, not a client claim — destructive service paths re-check policy server-side; a client cannot smuggle a "passed" flag to skip it.
  - A `pass:false` decision blocks (or routes to human approval); the attempt is written to `guardrail_audit_logs` for the agent-audit trail.
  - Authorization (write scope) is still enforced independently of guardrails.
- **Watch for (real risk):** a destructive op that trusts a caller-supplied "guardrail_ok"; a path that performs the action with no server-side policy re-check; `check_guardrails` being purely advisory with no enforcement coupling on the truly destructive tools.

### SCN-ADV-19 — Oversized upload / decompression bomb (DoS) — describe, do not execute destructively
- **Priority:** P2
- **Class:** (10) DoS-ish
- **Surfaces:** REST `POST /api/documents/upload`, `POST /api/documents/ingest-url`, `POST /api/projects/:id/import` (multipart)
- **Preconditions:** Authenticated writer. *Describe only — do not run against shared infra.*
- **Steps (described, not executed against shared infra):**
  1. Upload a file just over the 10 MB multipart cap; lie about `Content-Length` (small) then stream a large body.
  2. Ingest a URL whose server reports a small `Content-Length` but streams unbounded bytes.
  3. Import a 500 MB+ bundle, or a small zip that decompresses to many GB (zip bomb) into `/import`.
- **Expected (defense):**
  - Hard caps enforced by a **streaming byte counter**, not just the declared header: URL fetch caps at `MAX_SIZE_BYTES` (10 MB) and aborts mid-stream; import/pull caps at `MAX_BUNDLE_BYTES` (500 MB) via `ByteCounter`.
  - `413 TOO_LARGE` once the running total exceeds the cap; the lying `Content-Length` does not bypass the stream guard.
  - Decompression is bounded (per-entry / total-size limits) so a zip bomb can't exhaust disk/RAM.
- **Watch for (real risk):** a small declared `Content-Length` that lets an unbounded body through; the cap checked only on the header; a zip bomb expanding unbounded during import.

### SCN-ADV-20 — Slow-loris drip-feed on cross-instance pull
- **Priority:** P2
- **Class:** (10) DoS-ish
- **Surfaces:** REST `POST /api/projects/:id/pull-from`
- **Preconditions:** Attacker controls the "remote" instance the pull connects to. *Describe only.*
- **Steps (described):**
  1. Accept the pull's connection, return valid `application/zip` headers, then drip one byte every ~59s under the byte cap to pin the import worker open indefinitely.
  2. Keep the connection alive past the connect timeout by sending headers promptly but stalling the body.
- **Expected (defense):**
  - `StallTransform` arms a per-chunk idle timer (`BODY_STALL_MS`, 60s) that fires `504 timeout` if no chunk arrives within the window — the slow-loris defense; armed in the constructor so a never-arriving first chunk also trips it.
  - Connect/headers bounded by `FETCH_TIMEOUT_MS`; body bounded by stall-idle + byte cap, not a single wall clock (so a legit large slow pull isn't killed).
- **Watch for (real risk):** a body stall that never times out (worker pinned); the stall timer not arming until the first chunk (first-chunk-never-arrives hang); resource exhaustion from many concurrent stalled pulls.

### SCN-ADV-21 — Multi-project read via include_groups scope widening
- **Priority:** P1
- **Class:** (1) cross-tenant access · (3) escalation
- **Surfaces:** MCP `search_lessons` (multi/group), `list_groups`, `add_project_to_group`; REST `/api/groups`
- **Preconditions:** Scoped key for project A. Project A belongs (or attacker tries to add it) to a group that also contains project B.
- **Steps:**
  1. `search_lessons` with `include_groups:true` to pull B's lessons through a shared group.
  2. `add_project_to_group` to attach a target project into a group the attacker's project is in, widening reach.
  3. Use `searchLessonsMulti` with mixed A/B project ids.
- **Expected (defense):**
  - The documented LOW-2 behavior holds: `include_groups:true` **strict-rejects** scoped callers (it does not silently widen to group_ids that fail per-pid scope) — the conservative choice.
  - `add_project_to_group` requires authority over BOTH the project and the group; a scoped key cannot rope an out-of-scope project into a group.
  - `assertCallerScopeMulti` strict-rejects any id outside scope.
- **Watch for (real risk):** group membership becoming a cross-tenant read channel; a scoped caller adding projects to groups to widen its own reach; multi-id search returning a mix where one id leaked.

### SCN-ADV-22 — Worker payload smuggling: filesystem read via enqueued job
- **Priority:** P1
- **Class:** (1) cross-tenant · (3) escalation
- **Surfaces:** MCP `enqueue_job`, `run_next_job`, `list_jobs`; REST `/api/jobs`
- **Preconditions:** Scoped key for project A. The worker runs as a trusted global actor (`callerScope=null`).
- **Steps:**
  1. `enqueue_job` as the A key, omitting `project_id` so the row is written NULL and runs unrestricted (SEC-3).
  2. Set `payload.root` to a filesystem path outside A to make the worker read it (SEC-6).
  3. `list_jobs` with neither `projectId` nor `projectIds` to read other tenants' jobs (SEC-1).
- **Expected (defense):**
  - Scoped caller omitting `project_id` is auto-bound to scope OR rejected — never written NULL (SEC-3 fix: the "if (project_id) assert" trap is closed).
  - `payload.root` (and other dangerous filesystem/url fields) is **rejected at the enqueue boundary** for scoped callers (SEC-6) — the worker never receives an attacker-chosen path.
  - `listJobs` constrains the WHERE clause to the caller's scope even when both id params are omitted (SEC-1 fix).
- **Watch for (real risk):** a NULL-project job running unrestricted; the worker reading an attacker-supplied filesystem path (cross-tenant file read); `list_jobs` returning other projects' jobs when scoping params are omitted.
```

