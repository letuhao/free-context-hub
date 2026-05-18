-- Sprint 15.5: seed __default__ DoA matrix rows for kind='dispute_resolution'.
-- Design ref: docs/specs/2026-05-18-phase-15-sprint-15.5-design.md D4.
-- Idempotent — skipped if rows already exist.

INSERT INTO doa_matrix (project_id, topic_id, kind, weight_min, weight_max, required_level, route_shape)
SELECT '__default__', NULL, 'dispute_resolution', 0, 2147483647, 'authority', 'escalate_to_authority'
 WHERE NOT EXISTS (SELECT 1 FROM doa_matrix WHERE project_id='__default__' AND kind='dispute_resolution');
