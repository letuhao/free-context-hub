/**
 * Single upsert for draft lesson proposals from commits (idempotent per commit).
 */

export type GitLessonProposalDraftInput = {
  projectId: string;
  sourceCommitSha: string;
  lessonType: string;
  title: string;
  content: string;
  tags: string[];
  sourceRefs: string[];
  rationale: string;
};

export type QueryablePool = {
  query: (sql: string, args: unknown[]) => Promise<{ rows?: Array<{ proposal_id?: unknown }> }>;
};

export async function upsertGitLessonProposalDraft(pool: QueryablePool, input: GitLessonProposalDraftInput): Promise<string> {
  const ins = await pool.query(
    `INSERT INTO git_lesson_proposals(
        project_id, source_commit_sha, lesson_type, title, content, tags, source_refs, rationale, status, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft', now(), now())
      ON CONFLICT (project_id, source_commit_sha)
      WHERE status='draft' AND source_commit_sha IS NOT NULL
      DO UPDATE SET
        lesson_type=EXCLUDED.lesson_type,
        title=EXCLUDED.title,
        content=EXCLUDED.content,
        tags=EXCLUDED.tags,
        source_refs=EXCLUDED.source_refs,
        rationale=EXCLUDED.rationale,
        updated_at=now()
      RETURNING proposal_id`,
    [
      input.projectId,
      input.sourceCommitSha,
      input.lessonType,
      input.title,
      input.content,
      input.tags,
      input.sourceRefs,
      input.rationale,
    ],
  );
  return String(ins.rows?.[0]?.proposal_id ?? '');
}
