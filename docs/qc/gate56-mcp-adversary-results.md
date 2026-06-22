# Gate 5/6 — MCP-agent + Adversary scenario results

Execution of `docs/qc/scenarios/{02-mcp-agent,03-multi-agent-coordination,04-adversary-abuse}.md`
against the hardened (auth-ON) stack at `:3002`. Adversary scenarios run via curl (no creds
needed for auth-gate probes; minted+revoked scoped/global test keys for cross-tenant probes).

Legend: ✅ live-pass · 🛡️ defended (existing automated coverage cited) · 🐛 bug · ⏳ pending

## Adversary & abuse (`04-adversary-abuse.md`, 22)

| # | Class | Result | Evidence |
|---|-------|--------|----------|
| ADV-01 | cross-tenant read | ✅ | scoped(chalk-demo)+bound key: own project **200**; `free-context-hub` **404**; unknown project **404** (same byte shape — no existence oracle); **unbound** key fail-closed 404. |
| ADV-02 | cross-tenant write | 🛡️ | `assertLessonScope` per-id; DEFERRED-029 suite (843 unit + 300 e2e). Same 404-no-oracle path as ADV-01 (shared `assertCallerScope`). |
| ADV-03 | cross-tenant board/task/artifact | 🛡️ | DB-derive `assertTopic/Task/ArtifactScope`; DEFERRED-029 PR C/D. |
| ADV-04 | cross-tenant governance | 🛡️ | `assertMotion/Request/IntakeScope` incl. SEC-2 triage `topic_id` check; DEFERRED-029. |
| ADV-05 | missing/forged Bearer | ✅ | no-auth/random/Basic/never-issued → **401** each; `{"error":"Unauthorized: invalid token"}`. |
| ADV-06 | retired legacy token | ✅ | legacy `CONTEXT_HUB_WORKSPACE_TOKEN` → **401** `"legacy single-shared token disabled — use a scoped api_keys token"`. |
| ADV-07 | expired/revoked key reuse | 🛡️ | `validateApiKey` null on expired/revoked (verified indirectly: revoked QC keys stop working); apiKeys tests. |
| ADV-08 | self-granted capability | 🛡️ | `authorize` requires grant at/above target scope; `is_root`-only bypass; authorize.ts + DEFERRED-049/029. |
| ADV-09 | fencing-token bypass | 🛡️ | atomic guarded UPDATE…WHERE; artifacts.ts fencing tests (Phase 13/15). |
| ADV-10 | SSRF to metadata/internal | 🛡️ | `assertHostAllowed` (v4+v6, IPv4-mapped, numeric forms); security-trio SEC-C; urlFetch tests. |
| ADV-11 | DNS-rebinding TOCTOU | 🛡️ | IP-pinning (`pinnedHttpAgent.test.ts` green) + per-hop re-check; **verified DEFENDED in security trio**. |
| ADV-12 | pull-from internal endpoint | 🛡️ | `assertAuthorized` before remote call + `assertHostAllowed` loopback block; pullFromRemote tests. |
| ADV-13 | injection (SQL/FTS/XSS) | 🛡️ | parameterized DB (DEFERRED-029 convention); Phase 8 XSS fix; tsquery sanitize. (GUI stored-XSS spot-check pending in Gate 4.) |
| ADV-14 | lockout DoS / reset bypass | 🛡️ | DEFERRED-060 A4 auto-expiring hard lock + reset-clears-never-sets; lockout tests. |
| ADV-15 | MFA bypass / backup replay | 🛡️ | mandatory factor, single-use backup codes, throttled TOTP; mfa.ts tests. |
| ADV-16 | session fixation/hijack | 🛡️ | fresh session id on login, server-side revoke, HttpOnly+SameSite, exact cookie-name match; sessions tests. |
| ADV-17 | bootstrap-token abuse | ✅ | `/status` no-token → **401** `"bootstrap token required"`; `/root` empty/wrong → **401** `"invalid bootstrap token"`; constant-time compare. |
| ADV-18 | guardrail bypass | 🛡️ | server-evaluated guardrails; guardrail_audit_logs; check_guardrails tests. (Live spot-check pending.) |
| ADV-19 | oversized upload / zip bomb | 🛡️ | streaming `ByteCounter` 413; described-only per scenario. |
| ADV-20 | slow-loris pull | 🛡️ | `StallTransform` idle timer 504; described-only. |
| ADV-21 | include_groups scope widening | 🛡️ | LOW-2 strict-reject scoped callers; `assertCallerScopeMulti`; DEFERRED-029. |
| ADV-22 | worker payload smuggling | 🛡️ | SEC-1/3/6 (scope-bind null project, reject `payload.root`, scoped listJobs); DEFERRED-029. |

**Live-verified this pass:** ADV-01, 05, 06, 17 (+ ADV-11 in the earlier security trio). The cross-tenant
(ADV-02/03/04/21/22), auth-token (07), escalation (08/09), SSRF (10/12), and auth-lifecycle (14/15/16)
classes are covered by the DEFERRED-029 suite (843 unit + 300 e2e, 5 verification passes, 7 bypasses
fixed) and Phase-13/15/DEFERRED-060/061 tests. **Remaining for a fuller live pass:** ADV-13 stored-XSS
in the GUI lesson detail, ADV-18 guardrail-bypass live, a scoped-key live probe of ADV-02/03/04.

## MCP-agent (`02-mcp-agent.md`, 24) — partial (token via minted key)

Driven via MCP tools with a minted global-admin key as `workspace_token`.

| # | Scenario | Result | Evidence |
|---|----------|--------|----------|
| MCP-01 | search_lessons bootstrap | ✅ | 5 ranked, deduped, salience-weighted, reranked hits on tenant-scope query; active outrank draft. |
| MCP-02 | guardrail block | ✅ | "git push --force to main" → `pass:false`, `needs_confirmation`, actionable prompt + matched rule. |
| MCP-03 | guardrail pass (benign) | ✅ | "run unit tests locally" → `pass:true`, no false-positive block. |
| MCP-09 | tiered code search (test) | ✅ | kind=test → 33 test files, tier badges (exact/convention), semantic skipped when deterministic. |
| MCP-20 | whoami | ✅ | returns bound principal (qc-mcp-agent, agent, active, is_root=false); no secret leak. |
| MCP-04 | add_lesson (decision) | ✅ | re-verified post-fix: created `47b523fd`, distillation ok. P0 fix (`075ce4d`) holds. |
| MCP-05 | add guardrail + fire | ✅ | re-verified earlier post-rebuild. |
| MCP-06 | update + version + re-embed | 🐛→🔧 ✅ | update re-embeds (top hit 0.697 for new text), version snapshot created. **Found BUG-2: `list_lesson_versions` MCP tool threw output-validation error (`changed_at` Date vs `z.string()`).** Fixed in `listLessonVersions` (ISO-coerce); re-verified over MCP. |
| MCP-07 | lifecycle (supersede) | ✅ | supersede → absent from `active` filter → deprioritized in search. **Clarification:** service guards ONLY `pending-review` (managed state); other transitions free by design (master design L275-281) — scenario's "strict linear lifecycle" expectation is stricter than policy, not a bug. |
| MCP-08 | reflect (LLM synthesis) | ✅ | grounded answer from 12 retrieved lessons; drew only from stored content (items-key, dedup project_id+lesson_type), no hallucination, project-scoped. |
| MCP-21 | artifact lease (claim/check/list/release) | ✅ | claim→leased; 2nd agent → `conflict` (mutual exclusion); non-owner release → `not_owner`; release → `available:true`, claims list empty (no ghost). |
| MCP-22 | renew lease | ✅ | holder renews (+30m, expiry extended); impostor → `not_owner` (no lease theft). |
| MCP-23 | submit_for_review | ✅ happy-path; ⚠️ FINDING | draft→submit→`pending` queue with full metadata; lesson → `pending-review`. **FINDING-GOV (design decision):** `search_lessons` returned the pending-review lesson as the **#1 hit** — draft+pending-review are retrievable by default (all 3 retrieval paths filter only `status NOT IN ('superseded','archived')`). Contradicts the convention "pending-review ≠ active knowledge until approved." Also: `add_lesson` mints `active` directly (review is opt-in). Batched for owner decision (design-first). |
| MCP-24 | topic replay (join/replay/board) | ✅ | replay = strict append-only ordered log (seq 1→6, ISO ts, full motion lifecycle), cursor+has_more correct; join auto-registers + induction pack (replay-from-cursor); **double-join idempotent** (no dup roster/event); **actor_id spoof blocked** (identity derived from credential — security positive). |
| MCP-10..19 | doc-search/vector/chunk/generated-docs/git/index/jobs | ⏳ | remaining MCP-agent sub-batch (several P2/feature-gated: 16/17 KG-off skip). |

### 🐛→🔧 P0 BUG FOUND + FIXED — add_lesson broken under auth-ON (commit `075ce4d`)

**Severity:** P0 release blocker. **Found by:** MCP-04/05 + GUI-03 (cross-confirmed).

`POST /api/lessons`, MCP `add_lesson`, and the GUI "Add Lesson" all returned `404 "not found"`
for **every** authenticated caller (Bearer key AND session cookie) on the hardened stack.

Root cause: `addLesson` authorizes write, then `validateLessonType → getValidLessonTypes →
getActiveProfile` runs a nested `assertAuthorized(principal,'read',project)` — but the principal
was **not threaded** through, so under `MCP_AUTH_ENABLED=true` it ran with `undefined` →
`NO_PRINCIPAL` → `NOT_FOUND`, aborting the write. Only manifested auth-ON (auth-OFF short-circuits),
so it slipped past existing tests — exactly what hardened-stack QC is for.

Fix: thread `actingPrincipalId` through `getValidLessonTypes` + `validateLessonType`; also fixed the
`get_active_taxonomy_profile` MCP handler (passed principal to getActiveProfile but not
getValidLessonTypes). Verified on host with auth-ON: addLesson succeeds (was NOT_FOUND); tsc clean.

> 🔵 Secondary: an undefined-principal authz denial surfaces as a bare `404 "not found"` to the
> agent — correct for tenant-isolation (no oracle), but for an internal mis-thread it's a confusing
> signal. The fix removes the mis-thread; the error shape itself is by design.

## Coordination (`03-multi-agent-coordination.md`, 26) — ⏳ pending

The coordination machinery was exercised through the GUI walkthrough (topics/board/motions/requests/
intake all operated live). The 26 scenario-level multi-agent flows remain to run via MCP/REST.
