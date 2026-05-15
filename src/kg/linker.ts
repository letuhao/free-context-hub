import { getEnv } from '../env.js';
import type { LessonType } from '../services/lessons.js';
import { getNeo4jDriver } from './client.js';
import { normalizeRepoPath } from './ids.js';

function edgeForLessonType(t: LessonType): 'MENTIONS' | 'CONSTRAINS' | 'PREFERS' {
  // Phase 13 Sprint 13.5: codex-guardrail joins guardrail in the CONSTRAINS class.
  if (t === 'guardrail' || t === 'codex-guardrail') return 'CONSTRAINS';
  if (t === 'preference') return 'PREFERS';
  return 'MENTIONS';
}

/** Parse `src/a.ts`, `src/a.ts:foo`, or `src/a.ts::Bar` style refs (best-effort). */
export function parseSourceRef(ref: string): { filePath: string; symbolName?: string } | null {
  const s = ref.trim().replace(/^`+|`+$/g, '').trim();
  if (!s) return null;

  const norm = normalizeRepoPath(s);

  // Only treat ":" as a separator when it looks like `...path...:symbol`
  const lastColon = norm.lastIndexOf(':');
  if (lastColon > 0 && lastColon < norm.length - 1) {
    const left = norm.slice(0, lastColon);
    const right = norm.slice(lastColon + 1);
    const looksLikePath = left.includes('/') || left.includes('\\');
    const looksLikeSymbol = /^[A-Za-z_$][\w$]*$/.test(right);
    if (looksLikePath && looksLikeSymbol) {
      return { filePath: normalizeRepoPath(left), symbolName: right };
    }
  }

  return { filePath: norm.replace(/^\.\//, '') };
}

export async function upsertLessonNode(params: {
  projectId: string;
  lessonId: string;
  title: string;
  lessonType: LessonType;
}): Promise<{ status: 'skipped' | 'ok' | 'error'; message?: string }> {
  const env = getEnv();
  if (!env.KG_ENABLED) return { status: 'skipped' };
  const driver = getNeo4jDriver();
  if (!driver) return { status: 'skipped' };

  const session = driver.session();
  try {
    await session.executeWrite(tx =>
      tx.run(
        `MERGE (p:Project {project_id: $project_id})
         ON CREATE SET p.created_at = datetime()
         SET p.updated_at = datetime()
         MERGE (l:Lesson {lesson_id: $lesson_id})
         ON CREATE SET l.created_at = datetime()
         SET l.project_id = $project_id,
             l.title = $title,
             l.lesson_type = $lesson_type,
             l.updated_at = datetime()
         MERGE (p)-[:HAS_LESSON]->(l)`,
        {
          project_id: params.projectId,
          lesson_id: params.lessonId,
          title: params.title,
          lesson_type: params.lessonType,
        },
      ),
    );
    return { status: 'ok' };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  } finally {
    await session.close();
  }
}

async function mergeLessonEdge(params: {
  lessonId: string;
  projectId: string;
  filePath: string;
  symbolName?: string;
  edge: 'MENTIONS' | 'CONSTRAINS' | 'PREFERS';
}): Promise<number> {
  const driver = getNeo4jDriver();
  if (!driver) return 0;
  const session = driver.session();

  const cypherByEdge: Record<typeof params.edge, string> = {
    MENTIONS: `MATCH (l:Lesson {project_id: $project_id, lesson_id: $lesson_id})
               MATCH (s:Symbol {project_id: $project_id, file_path: $file_path})
               WHERE ($symbol_name IS NULL) OR (s.name = $symbol_name)
               MERGE (l)-[:MENTIONS]->(s)
               RETURN count(s) AS c`,
    CONSTRAINS: `MATCH (l:Lesson {project_id: $project_id, lesson_id: $lesson_id})
                 MATCH (s:Symbol {project_id: $project_id, file_path: $file_path})
                 WHERE ($symbol_name IS NULL) OR (s.name = $symbol_name)
                 MERGE (l)-[:CONSTRAINS]->(s)
                 RETURN count(s) AS c`,
    PREFERS: `MATCH (l:Lesson {project_id: $project_id, lesson_id: $lesson_id})
              MATCH (s:Symbol {project_id: $project_id, file_path: $file_path})
              WHERE ($symbol_name IS NULL) OR (s.name = $symbol_name)
              MERGE (l)-[:PREFERS]->(s)
              RETURN count(s) AS c`,
  };

  try {
    const res = await session.run(cypherByEdge[params.edge], {
      project_id: params.projectId,
      lesson_id: params.lessonId,
      file_path: params.filePath,
      symbol_name: params.symbolName && params.symbolName.length ? params.symbolName : null,
    });
    return Number(res.records[0]?.get('c') ?? 0);
  } finally {
    await session.close();
  }
}

export async function linkLessonToSymbols(params: {
  projectId: string;
  lessonId: string;
  lessonType: LessonType;
  sourceRefs: string[];
}): Promise<{ status: 'skipped' | 'ok' | 'error'; links: number; message?: string }> {
  const env = getEnv();
  if (!env.KG_ENABLED) return { status: 'skipped', links: 0 };
  const driver = getNeo4jDriver();
  if (!driver) return { status: 'skipped', links: 0 };

  const edge = edgeForLessonType(params.lessonType);
  let links = 0;

  try {
    for (const ref of params.sourceRefs) {
      const parsed = parseSourceRef(ref);
      if (!parsed) continue;

      const n = await mergeLessonEdge({
        lessonId: params.lessonId,
        projectId: params.projectId,
        filePath: parsed.filePath,
        symbolName: parsed.symbolName,
        edge,
      });
      links += n;
    }

    return { status: 'ok', links };
  } catch (err) {
    return { status: 'error', links, message: err instanceof Error ? err.message : String(err) };
  }
}
