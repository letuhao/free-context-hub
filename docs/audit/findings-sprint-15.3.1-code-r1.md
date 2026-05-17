# Sprint 15.3.1 — REVIEW-CODE — /review-impl round 1

**Reviewer:** main session, `/review-impl` adversarial implementation review.
**Scope:** the uncommitted 15.3.1 implementation — `src/services/requests.ts`,
`src/api/routes/requests.ts`, `src/mcp/index.ts`, `src/services/requests.test.ts`,
`src/api/routes/requests.test.ts`. Against DESIGN rev 3 (`e8b03d5b5f5b71d2`).
**Verdict:** 0 HIGH, 0 MED, 5 LOW. The code is tsc-clean + 428-test-proven + 5/5
live-smoke-proven; all findings are test-quality / consistency.

## Findings

### LOW-1 — test-shim used a non-idiomatic cast; `tsc` does not typecheck test files — FIXED
`src/api/routes/requests.test.ts` (the `before()` shim). `tsconfig.json` has
`"exclude": ["**/*.test.ts"]`, so `npm run build` never typechecks test files (they run via
`tsx`, which strips types). The shim cast `(req as Record<string, unknown>)` is not the
codebase idiom (`auth.ts` uses `(req as any)`; `routes/requests.ts` uses the typed extension
`req as Request & { apiKeyName?: string }`) and is not guaranteed to typecheck.
**Fix applied:** changed to `req as unknown as { apiKeyName?: string; apiKeyRole?: string }`
— a double assertion through `unknown` that always typechecks, with typed property access.

### LOW-2 — F1 decide-route had no positive "match" test — FIXED
`src/api/routes/requests.test.ts`. The F1 suite covered submit-match (201), submit-omitted
(201), submit-mismatch (403), decide-mismatch (403) — but not decide-match (the decide route
passing the resolved actor through to `decideStep` on a successful identity match).
**Fix applied:** added `F1: POST decide — apiKeyName == body actor_id → endorses (200)`.

### LOW-3 — F7 256-char boundary (exactly-256 allowed) not asserted — ACCEPT
`requests.test.ts` F7 tests assert 257 chars → `BAD_REQUEST`; the exact-256 "allowed" side is
not asserted. The cap is a plain `kind.length > MAX_FIELD_LEN`; the 19 existing service tests
all use short kinds (well-formed inputs pass). An exact-256 test is marginal over-coverage of
a `>` comparison. Accept.

### LOW-4 — F3a AC4 guard cannot isolate the 2b derivation — ACCEPT (documented)
`requests.test.ts` "approved request emits artifact events on the artifact topic" — because
F3a-2a guarantees `artifact.topic_id == request.topic_id`, the test cannot distinguish
"`resolveArtifact` derives the topic from the artifact" (2b) from "the topic was passed in"
(old code). This is inherent — an approvable request *cannot* have a topic-mismatched
artifact (2a rejects it at submit). The test is a valid regression guard that artifact
events still emit on the correct topic. Already documented in DESIGN §7/§8. Accept.

### LOW-5 — `submitted_by` / `actor_id` are not length-capped (asymmetry with F7) — ACCEPT (documented)
`requests.ts`. F7 caps `kind` / `subject_id` (256); `submitted_by` / `actor_id` — also
free-text written to rows + event JSONB — are not capped. Defensible and consistent with the
audit's F7 scope (the audit named only `kind`/`subject_id`): under `MCP_AUTH_ENABLED=true` the
acting identity is `apiKeyName`, bounded ≤128 by `createApiKey`; under auth-off it is
operator-chosen (the trusted dev posture). Accept; noted here for the next `requests.ts` touch.

## Re-verification

LOW-1 + LOW-2 are test-file-only changes. `npx tsx --test src/api/routes/requests.test.ts`
re-run after the fixes → 15/15 (was 14/14; +1 from LOW-2). `requests.test.ts` unchanged
(25/25). Full-suite count is now 429. No HIGH/MED → no loop back to VERIFY required.
