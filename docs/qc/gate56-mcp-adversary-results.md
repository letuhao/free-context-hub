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

## MCP-agent (`02-mcp-agent.md`, 24) — ⏳ pending

Blocked on a valid MCP `workspace_token` for this client (the contexthub MCP tools returned
`invalid workspace_token`). Next pass: supply a freshly-minted scoped key as `workspace_token` and
drive the 24 agent scenarios via the MCP tools (cheap, no browser).

## Coordination (`03-multi-agent-coordination.md`, 26) — ⏳ pending

The coordination machinery was exercised through the GUI walkthrough (topics/board/motions/requests/
intake all operated live). The 26 scenario-level multi-agent flows remain to run via MCP/REST.
