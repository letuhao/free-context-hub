import { getDbPool } from '../db/client.js';

// ── Comments ──

export interface LessonComment {
  comment_id: string;
  lesson_id: string;
  parent_id: string | null;
  author: string;
  content: string;
  created_at: string;
  replies?: LessonComment[];
}

export async function addComment(params: {
  lessonId: string;
  parentId?: string;
  author: string;
  content: string;
}): Promise<LessonComment> {
  const pool = getDbPool();
  const result = await pool.query(
    `INSERT INTO lesson_comments (lesson_id, parent_id, author, content)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [params.lessonId, params.parentId ?? null, params.author, params.content],
  );
  return result.rows[0];
}

export async function listComments(params: {
  lessonId: string;
}): Promise<{ comments: LessonComment[]; total_count: number }> {
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT * FROM lesson_comments WHERE lesson_id = $1 ORDER BY created_at ASC`,
    [params.lessonId],
  );
  // Build thread tree: top-level + nested replies
  const all = result.rows as LessonComment[];
  const byId = new Map(all.map(c => [c.comment_id, { ...c, replies: [] as LessonComment[] }]));
  const roots: LessonComment[] = [];
  for (const c of byId.values()) {
    if (c.parent_id && byId.has(c.parent_id)) {
      byId.get(c.parent_id)!.replies!.push(c);
    } else {
      roots.push(c);
    }
  }
  return { comments: roots, total_count: all.length };
}

export async function deleteComment(params: {
  commentId: string;
}): Promise<boolean> {
  const pool = getDbPool();
  const result = await pool.query(
    `DELETE FROM lesson_comments WHERE comment_id = $1`, [params.commentId],
  );
  return (result.rowCount ?? 0) > 0;
}

// ── Feedback ──

export interface FeedbackSummary {
  lesson_id: string;
  upvotes: number;
  downvotes: number;
  user_vote: number | null;
}

export async function voteFeedback(params: {
  lessonId: string;
  userId: string;
  vote: 1 | -1;
}): Promise<{ status: 'ok'; vote: number }> {
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO lesson_feedback (lesson_id, user_id, vote)
     VALUES ($1, $2, $3)
     ON CONFLICT (lesson_id, user_id) DO UPDATE SET vote = $3, created_at = now()`,
    [params.lessonId, params.userId, params.vote],
  );
  return { status: 'ok', vote: params.vote };
}

export async function getFeedback(params: {
  lessonId: string;
  userId?: string;
}): Promise<FeedbackSummary> {
  const pool = getDbPool();
  const agg = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN vote = 1 THEN 1 ELSE 0 END), 0)::int AS upvotes,
       COALESCE(SUM(CASE WHEN vote = -1 THEN 1 ELSE 0 END), 0)::int AS downvotes
     FROM lesson_feedback WHERE lesson_id = $1`,
    [params.lessonId],
  );
  let user_vote: number | null = null;
  if (params.userId) {
    const uv = await pool.query(
      `SELECT vote FROM lesson_feedback WHERE lesson_id = $1 AND user_id = $2`,
      [params.lessonId, params.userId],
    );
    user_vote = uv.rows[0]?.vote ?? null;
  }
  return {
    lesson_id: params.lessonId,
    upvotes: agg.rows[0].upvotes,
    downvotes: agg.rows[0].downvotes,
    user_vote,
  };
}

export async function removeFeedback(params: {
  lessonId: string;
  userId: string;
}): Promise<boolean> {
  const pool = getDbPool();
  const result = await pool.query(
    `DELETE FROM lesson_feedback WHERE lesson_id = $1 AND user_id = $2`,
    [params.lessonId, params.userId],
  );
  return (result.rowCount ?? 0) > 0;
}

// ── Bookmarks ──

export async function addBookmark(params: {
  userId: string;
  lessonId: string;
}): Promise<{ status: 'ok' }> {
  const pool = getDbPool();
  await pool.query(
    `INSERT INTO bookmarks (user_id, lesson_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
    [params.userId, params.lessonId],
  );
  return { status: 'ok' };
}

export async function removeBookmark(params: {
  userId: string;
  lessonId: string;
}): Promise<boolean> {
  const pool = getDbPool();
  const result = await pool.query(
    `DELETE FROM bookmarks WHERE user_id = $1 AND lesson_id = $2`,
    [params.userId, params.lessonId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function listBookmarks(params: {
  userId: string;
  projectId: string;
}): Promise<{ bookmarks: any[]; total_count: number }> {
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT b.lesson_id, b.created_at AS bookmarked_at, l.title, l.lesson_type, l.status, l.tags
     FROM bookmarks b
     JOIN lessons l ON l.lesson_id = b.lesson_id
     WHERE b.user_id = $1 AND l.project_id = $2
     ORDER BY b.created_at DESC`,
    [params.userId, params.projectId],
  );
  return { bookmarks: result.rows, total_count: result.rowCount ?? 0 };
}

export async function isBookmarked(params: {
  userId: string;
  lessonId: string;
}): Promise<boolean> {
  const pool = getDbPool();
  const result = await pool.query(
    `SELECT 1 FROM bookmarks WHERE user_id = $1 AND lesson_id = $2`,
    [params.userId, params.lessonId],
  );
  return (result.rowCount ?? 0) > 0;
}
