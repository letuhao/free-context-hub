-- Phase 13 Sprint 13.5 — F3: Domain Taxonomy Extension
-- Two new tables: taxonomy_profiles + project_taxonomy_profiles.
-- Idempotent via IF NOT EXISTS (no CHECK constraint changes needed).

CREATE TABLE IF NOT EXISTS taxonomy_profiles (
  profile_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT        NOT NULL,
  name              TEXT        NOT NULL,
  description       TEXT,
  version           TEXT        NOT NULL DEFAULT '1.0',
  lesson_types      JSONB       NOT NULL,
  is_builtin        BOOLEAN     NOT NULL DEFAULT false,
  -- Built-in profiles: owner_project_id IS NULL, slug globally unique.
  -- Custom profiles: owner_project_id = the owning project, slug unique per owner.
  owner_project_id  TEXT        DEFAULT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- NULLS NOT DISTINCT (Postgres 15+) lets owner_project_id IS NULL participate
  -- in uniqueness checks the same as a non-null value. Built-in slugs are
  -- globally unique because all built-ins share owner_project_id = NULL.
  CONSTRAINT taxonomy_profiles_slug_owner_uniq
    UNIQUE NULLS NOT DISTINCT (slug, owner_project_id)
);

CREATE INDEX IF NOT EXISTS taxonomy_profiles_owner_idx
  ON taxonomy_profiles (owner_project_id, is_builtin);

-- Per-project active profile (at most one per project).
CREATE TABLE IF NOT EXISTS project_taxonomy_profiles (
  project_id    TEXT        NOT NULL,
  profile_id    UUID        NOT NULL REFERENCES taxonomy_profiles(profile_id) ON DELETE CASCADE,
  activated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_by  TEXT,
  PRIMARY KEY   (project_id)
);
