-- Actor Data Boundary F2g — the system-worker principal marker.
--
-- Wrapped in a single transaction by the migration runner
-- (src/db/applyMigrations.ts — BEGIN/COMMIT per file, ROLLBACK on error).
--
-- The background worker (and other internal, non-request callers) authenticate as a single dedicated
-- NON-root principal: kind=system, is_system=true. It is least-privilege — it gets exactly ONE
-- `global write` grant (seeded by bootstrap:system), never root's blanket short-circuit. This marker
-- lets getSystemPrincipal() find that one identity, mirroring is_root / getRootPrincipal().
--
-- INERT until the worker resolves and threads it (F2g wiring) AND auth is flipped on (separately
-- gated). Creating the column/marker changes no runtime behavior on its own.

ALTER TABLE principals
  ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN principals.is_system IS
  'The one non-root machine identity internal callers (background worker / internal job execution) authenticate as. NOT root: least-privilege via a single global-write grant. Set only by bootstrap:system; never grantable. Partial unique index enforces at most one; the CHECK keeps it disjoint from is_root.';

-- At most one system-worker principal across the deployment (mirrors principals_single_root_uniq).
CREATE UNIQUE INDEX IF NOT EXISTS principals_single_system_uniq
  ON principals (is_system) WHERE is_system = true;

-- [F2g REVIEW-DESIGN adv #2] Mutual exclusion must live in the DDL, not just the seed paths: a row
-- can never be BOTH root and system-worker. If it could, getSystemPrincipal() might return the root
-- row → the worker would silently run with root's short-circuit ALLOW (the exact over-privilege the
-- dedicated-principal design avoids). ADD CONSTRAINT is not IF-NOT-EXISTS-able before PG16, so guard
-- the re-run with a duplicate_object catch.
DO $$
BEGIN
  ALTER TABLE principals
    ADD CONSTRAINT principals_root_xor_system_chk CHECK (NOT (is_root AND is_system));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
