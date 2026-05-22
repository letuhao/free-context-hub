# DEFERRED-008 — exchange scope-leak fix — CLARIFY

**Date:** 2026-05-21
**Workflow:** v2.2 human-in-loop
**Branch:** `fix-exchange-scope-deferred-008` (from `phase-15-sprint-15.12`)
**Status:** DRAFT — pending human approval

## Scope

Fix **DEFERRED-008** — the Phase 11 knowledge-bundle export/import path drops the
`lesson_types.scope` column (added by migration 0052). Net effect: a source
`scope='profile'` lesson type silently becomes `scope='global'` on the destination
instance (via the column default), leaking a profile-scoped type into the destination's
GLOBAL registry for all projects there.

The fix carries `scope` through the exchange path.

## Root cause (confirmed by reading the code)

- `exportProject.ts:127` SELECTs `type_key, display_name, description, color, template,
  is_builtin, created_at` — **omits `scope`**.
- `importProject.ts:464` INSERT and `:451` UPDATE use the same explicit column list —
  **omit `scope`** — so an imported row lands at the migration-0052 default
  `scope='global'`.
- `lesson_types.scope`: `TEXT NOT NULL DEFAULT 'global' CHECK (scope IN ('global','profile'))`.

## Size

**S** (core fix): 2 production files + 1-2 test files, 0 migration, ~4 ACs.
Grows to **M** only if Q1 = include the `taxonomy_profiles` round-trip.

## Acceptance criteria

- **AC1** — `exportProject` lesson_types SELECT includes `scope`; the exported JSONL
  row carries `scope`.
- **AC2** — `importProject` INSERT (create path) persists `row.scope`, defaulting to
  `'global'` when absent (a pre-fix bundle has no `scope` field) — `COALESCE`/`?? 'global'`.
- **AC3** — `importProject` UPDATE (overwrite path) sets `scope = row.scope` (default
  'global' when absent). Built-in-overwrite refusal unchanged.
- **AC4** — Round-trip: a `scope='profile'` lesson type exported then imported into a
  fresh instance lands as `scope='profile'` (NOT silently 'global'). A `scope='global'`
  type round-trips as 'global'.
- **AC5** — Backward compat: importing a PRE-FIX bundle (lesson_types rows without a
  `scope` field) defaults each to `scope='global'` (the prior behavior — no regression).
- **AC6** — `bundleFormat` / `base64Stream` tests + the import e2e suite still pass;
  add a scope round-trip assertion.

## Open Question

**Q1 — Include the `taxonomy_profiles` round-trip (the M part)?**
The deferred notes a *related* gap: `taxonomy_profiles` is not a bundle entity at all,
so profile-scoped types "do not round-trip meaningfully" even with `scope` carried — a
destination needs the profile to exist for a `scope='profile'` type to be useful.
- (a) **Scope-only fix; defer taxonomy_profiles round-trip (recommended).** Closes the
  actual scope-LEAK bug (the data-integrity issue: profile types no longer pollute the
  global registry). `taxonomy_profiles` are independently re-seeded from
  `config/taxonomy-profiles/*.json` on a fresh instance, so a profile-scoped type imported
  with correct `scope='profile'` attaches to a re-seeded profile of the same key. Adding
  the profiles table as a bundle entity is a feature addition (new ENTRY_NAME, export
  iterable, import handler, manifest, conflict policy, tests) — its own S-M scope.
  Record as a new deferred item.
- (b) Include taxonomy_profiles as a new bundle entity now (sprint becomes M).

**Recommendation: (a)** — fix the leak (the bug), defer the profiles round-trip (a
feature). Honest split: 008's core is "scope is dropped"; the profiles round-trip is
the adjacent enhancement the deferred explicitly calls "related" / pre-existing.

## Plan preview
T1. `exportProject.ts` — add `scope` to the lesson_types SELECT.
T2. `importProject.ts` — add `scope` to INSERT (create) + UPDATE (overwrite), default
   'global' when the bundle row omits it.
T3. Tests — `bundleFormat.test.ts` or the import e2e: a `scope='profile'` type
   round-trips as 'profile'; a pre-fix bundle (no scope) defaults to 'global'.
T4. VERIFY: `npm test` + `tsc` + (optional) live export/import smoke.
T5. SESSION + COMMIT + RETRO; mark DEFERRED-008 RESOLVED; new deferred for the
   taxonomy_profiles round-trip (if Q1=a).

## Risks
1. **Pre-fix bundle compat (AC5)** — old bundles have no `scope` field; the import must
   default to 'global' (not crash on undefined). Use `row.scope ?? 'global'` /
   `COALESCE($N::text, 'global')`.
2. **CHECK constraint** — an imported `scope` value outside {global,profile} would
   violate the CHECK. A malformed bundle → the INSERT throws. Acceptable (bundle
   integrity is the producer's responsibility); the import already runs per-batch in a
   transaction. Optionally validate `scope ∈ {global,profile}` defensively → fall back
   to 'global'. Decide in DESIGN.

## Sign-off
- [ ] Q1 — scope-only vs include taxonomy_profiles (recommend (a) scope-only)
- [ ] Spec approved → DESIGN (or straight to BUILD if S)
