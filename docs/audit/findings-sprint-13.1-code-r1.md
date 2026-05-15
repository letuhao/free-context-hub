# Sprint 13.1 — Code Review Round 1 (Adversary)

**Verdict:** REJECTED (1 BLOCK, 2 WARN)
**Spec hash reviewed:** f14ede2370dcfec5 (v2.1)

## Finding 1 (BLOCK) — `GET /:leaseId` bypasses service module and lies on miss

**Issue:** Route at `src/api/routes/artifactLeases.ts:64-89`: (a) embeds raw SQL inside the handler, violating "thin handler + service" architecture; (b) does dynamic `await import('../../db/client.js')` per request; (c) returns wrong semantic answer on miss — when lease_id is absent (released/expired/never existed), returns `{available: true}` but caller asked about a *lease*, not an artifact. AC10 ("REST mirrors MCP 1:1") is unverified because MCP exposes no `get_lease_by_id` tool — this route is unilaterally invented by REST with no spec backing.

**Where:** `src/api/routes/artifactLeases.ts:64-89`; design `:504-522`; AC10.

**Why it matters:** Architecture rot + contract bug + zero test coverage of REST layer.

**Question for implementer:** Delete the route, or move SQL into `getLeaseById(project_id, lease_id)` service function with correct `{status: 'found' | 'not_found', lease?: LeaseSummary}` shape.

## Finding 2 (WARN) — MCP `outputSchema` for `claim_artifact` is not a discriminated union

**Issue:** `src/mcp/index.ts:2696-2705` declares flat `z.object` with optional fields; service TS `ClaimResult` is a real discriminated union. MCP clients lose type safety. Pattern repeated on `renew_artifact` and `check_artifact_availability`.

**Where:** `src/mcp/index.ts:2696-2705` vs design `:488`.

**Why it matters:** AC10 says REST mirrors MCP; both surfaces now expose weaker schema than implementation.

**Question for implementer:** Was flatten intentional? If no, restore `z.discriminatedUnion('status', [...])`.

## Finding 3 (WARN) — `validateClaimInput` accepts arbitrary `artifact_type`

**Issue:** `src/services/artifactLeases.ts:322-329` validates `artifact_id` regex but accepts any non-empty string for `artifact_type`. Spec enumerates 4 valid types. Caller passing `'LESSON'` (uppercase) or `'lessson'` (typo) succeeds — invisible to correctly-typed `list_active_claims({artifact_type:'lesson'})` filter.

**Where:** `src/services/artifactLeases.ts:322-329`; CLARIFY AC8; MCP tool description.

**Why it matters:** Silent partitioning of artifact namespace.

**Question for implementer:** Enforce closed enum OR lowercase-normalize at service boundary.
