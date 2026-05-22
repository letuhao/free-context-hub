-- Phase 15 Sprint 15.8 — wire procedure='collective' into Request-Approval
-- (DEFERRED-018).
--
-- DoA matrix per-row procedure + body_id:
--   procedure='unilateral' (default) → step decided by decideStep (15.3 path).
--   procedure='collective'           → step decided by a motion under body_id (15.4+15.8).
-- body_id MUST be non-null when procedure='collective' (CHECK).
ALTER TABLE doa_matrix
  ADD COLUMN procedure TEXT NOT NULL DEFAULT 'unilateral'
    CHECK (procedure IN ('unilateral','collective')),
  ADD COLUMN body_id   UUID NULL REFERENCES decision_bodies(body_id);

ALTER TABLE doa_matrix
  ADD CONSTRAINT doa_matrix_collective_body_ck
    CHECK (procedure = 'unilateral' OR body_id IS NOT NULL);

-- request_steps: snapshot body_id at submission (mirrors target_office + doa_snapshot
-- discipline); motion_id linked when a collective step's motion is proposed.
-- procedure column already exists (default 'unilateral').
ALTER TABLE request_steps
  ADD COLUMN body_id   UUID NULL REFERENCES decision_bodies(body_id),
  ADD COLUMN motion_id UUID NULL REFERENCES motions(motion_id);

-- Extend status enum to include 'motion_proposed'.
ALTER TABLE request_steps
  DROP CONSTRAINT request_steps_status_check;
ALTER TABLE request_steps
  ADD CONSTRAINT request_steps_status_check
    CHECK (status IN (
      'pending', 'motion_proposed', 'endorsed',
      'returned', 'rejected', 'escalated'
    ));

-- O(1) lookup from a tallying motion back to its linked step. Sparse partial index.
CREATE INDEX request_steps_motion_lookup_idx
  ON request_steps (motion_id)
  WHERE motion_id IS NOT NULL;

COMMENT ON COLUMN doa_matrix.procedure IS
  'Sprint 15.8 (DEFERRED-018) — per-matrix-row decision procedure. unilateral = decideStep; collective = body-based motion tally.';
COMMENT ON COLUMN doa_matrix.body_id IS
  'Sprint 15.8 — decision body authoritative when procedure=collective. NOT NULL enforced by CHECK.';
COMMENT ON COLUMN request_steps.body_id IS
  'Sprint 15.8 — snapshotted from doa_matrix.body_id at submission. Frozen for the request lifetime.';
COMMENT ON COLUMN request_steps.motion_id IS
  'Sprint 15.8 — link to the in-flight motion (set at step activation, NULL once the step terminates by motion tally or escalation).';
