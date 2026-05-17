# Sprint 15.3.1 — QC — Scope Guard (AC coverage + fingerprint)

**Phase:** QC (8/12). **Reviewer:** main session, Scope-Guard mechanical check.
**Verdict:** CLEAR — fingerprint match, no drift; AC1–AC8 covered; AC9 is the POST-REVIEW gate.

## Spec fingerprint

DESIGN `docs/specs/2026-05-18-phase-15-sprint-15.3.1-design.md` — recomputed SHA-256[0:16]
= `e8b03d5b5f5b71d2`. Matches the rev-3 hash recorded at REVIEW-DESIGN completion
(AUDIT_LOG `2026-05-18T06:52Z` event). **No unexplained drift** — the design has not been
touched since rev 3; BUILD implemented against it.

## AC coverage matrix (CLARIFY §6, with AC1b from DESIGN rev 3 §8)

| AC | Requirement | Covered by | Status |
|----|-------------|-----------|--------|
| AC1 | F1: `MCP_AUTH_ENABLED=true` + DB key — body identity ≠ `apiKeyName` → 403; == / omitted → ok | route tests: submit ≠→403, submit ==→201, submit omitted→201, decide ≠→403, decide ==→200 | ✅ |
| AC1b | reader-role key POST still 403 (the writer gate F1 depends on) | route test: `F1 precondition (AC1b)` | ✅ |
| AC2 | F1 auth-off: body value stands; existing 6 route tests green | the 6 original route tests pass within routes/requests.test.ts 15/15 | ✅ |
| AC3 | F3a: artifact whose `topic_id` ≠ request topic → `NOT_FOUND` | service test `F3a: …another topic`; live smoke `F3a: cross-topic artifact → 404` | ✅ |
| AC4 | F3a: `resolveArtifact` emits artifact events on the artifact's own topic | service test `F3a: …events on the artifact topic` (regression guard — LOW-4: cannot isolate 2b, inherent) | ✅ |
| AC5 | F4: GET routes require ≥ `reader` | route tests: 2× unknown-role→403, reader→not-403 | ✅ |
| AC6 | F5: `decideStep` rejects non-integer / negative `step_index` → `BAD_REQUEST` | service tests `F5: negative`, `F5: fractional`; live smoke `F5: step_index -1 → 400` | ✅ |
| AC7 | F7: `submitRequest` rejects `kind` / `subject_id` > 256 → `BAD_REQUEST` | service tests `F7: over-long kind`, `F7: over-long subject_id`; live smoke `F7: 257-char kind → 400` | ✅ |
| AC8 | regression: tsc clean; full `npm test` green; live smoke of the 15.3 paths | tsc exit 0; `npm test` 429/429 (428 + LOW-2's +1); live smoke 5/5 incl. the core submit→decide→approved 15.3 path on the rebuilt stack | ✅ |
| AC9 | cold-start security re-review confirms F1 (DB-key path) + F3a closed; auth-off / F2 residuals acknowledged | **POST-REVIEW phase (9/12) — pending** | ⏳ POST-REVIEW |

## Notes

- **AC8 — "the 14 prior 15.3 paths":** the live smoke ran a representative core path
  (submit → endorse → approved + artifact `final`) on the rebuilt stack; the full 15.3
  behavioural surface (the original "14/14") is covered by the 15.3 service + route tests,
  all green within the 429-test suite. Proportionate — not a per-path live re-run.
- **F1 / F4 live exercise:** verified by the 8 (now 9) route tests under the test-shim that
  reproduces `bearerAuth`'s `apiKeyName`/`apiKeyRole` contract; deployment proven by the
  5/5 smoke. An `MCP_AUTH_ENABLED=true` end-to-end docker smoke was deemed disproportionate
  — flagged for the POST-REVIEW security Adversary to judge.
- REVIEW-CODE LOW-3/4/5 accepted + documented (`findings-sprint-15.3.1-code-r1.md`); none
  blocks QC.

**QC verdict: CLEAR.** Proceed to POST-REVIEW (the AC9 gate).
