---
sub-sprint: SS2
task: Phase 13 bug-fix — lesson-type system unification
bugs: BUG-13.5-1 (HIGH), BUG-13.5-2 (LOW), BUG-13.5-3 (COSMETIC)
branch: phase-13-bugfix
date: 2026-05-15
architecture: Option 1 (Registry + Profiles, composed) — user-approved
size: XL (1 migration + ~6 service fns + bootstrap + GUI + tests)
---

# SS2 DESIGN — Lesson-type system unification

## Problem (BUG-13.5-1)

Two parallel custom-lesson-type systems coexist:

- **`lesson_types`** (Phase 8, migration 0040) — a flat **global** registry: one row per
  type with `display_name`, `description`, `color` (named), `template`, `is_builtin`. Seeded
  with the 5 builtins. Backs `/api/lesson-types` (admin) + the GUI `useLessonTypes` hook +
  the Phase 11 export bundle.
- **`taxonomy_profiles`** (Phase 13, migration 0050) — project-scoped **bundles** of types;
  a project activates one. `lesson_types` JSONB holds inline `{type,label,description,color}`.

`getValidLessonTypes` — the gate at `addLesson` — resolves to `BUILTIN_LESSON_TYPES` (5
hardcoded) + the active taxonomy profile. It **never reads the `lesson_types` table**, so any
Phase 8 custom type is rejected by `add_lesson` / `POST /api/lessons` with HTTP 400.

## End state — Option 1 (Registry + Profiles, composed)

One system, two tables with distinct, non-overlapping roles:

- **`lesson_types` = the single type-definition registry.** Every lesson_type that exists has
  exactly one row, holding its metadata. A new `scope` column distinguishes:
  - `scope='global'` — always valid (the 5 builtins + Phase 8 custom types).
  - `scope='profile'` — valid for a project only while an active profile references it.
- **`taxonomy_profiles` = project-scoped policy.** A profile is a named bundle that
  *references* registry `type_key`s (not inline definitions).
- **Validity:** `getValidLessonTypes(project)` = `{type_key : scope='global'}` ∪
  `{type_key : referenced by the project's active profile}`.

## Migration — `0052_unify_lesson_types.sql` (idempotent, data-preserving)

1. `ALTER TABLE lesson_types ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'global'
   CHECK (scope IN ('global','profile'))` — every existing row (5 builtins + any Phase 8
   customs) becomes `global` via the DEFAULT.
2. For each `taxonomy_profiles` row whose `lesson_types` JSONB is still an array-of-objects
   (idempotency guard: `jsonb_typeof(lesson_types->0) = 'object'`):
   a. Upsert each `{type,label,description,color}` into `lesson_types` as
      `(type_key=type, display_name=label, description, color=<named>, scope='profile',
      is_builtin=<the profile's is_builtin>)`. `ON CONFLICT (type_key) DO NOTHING` — never
      clobber an existing global type.
   b. Rewrite the profile's `lesson_types` to a JSONB **string-array of `type_key`s**.
3. Re-runnable: `ADD COLUMN IF NOT EXISTS`; step 2 skips profiles already converted
   (their first element is a `string`, not an `object`).

No DELETE. `lessons.lesson_type` strings are never touched → F3-AC7 (deactivation preserves
existing lesson types) is preserved by construction.

## Code changes

| File | Change |
|------|--------|
| `migrations/0052_unify_lesson_types.sql` | NEW — the migration above |
| `src/services/taxonomyService.ts` | `getValidLessonTypes` / `getActiveProfile` / `getLessonTypeLabel` resolve via a registry join. `createTaxonomyProfile` / `upsertBuiltinProfile` upsert types into the registry (`scope='profile'`) + store `type_key` refs. **API/MCP responses stay hydrated** — join the registry to return `lesson_types:[{type,label,description,color}]`, so the REST + MCP output contracts are unchanged. |
| `src/services/taxonomyBootstrap.ts` | seeding a built-in profile registers its types in `lesson_types` |
| `src/services/lessonTypes.ts` | relax `type_key` regex → allow hyphens (DLF types use them). `createLessonType` writes `scope='global'`. `listLessonTypes` returns only `scope='global'` rows — the admin page + the GUI add-lesson dropdown keep showing exactly builtins + custom global types (no behaviour change vs pre-SS2; **the `?project_id=` filter below was not needed** and is not shipped). `deleteLessonType` blocks `scope='profile'` types. |
| `src/kg/linker.ts` | **BUG-13.5-2**: `if (t==='guardrail'||t==='codex-guardrail')` → `if (GUARDRAIL_LESSON_TYPES.includes(t))` |
| `config/taxonomy-profiles/dlf-phase0.json` | **BUG-13.5-3**: hex colors → named colors (`#6366f1`→`blue`, `#f59e0b`→`amber`, `#ef4444`→`red`, `#10b981`→`emerald`, `#8b5cf6`→`purple`) |
| `gui/.../settings/taxonomy-panel.tsx` | render type-chip colors via `getTypeBadgeStyle` (named) — closes the unvalidated-hex-in-inline-style nit |

> **Build note (SS2):** the planned `GET /api/lesson-types?project_id=` filter + GUI add-lesson
> changes proved unnecessary. Having `listLessonTypes` return only `scope='global'` rows keeps
> the add-lesson dropdown showing exactly what it showed pre-SS2 (builtins + custom global
> types), with zero GUI churn and no new invalid-type-in-dropdown regression. `routes/lessonTypes.ts`
> is unchanged.

External contracts (`createTaxonomyProfile` input, MCP `taxonomyProfileShape` output,
`getActiveProfile` shape) stay the same — storage normalizes, responses stay hydrated.

## Verify

- migration applies, and re-applies idempotently (run twice → no change second time);
- `getValidLessonTypes(project)` includes the 5 builtins + Phase 8 customs + active-profile types;
- `add_lesson` with a Phase 8 custom type → accepted (BUG-13.5-1 closed);
- `add_lesson` with a DLF type when dlf-phase0 inactive → still rejected (F3-AC1/AC7 hold);
- `taxonomyService.test.ts` updated + green; full unit suite green; `phase13-taxonomy` e2e green.
