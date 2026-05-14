-- Phase 13 Sprint 13.2 — add 'leases.sweep' to async_jobs.job_type CHECK constraint
-- Pattern: same as migration 0045 (document.extract.vision)
--
-- Defensive ASSERT (post-Adversary code-review r1 F2 BLOCK — idempotent revision):
-- The DO block below verifies the existing constraint contains EXACTLY one of:
--   (a) the 13 pre-migration types  → first-time apply, proceed
--   (b) the 13 pre-migration types + 'leases.sweep'  → already applied, no-op
-- Any OTHER shape aborts loud (catches drift from unknown intermediate migrations).

DO $$
DECLARE
  current_def TEXT;
  pre_migration_types TEXT[] := ARRAY[
    'repo.sync', 'workspace.scan', 'workspace.delta_index', 'index.run',
    'git.ingest', 'quality.eval', 'knowledge.refresh', 'faq.build',
    'raptor.build', 'knowledge.loop.shallow', 'knowledge.loop.deep',
    'knowledge.memory.build', 'document.extract.vision'
  ];
  post_migration_types TEXT[] := pre_migration_types || ARRAY['leases.sweep'];
  parsed_types TEXT[];
  missing_type TEXT;
  extra_types TEXT[];
  matches_pre BOOLEAN;
  matches_post BOOLEAN;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO current_def
  FROM pg_constraint
  WHERE conname = 'async_jobs_job_type_check' AND conrelid = 'async_jobs'::regclass;

  IF current_def IS NULL THEN
    RAISE EXCEPTION 'async_jobs_job_type_check constraint not found — schema state unexpected';
  END IF;

  -- Parse the constraint definition. pg_get_constraintdef returns text like
  --   CHECK (job_type = ANY (ARRAY['x'::text, 'y'::text, ...]))
  -- r2 F2 fix: anchor regex on the ARRAY[...] segment so we don't capture
  -- quoted tokens from any future Postgres canonicalization (COLLATE clauses,
  -- comments, alternate parens nesting) that might appear OUTSIDE the array.
  DECLARE
    array_segment TEXT;
  BEGIN
    SELECT (regexp_matches(current_def, 'ARRAY\[([^\]]+)\]', 'i'))[1] INTO array_segment;
    IF array_segment IS NULL THEN
      RAISE EXCEPTION 'async_jobs_job_type_check could not parse ARRAY segment from: %', current_def;
    END IF;
    SELECT array_agg(m[1]) INTO parsed_types
    FROM regexp_matches(array_segment, '''([^'']+)''', 'g') AS m;
  END;

  IF parsed_types IS NULL OR array_length(parsed_types, 1) IS NULL THEN
    RAISE EXCEPTION 'async_jobs_job_type_check ARRAY segment contains no parseable types: %', current_def;
  END IF;

  -- Compute set-equality with pre and post (order-insensitive)
  matches_pre := (
    SELECT NOT EXISTS (SELECT 1 FROM unnest(pre_migration_types) AS t WHERE NOT (t = ANY (parsed_types)))
       AND array_length(parsed_types, 1) = array_length(pre_migration_types, 1)
  );
  matches_post := (
    SELECT NOT EXISTS (SELECT 1 FROM unnest(post_migration_types) AS t WHERE NOT (t = ANY (parsed_types)))
       AND array_length(parsed_types, 1) = array_length(post_migration_types, 1)
  );

  IF matches_post THEN
    -- Idempotent replay: migration already applied. Skip DROP/ADD.
    RAISE NOTICE 'migration 0051: constraint already contains leases.sweep — idempotent no-op';
    RETURN;
  ELSIF matches_pre THEN
    -- First-time apply: proceed to DROP/ADD below.
    NULL;
  ELSE
    -- Constraint shape is unexpected — drift detected. Compute the diff to help operator.
    SELECT array_agg(t) INTO extra_types
    FROM unnest(parsed_types) AS t
    WHERE t <> ALL (post_migration_types);

    IF extra_types IS NOT NULL AND array_length(extra_types, 1) > 0 THEN
      RAISE EXCEPTION 'async_jobs_job_type_check has UNKNOWN type(s) the design did not include: %. Migration 0051 would silently drop them. Decide policy (preserve / migrate / drop) and update this migration explicitly.', extra_types;
    END IF;

    FOREACH missing_type IN ARRAY pre_migration_types LOOP
      IF NOT (missing_type = ANY (parsed_types)) THEN
        RAISE EXCEPTION 'async_jobs_job_type_check missing expected pre-migration type %; constraint shape has drifted. Inspect with: \d+ async_jobs', missing_type;
      END IF;
    END LOOP;

    RAISE EXCEPTION 'async_jobs_job_type_check shape neither matches pre-migration (13 types) nor post-migration (14 types). Manual inspection required.';
  END IF;

  -- First-time apply path: replace the constraint
  EXECUTE 'ALTER TABLE async_jobs DROP CONSTRAINT async_jobs_job_type_check';
  EXECUTE $constraint$
    ALTER TABLE async_jobs ADD CONSTRAINT async_jobs_job_type_check
      CHECK (job_type IN (
        'repo.sync', 'workspace.scan', 'workspace.delta_index', 'index.run',
        'git.ingest', 'quality.eval', 'knowledge.refresh', 'faq.build',
        'raptor.build', 'knowledge.loop.shallow', 'knowledge.loop.deep',
        'knowledge.memory.build', 'document.extract.vision', 'leases.sweep'
      ))
  $constraint$;
END $$;

-- Note: the DROP/ADD CONSTRAINT statements are EMBEDDED in the DO block above
-- (via EXECUTE) so that we can branch on the idempotent-replay case. This
-- replaces the earlier non-idempotent design where DROP/ADD sat at top-level
-- after the DO assertion.

-- Rollback note: to remove 'leases.sweep', first delete all rows with
-- job_type = 'leases.sweep' from async_jobs, then drop and re-add the constraint
-- without that value. If the defensive assertion above fires in production,
-- the running constraint is the source of truth — manually inspect with
-- `\d+ async_jobs` to compare actual types vs the expected sets in this file.
