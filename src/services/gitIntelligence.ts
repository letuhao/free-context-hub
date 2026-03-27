import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { getEnv } from '../env.js';
import { getDbPool } from '../db/client.js';
import { getNeo4jDriver } from '../kg/client.js';
import { linkLessonToSymbols } from '../kg/linker.js';
import type { LessonType } from './lessons.js';
import { suggestLessonFromCommit } from './distiller.js';
import { loadIgnorePatternsFromRoot } from '../utils/ignore.js';
import { parseCommitFilesFromOutputs } from './gitCommitFileParse.js';
import { upsertGitLessonProposalDraft } from './gitLessonProposalUpsert.js';

const execFileAsync = promisify(execFile);

type ParsedCommit = {
  sha: string;
  parentShas: string[];
  authorName: string;
  authorEmail: string;
  committedAt: string;
  message: string;
};

export type IngestGitHistoryResult = {
  status: 'ok' | 'error' | 'skipped';
  run_id?: string;
  commits_seen: number;
  commits_upserted: number;
  files_upserted: number;
  warning?: string;
  error?: string;
};

export type ListCommitsResult = {
  items: Array<{
    sha: string;
    parent_shas: string[];
    author_name: string;
    author_email: string;
    committed_at: any;
    message: string;
    summary: string | null;
    ingested_at: any;
  }>;
  warning?: string;
};

export type GetCommitResult = {
  commit: ListCommitsResult['items'][number] | null;
  files: Array<{
    file_path: string;
    change_kind: string;
    additions: number | null;
    deletions: number | null;
  }>;
  warning?: string;
};

export type SuggestedLessonProposal = {
  proposal_id: string;
  commit_sha: string;
  lesson_type: LessonType;
  title: string;
  content: string;
  tags: string[];
  source_refs: string[];
  rationale: string;
  status: 'draft';
};

function summarizeMessage(message: string): string {
  const first = String(message ?? '').split('\n')[0]?.trim() ?? '';
  return first.length > 180 ? `${first.slice(0, 179)}…` : first;
}

function parseGitLog(raw: string): ParsedCommit[] {
  const out: ParsedCommit[] = [];
  const records = raw.split('\x1e').map(s => s.trim()).filter(Boolean);
  for (const rec of records) {
    const [sha, parents, authorName, authorEmail, committedAt, message] = rec.split('\x1f');
    if (!sha) continue;
    out.push({
      sha: sha.trim(),
      parentShas: String(parents ?? '')
        .trim()
        .split(/\s+/g)
        .filter(Boolean),
      authorName: String(authorName ?? '').trim(),
      authorEmail: String(authorEmail ?? '').trim(),
      committedAt: String(committedAt ?? '').trim(),
      message: String(message ?? '').trim(),
    });
  }
  return out;
}

async function runGit(root: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', root, ...args], { maxBuffer: 12 * 1024 * 1024 });
  return stdout ?? '';
}

async function parseCommitFiles(
  root: string,
  sha: string,
  ignorePatterns: string[],
): Promise<Array<{ file_path: string; change_kind: string; additions: number | null; deletions: number | null }>> {
  const nameStatus = await runGit(root, ['show', '--name-status', '--format=', sha]);
  const numstat = await runGit(root, ['show', '--numstat', '--format=', sha]);
  return parseCommitFilesFromOutputs(root, nameStatus, numstat, ignorePatterns);
}

export async function ingestGitHistory(params: {
  projectId: string;
  root: string;
  since?: string;
  maxCommits?: number;
}): Promise<IngestGitHistoryResult> {
  const env = getEnv();
  if (!env.GIT_INGEST_ENABLED) {
    return {
      status: 'skipped',
      commits_seen: 0,
      commits_upserted: 0,
      files_upserted: 0,
      warning: 'GIT_INGEST_ENABLED=false; git intelligence tools are disabled.',
    };
  }

  const pool = getDbPool();
  const rootAbs = path.resolve(params.root);
  const maxCommits = Math.min(Math.max(params.maxCommits ?? env.GIT_MAX_COMMITS_PER_RUN, 1), 1000);
  const ignorePatterns = await loadIgnorePatternsFromRoot(rootAbs);
  ignorePatterns.push('**/.git/**', '**/node_modules/**');

  await pool.query(
    `INSERT INTO projects(project_id, name)
     VALUES ($1,$2)
     ON CONFLICT (project_id) DO NOTHING`,
    [params.projectId, params.projectId],
  );

  const runStart = await pool.query(
    `INSERT INTO git_ingest_runs(project_id, root, since_ref, until_ref, max_commits, status)
     VALUES ($1,$2,$3,$4,$5,'ok')
     RETURNING run_id`,
    [params.projectId, rootAbs, params.since ?? null, 'HEAD', maxCommits],
  );
  const runId = String(runStart.rows?.[0]?.run_id ?? '');

  try {
    const logArgs = ['log', `-n${maxCommits}`, '--date=iso-strict', '--pretty=format:%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%s%x1e'];
    if (params.since && params.since.trim()) {
      logArgs.push(`--since=${params.since.trim()}`);
    }
    const raw = await runGit(rootAbs, logArgs);
    const commits = parseGitLog(raw);

    let commitsUpserted = 0;
    let filesUpserted = 0;
    for (const c of commits) {
      await pool.query(
        `INSERT INTO git_commits(
          project_id, sha, parent_shas, author_name, author_email, committed_at, message, summary, ingested_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
        ON CONFLICT (project_id, sha)
        DO UPDATE SET
          parent_shas=EXCLUDED.parent_shas,
          author_name=EXCLUDED.author_name,
          author_email=EXCLUDED.author_email,
          committed_at=EXCLUDED.committed_at,
          message=EXCLUDED.message,
          summary=EXCLUDED.summary,
          ingested_at=now()`,
        [params.projectId, c.sha, c.parentShas, c.authorName, c.authorEmail, c.committedAt, c.message, summarizeMessage(c.message)],
      );
      commitsUpserted += 1;

      const files = await parseCommitFiles(rootAbs, c.sha, ignorePatterns);
      for (const f of files) {
        await pool.query(
          `INSERT INTO git_commit_files(project_id, commit_sha, file_path, change_kind, additions, deletions, created_at)
           VALUES ($1,$2,$3,$4,$5,$6, now())
           ON CONFLICT (project_id, commit_sha, file_path)
           DO UPDATE SET
             change_kind=EXCLUDED.change_kind,
             additions=EXCLUDED.additions,
             deletions=EXCLUDED.deletions`,
          [params.projectId, c.sha, f.file_path, f.change_kind, f.additions, f.deletions],
        );
        filesUpserted += 1;
      }
    }

    await pool.query(
      `UPDATE git_ingest_runs
       SET commits_seen=$2, commits_upserted=$3, files_upserted=$4, status='ok', finished_at=now()
       WHERE run_id=$1`,
      [runId, commits.length, commitsUpserted, filesUpserted],
    );

    return {
      status: 'ok',
      run_id: runId,
      commits_seen: commits.length,
      commits_upserted: commitsUpserted,
      files_upserted: filesUpserted,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await pool.query(
      `UPDATE git_ingest_runs
       SET status='error', error_message=$2, finished_at=now()
       WHERE run_id=$1`,
      [runId, message],
    );
    return {
      status: 'error',
      run_id: runId,
      commits_seen: 0,
      commits_upserted: 0,
      files_upserted: 0,
      error: message,
    };
  }
}

export async function listCommits(params: { projectId: string; limit?: number }): Promise<ListCommitsResult> {
  const env = getEnv();
  if (!env.GIT_INGEST_ENABLED) {
    return { items: [], warning: 'GIT_INGEST_ENABLED=false; git intelligence tools are disabled.' };
  }
  const pool = getDbPool();
  const limit = Math.min(Math.max(params.limit ?? 20, 1), 200);
  const res = await pool.query(
    `SELECT project_id, sha, parent_shas, author_name, author_email, committed_at, message, summary, ingested_at
     FROM git_commits
     WHERE project_id=$1
     ORDER BY committed_at DESC
     LIMIT $2`,
    [params.projectId, limit],
  );
  return { items: (res.rows ?? []) as ListCommitsResult['items'] };
}

export async function getCommit(params: { projectId: string; sha: string }): Promise<GetCommitResult> {
  const env = getEnv();
  if (!env.GIT_INGEST_ENABLED) {
    return { commit: null, files: [], warning: 'GIT_INGEST_ENABLED=false; git intelligence tools are disabled.' };
  }
  const pool = getDbPool();
  const c = await pool.query(
    `SELECT project_id, sha, parent_shas, author_name, author_email, committed_at, message, summary, ingested_at
     FROM git_commits
     WHERE project_id=$1 AND sha=$2
     LIMIT 1`,
    [params.projectId, params.sha],
  );
  const f = await pool.query(
    `SELECT file_path, change_kind, additions, deletions
     FROM git_commit_files
     WHERE project_id=$1 AND commit_sha=$2
     ORDER BY file_path ASC`,
    [params.projectId, params.sha],
  );
  return {
    commit: (c.rows?.[0] as GetCommitResult['commit']) ?? null,
    files: (f.rows ?? []) as GetCommitResult['files'],
  };
}

async function heuristicLessonForCommit(commit: { sha: string; message: string; files: string[] }): Promise<Omit<SuggestedLessonProposal, 'proposal_id' | 'status'>> {
  const msg = commit.message.toLowerCase();
  let lessonType: LessonType = 'general_note';
  let tags = ['phase5-git-intelligence', 'draft-auto'];
  if (msg.includes('fix')) lessonType = 'workaround';
  if (msg.includes('prefer') || msg.includes('style')) lessonType = 'preference';
  if (msg.includes('decide') || msg.includes('architecture')) lessonType = 'decision';
  if (msg.includes('guardrail') || msg.includes('safety')) lessonType = 'guardrail';
  const shortSha = commit.sha.slice(0, 12);
  return {
    commit_sha: commit.sha,
    lesson_type: lessonType,
    title: `Draft from commit ${shortSha}: ${summarizeMessage(commit.message) || 'update'}`,
    content: `Auto-generated draft from commit ${commit.sha}.\n\nMessage: ${commit.message || '(empty)'}\nChanged files:\n${commit.files.map(f => `- ${f}`).join('\n')}`,
    tags,
    source_refs: [`git:${commit.sha}`, ...commit.files],
    rationale: 'Heuristic draft generated because distillation is disabled or failed.',
  };
}

function normalizeSourceRefs(input: unknown[]): string[] {
  const out: string[] = [];
  for (const x of input) {
    if (typeof x === 'string') {
      const s = x.trim();
      // Defensive: LLMs sometimes emit JS default stringification like "[object Object]".
      if (s && !/^\[object\b/i.test(s)) out.push(s);
      continue;
    }
    if (x && typeof x === 'object') {
      const anyX = x as any;
      const cand = [anyX.file_path, anyX.path, anyX.ref, anyX.uri]
        .map((v: any) => (typeof v === 'string' ? v.trim() : ''))
        .find(Boolean);
      if (cand) out.push(String(cand));
    }
  }
  return out;
}

export async function suggestLessonsFromCommits(params: {
  projectId: string;
  commitShas?: string[];
  limit?: number;
}): Promise<{ proposals: SuggestedLessonProposal[]; warning?: string }> {
  const env = getEnv();
  if (!env.GIT_INGEST_ENABLED) {
    return { proposals: [], warning: 'GIT_INGEST_ENABLED=false; git intelligence tools are disabled.' };
  }

  const pool = getDbPool();
  const limit = Math.min(Math.max(params.limit ?? 5, 1), 20);

  const qRes = params.commitShas?.length
    ? await pool.query(
        `SELECT c.sha, c.message, ARRAY(
          SELECT f.file_path
          FROM git_commit_files f
          WHERE f.project_id=c.project_id AND f.commit_sha=c.sha
          ORDER BY f.file_path ASC
        ) AS files
         FROM git_commits c
         WHERE c.project_id=$1 AND c.sha = ANY($2::text[])
         LIMIT $3`,
        [params.projectId, params.commitShas, limit],
      )
    : await pool.query(
        `SELECT c.sha, c.message, ARRAY(
          SELECT f.file_path
          FROM git_commit_files f
          WHERE f.project_id=c.project_id AND f.commit_sha=c.sha
          ORDER BY f.file_path ASC
        ) AS files
         FROM git_commits c
         WHERE c.project_id=$1
         ORDER BY c.committed_at DESC
         LIMIT $2`,
        [params.projectId, limit],
      );

  const proposals: SuggestedLessonProposal[] = [];
  for (const row of qRes.rows ?? []) {
    const files = ((row.files ?? []) as string[]).slice(0, 20);
    const heur = await heuristicLessonForCommit({
      sha: String(row.sha),
      message: String(row.message ?? ''),
      files,
    });

    let proposal = heur;
    if (env.DISTILLATION_ENABLED) {
      try {
        const llm = await suggestLessonFromCommit({
          sha: heur.commit_sha,
          message: String(row.message ?? ''),
          files,
        });
        proposal = {
          ...proposal,
          lesson_type: llm.lesson_type,
          title: llm.title,
          content: llm.content,
          tags: llm.tags,
          // Defensive: ensure source_refs are always strings (paths/refs), never objects.
          // Always include git:<sha> + changed file paths from DB for determinism.
          source_refs: Array.from(new Set([`git:${heur.commit_sha}`, ...files, ...normalizeSourceRefs((llm as any).source_refs ?? [])])),
          rationale: llm.rationale,
        };
      } catch {
        // keep heuristic proposal
      }
    }

    const proposalId = await upsertGitLessonProposalDraft(pool, {
      projectId: params.projectId,
      sourceCommitSha: proposal.commit_sha,
      lessonType: proposal.lesson_type,
      title: proposal.title,
      content: proposal.content,
      tags: proposal.tags,
      sourceRefs: proposal.source_refs,
      rationale: proposal.rationale,
    });

    proposals.push({
      proposal_id: proposalId,
      ...proposal,
      status: 'draft',
    });
  }

  return { proposals };
}

export async function linkCommitToLesson(params: {
  projectId: string;
  commitSha: string;
  lessonId: string;
}): Promise<{ status: 'ok' | 'error' | 'skipped'; linked_refs: number; warning?: string; error?: string }> {
  const env = getEnv();
  if (!env.GIT_INGEST_ENABLED) {
    return { status: 'skipped', linked_refs: 0, warning: 'GIT_INGEST_ENABLED=false; git intelligence tools are disabled.' };
  }

  const pool = getDbPool();
  const lessonRes = await pool.query(
    `SELECT lesson_type, source_refs
     FROM lessons
     WHERE project_id=$1 AND lesson_id=$2
     LIMIT 1`,
    [params.projectId, params.lessonId],
  );
  if (!lessonRes.rowCount) {
    return { status: 'error', linked_refs: 0, error: 'lesson not found' };
  }

  const filesRes = await pool.query(
    `SELECT file_path
     FROM git_commit_files
     WHERE project_id=$1 AND commit_sha=$2
     ORDER BY file_path ASC`,
    [params.projectId, params.commitSha],
  );
  const fileRefs = (filesRes.rows ?? []).map((r: any) => String(r.file_path));
  const oldRefs = ((lessonRes.rows?.[0]?.source_refs ?? []) as string[]).map(String);
  const nextRefs = Array.from(new Set([...oldRefs, `git:${params.commitSha}`, ...fileRefs]));

  await pool.query(
    `UPDATE lessons
     SET source_refs=$3::text[], updated_at=now()
     WHERE project_id=$1 AND lesson_id=$2`,
    [params.projectId, params.lessonId, nextRefs],
  );

  await linkLessonToSymbols({
    projectId: params.projectId,
    lessonId: params.lessonId,
    lessonType: String(lessonRes.rows?.[0]?.lesson_type) as LessonType,
    sourceRefs: fileRefs,
  }).catch(() => {});

  return { status: 'ok', linked_refs: fileRefs.length + 1 };
}

export async function analyzeCommitImpact(params: {
  projectId: string;
  commitSha: string;
  limit?: number;
}): Promise<{
  commit_sha: string;
  affected_files: string[];
  affected_symbols: Array<{ symbol_id: string; name: string; kind: string; file_path: string }>;
  related_lessons: Array<{ lesson_id: string; title: string; edge: string }>;
  warning?: string;
}> {
  const env = getEnv();
  if (!env.GIT_INGEST_ENABLED) {
    return {
      commit_sha: params.commitSha,
      affected_files: [],
      affected_symbols: [],
      related_lessons: [],
      warning: 'GIT_INGEST_ENABLED=false; git intelligence tools are disabled.',
    };
  }
  const pool = getDbPool();
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
  const filesRes = await pool.query(
    `SELECT file_path
     FROM git_commit_files
     WHERE project_id=$1 AND commit_sha=$2
     ORDER BY file_path ASC`,
    [params.projectId, params.commitSha],
  );
  const affectedFiles = (filesRes.rows ?? []).map((r: any) => String(r.file_path));
  if (!env.KG_ENABLED) {
    return {
      commit_sha: params.commitSha,
      affected_files: affectedFiles,
      affected_symbols: [],
      related_lessons: [],
      warning: 'KG_ENABLED=false; returning file-only impact.',
    };
  }

  const driver = getNeo4jDriver();
  if (!driver) {
    return {
      commit_sha: params.commitSha,
      affected_files: affectedFiles,
      affected_symbols: [],
      related_lessons: [],
      warning: 'Neo4j unavailable; returning file-only impact.',
    };
  }

  const session = driver.session();
  try {
    const symRes = await session.run(
      `MATCH (s:Symbol {project_id: $project_id})
       WHERE s.file_path IN $paths
       RETURN s.symbol_id AS symbol_id, s.name AS name, s.kind AS kind, s.file_path AS file_path
       LIMIT toInteger($limit)`,
      { project_id: params.projectId, paths: affectedFiles, limit },
    );
    const affectedSymbols = symRes.records.map(r => ({
      symbol_id: String(r.get('symbol_id')),
      name: String(r.get('name')),
      kind: String(r.get('kind')),
      file_path: String(r.get('file_path')),
    }));

    const symbolIds = affectedSymbols.map(s => s.symbol_id);
    if (symbolIds.length === 0) {
      return {
        commit_sha: params.commitSha,
        affected_files: affectedFiles,
        affected_symbols: [],
        related_lessons: [],
      };
    }

    const lessonRes = await session.run(
      `MATCH (l:Lesson {project_id: $project_id})-[r:MENTIONS|CONSTRAINS|PREFERS]->(s:Symbol)
       WHERE s.symbol_id IN $symbol_ids
       RETURN DISTINCT l.lesson_id AS lesson_id, l.title AS title, type(r) AS edge
       LIMIT toInteger($limit)`,
      { project_id: params.projectId, symbol_ids: symbolIds, limit },
    );

    return {
      commit_sha: params.commitSha,
      affected_files: affectedFiles,
      affected_symbols: affectedSymbols,
      related_lessons: lessonRes.records.map(r => ({
        lesson_id: String(r.get('lesson_id')),
        title: String(r.get('title')),
        edge: String(r.get('edge')),
      })),
    };
  } finally {
    await session.close();
  }
}
