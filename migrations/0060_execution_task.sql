-- Phase 15 Sprint 15.7 — DEFERRED-019 submitter-specified execution_task blob.
--
-- Optional JSONB column on both `requests` and `motions`. NULL means "use derived
-- defaults at chain time". Shape (validated at the service layer, not DB):
--   {title?: string, topology?: 'parallel'|'sequential'|'rolling', slot?: string,
--    kind?: string, depends_on?: uuid[], raci?: object}
--
-- The chaining handler (src/services/chaining.ts) reads this column on positive
-- outcomes (request.resolved 'approved' / motion.tallied 'carried') and posts a
-- chained board task with the merged params. NULL → derived defaults from source.

ALTER TABLE requests ADD COLUMN execution_task JSONB;
ALTER TABLE motions  ADD COLUMN execution_task JSONB;

COMMENT ON COLUMN requests.execution_task IS
  'Sprint 15.7 — optional task params the chaining handler uses on positive resolution (request.resolved outcome=approved). Shape: {title?, topology?, slot?, kind?, depends_on?, raci?}. NULL = derived defaults.';
COMMENT ON COLUMN motions.execution_task IS
  'Sprint 15.7 — optional task params the chaining handler uses on motion.carried. Same shape as requests.execution_task.';
