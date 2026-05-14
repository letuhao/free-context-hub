# Sprint 13.1 — Code Review Round 2 (Adversary)

**Verdict:** APPROVED_WITH_WARNINGS (0 BLOCK, 2 WARN)
**Spec hash reviewed:** f14ede2370dcfec5 (v2.1)

## v1 findings verification

- **r1 BLOCK 1 (GET /:leaseId):** VERIFIED — route deleted; POST /check added, mirrors MCP `check_artifact_availability` 1:1. AC10 satisfied.
- **r1 WARN 2 (flat outputSchemas):** VERIFIED — claim/renew/check all use `z.discriminatedUnion` keyed on status/available; unions match TS types.
- **r1 WARN 3 (artifact_type validation):** VERIFIED — `VALID_ARTIFACT_TYPES` Set + validateClaimInput enforcement + test for uppercase + typo cases.

## New findings in v2 (2 WARN)

### Finding 1 (WARN) — `POST /check` does not validate `artifact_type`; asymmetric enforcement

`checkArtifactAvailability` and `listActiveClaims` do not validate artifact_type — only `claimArtifact` does. A REST caller hitting `POST .../check` with `{artifact_type: "LESSON", artifact_id: "x"}` gets `{available: true}` — false negative recreating the silent-partition risk via a different surface.

**Suggestion:** Extract `validateArtifactType(t)` helper, call at top of `checkArtifactAvailability` and `listActiveClaims`.

### Finding 2 (WARN) — Stale docs reference deleted route

`docs/phase-13-design.md:217` still documents `GET /api/projects/:id/artifact-leases/:leaseId   status check`. `docs/plans/2026-05-15-phase-13-sprint-13.1-plan.md:44` lists it too.

**Suggestion:** Strike the line with superseded-by note, OR amend design doc.

## Status rationale

All r1 findings VERIFIED fixed. 2 new WARNs (cheap to fix). 0 new BLOCKs. → **APPROVED_WITH_WARNINGS**. Cleared for QC.
