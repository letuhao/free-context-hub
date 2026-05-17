-- 0055_task_abandoned_status.sql — Phase 15 Sprint 15.2.1 post-review fix-up
-- Adds the `abandoned` task status: the closed-topic sweep branch marks a task
-- whose claim it drops as 'abandoned' (it cannot return to the board — a closed
-- topic's tasks can no longer be re-claimed). See coordinationSweep.ts §4.1.
--
-- Idempotent: DROP ... IF EXISTS then re-ADD — re-running is a no-op-equivalent
-- (the runner skips an already-applied migration anyway; this guards a manual re-run).

ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check
  CHECK (status IN ('posted','claimed','in_progress','completed','disputed','abandoned'));
