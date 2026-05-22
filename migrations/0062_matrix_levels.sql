-- Phase 15 Sprint 15.10 — multi-tier collective routing (DEFERRED-022).
-- Each collective matrix row may now assign DIFFERENT bodies per level.

CREATE TABLE doa_matrix_levels (
  matrix_id UUID NOT NULL REFERENCES doa_matrix(matrix_id) ON DELETE CASCADE,
  level     TEXT NOT NULL CHECK (level IN ('execution','coordination','authority')),
  body_id   UUID NOT NULL REFERENCES decision_bodies(body_id),
  PRIMARY KEY (matrix_id, level)
);

CREATE INDEX doa_matrix_levels_body_idx ON doa_matrix_levels (body_id);

COMMENT ON TABLE doa_matrix_levels IS
  'Sprint 15.10 (DEFERRED-022) — per-level body assignment for multi-tier collective routes. A collective matrix row may have 0..N entries here. 0 entries means fall back to doa_matrix.body_id for the required_level (15.8 single-step compat).';
COMMENT ON COLUMN doa_matrix_levels.level IS
  'The route level (execution/coordination/authority) at which body_id is authoritative.';

-- Persist the per-level body map onto the request at submission so lapsed-
-- escalation honors snapshot-the-rules (master design B.7). NULL on pre-15.10
-- or non-collective requests.
ALTER TABLE requests
  ADD COLUMN body_by_level JSONB NULL;

COMMENT ON COLUMN requests.body_by_level IS
  'Sprint 15.10 — snapshotted body_by_level map from doa_matrix_levels at request submission. Used by applyMotionToStep lapsed-escalation to re-propose under the next level''s body without re-resolving the (possibly-edited) matrix.';
