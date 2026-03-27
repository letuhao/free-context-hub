-- Expand async_jobs.job_type allowed values for Phase 6 enhancers.

ALTER TABLE async_jobs
  DROP CONSTRAINT IF EXISTS async_jobs_job_type_check;

ALTER TABLE async_jobs
  ADD CONSTRAINT async_jobs_job_type_check CHECK (
    job_type IN (
      'repo.sync',
      'workspace.scan',
      'workspace.delta_index',
      'index.run',
      'git.ingest',
      'quality.eval',
      'knowledge.refresh',
      'faq.build',
      'raptor.build'
    )
  );

