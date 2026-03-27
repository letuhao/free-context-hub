import { getEnv } from '../env.js';
import { getNeo4jDriver } from './client.js';

function kgDisabledWarning() {
  return { warning: 'KG_ENABLED=false or Neo4j unavailable; graph tools return empty results.' };
}

export type SearchSymbolsMatch = {
  symbol_id: string;
  name: string;
  kind: string;
  file_path: string;
  score: number;
};

export async function searchSymbols(params: {
  projectId: string;
  query: string;
  limit?: number;
}): Promise<{ matches: SearchSymbolsMatch[]; warning?: string }> {
  const env = getEnv();
  if (!env.KG_ENABLED) {
    return { matches: [], ...kgDisabledWarning() };
  }
  const driver = getNeo4jDriver();
  if (!driver) {
    return { matches: [], ...kgDisabledWarning() };
  }

  const limit = Math.trunc(Math.min(Math.max(params.limit ?? 10, 1), 50));
  const q = params.query.trim().toLowerCase();
  if (!q) return { matches: [] };

  const session = driver.session();
  try {
    const res = await session.run(
      `MATCH (s:Symbol {project_id: $project_id})
       WHERE toLower(s.name) CONTAINS $q OR toLower(s.fqn) CONTAINS $q
       RETURN s.symbol_id AS symbol_id,
              s.name AS name,
              s.kind AS kind,
              s.file_path AS file_path
       LIMIT toInteger($limit)`,
      { project_id: params.projectId, q, limit },
    );

    const matches: SearchSymbolsMatch[] = res.records.map(r => ({
      symbol_id: String(r.get('symbol_id')),
      name: String(r.get('name')),
      kind: String(r.get('kind')),
      file_path: String(r.get('file_path')),
      score: 1,
    }));
    return { matches };
  } finally {
    await session.close();
  }
}

export type SymbolNeighbor = {
  id: string;
  name: string;
  kind: string;
  file_path: string;
  depth: number;
  labels: string[];
};

export type SymbolEdge = {
  from: string;
  to: string;
  type: string;
};

export async function getSymbolNeighbors(params: {
  projectId: string;
  symbolId: string;
  depth?: number;
  limit?: number;
}): Promise<{
  center: SearchSymbolsMatch | null;
  neighbors: SymbolNeighbor[];
  edges: SymbolEdge[];
  warning?: string;
}> {
  const env = getEnv();
  if (!env.KG_ENABLED) {
    return { center: null, neighbors: [], edges: [], ...kgDisabledWarning() };
  }
  const driver = getNeo4jDriver();
  if (!driver) {
    return { center: null, neighbors: [], edges: [], ...kgDisabledWarning() };
  }

  const hop = Math.min(Math.max(params.depth ?? 1, 1), 4);
  const limit = Math.trunc(Math.min(Math.max(params.limit ?? 40, 1), 200));

  const session = driver.session();
  try {
    const centerRes = await session.run(
      `MATCH (s:Symbol {project_id: $project_id, symbol_id: $symbol_id})
       RETURN s.symbol_id AS symbol_id, s.name AS name, s.kind AS kind, s.file_path AS file_path
       LIMIT 1`,
      { project_id: params.projectId, symbol_id: params.symbolId },
    );
    const c0 = centerRes.records[0];
    const center: SearchSymbolsMatch | null = c0
      ? {
          symbol_id: String(c0.get('symbol_id')),
          name: String(c0.get('name')),
          kind: String(c0.get('kind')),
          file_path: String(c0.get('file_path')),
          score: 1,
        }
      : null;

    const cypher = `
MATCH (c:Symbol {project_id: $project_id, symbol_id: $symbol_id})
MATCH p=(c)-[*1..${hop}]-(n)
WHERE (n:Symbol OR n:File)
WITH n, min(length(p)) AS d
RETURN n, d
ORDER BY d ASC
LIMIT toInteger($limit)`;

    const res = await session.run(cypher, {
      project_id: params.projectId,
      symbol_id: params.symbolId,
      limit,
    });

    const neighbors: SymbolNeighbor[] = [];
    const seen = new Set<string>();

    for (const r of res.records) {
      const n = r.get('n') as any;
      if (!n?.properties) continue;
      const labels: string[] = n.labels ?? [];
      const id =
        labels.includes('Symbol') && n.properties.symbol_id
          ? String(n.properties.symbol_id)
          : labels.includes('File') && n.properties.file_id
            ? String(n.properties.file_id)
            : '';

      if (!id || id === params.symbolId) continue;
      if (seen.has(id)) continue;
      seen.add(id);

      neighbors.push({
        id,
        name: String(n.properties.name ?? n.properties.path ?? ''),
        kind: String(n.properties.kind ?? (labels.includes('File') ? 'file' : 'unknown')),
        file_path: String(n.properties.file_path ?? n.properties.path ?? ''),
        depth: Number(r.get('d') ?? 1),
        labels,
      });
    }

    const edgeRes = await session.run(
      `MATCH (c:Symbol {project_id: $project_id, symbol_id: $symbol_id})
       MATCH (c)-[r]-(m)
       WHERE (m:Symbol OR m:File)
       RETURN coalesce(startNode(r).symbol_id, startNode(r).file_id) AS a,
              coalesce(endNode(r).symbol_id, endNode(r).file_id) AS b,
              type(r) AS t
       LIMIT toInteger($limit)`,
      { project_id: params.projectId, symbol_id: params.symbolId, limit },
    );

    const edges: SymbolEdge[] = edgeRes.records
      .map(r => ({
        from: String(r.get('a') ?? ''),
        to: String(r.get('b') ?? ''),
        type: String(r.get('t') ?? ''),
      }))
      .filter(e => e.from && e.to && e.type);

    return { center, neighbors, edges };
  } finally {
    await session.close();
  }
}

export async function traceDependencyPath(params: {
  projectId: string;
  fromSymbolId: string;
  toSymbolId: string;
  maxHops?: number;
}): Promise<{
  found: boolean;
  path_nodes: Array<{ id: string; name: string; kind: string; file_path: string }>;
  path_edges: Array<{ from: string; to: string; type: string }>;
  hops: number;
  warning?: string;
}> {
  const env = getEnv();
  if (!env.KG_ENABLED) {
    return { found: false, path_nodes: [], path_edges: [], hops: 0, ...kgDisabledWarning() };
  }
  const driver = getNeo4jDriver();
  if (!driver) {
    return { found: false, path_nodes: [], path_edges: [], hops: 0, ...kgDisabledWarning() };
  }

  const maxHops = Math.min(Math.max(params.maxHops ?? 12, 1), 24);
  const session = driver.session();
  try {
    const res = await session.run(
      `MATCH (a:Symbol {project_id: $project_id, symbol_id: $from})
       MATCH (b:Symbol {project_id: $project_id, symbol_id: $to})
       MATCH p = shortestPath((a)-[*..${maxHops}]-(b))
       RETURN [x IN nodes(p) | {
          id: coalesce(x.symbol_id, x.file_id, x.lesson_id, ''),
          name: coalesce(x.name, x.title, x.path, ''),
          kind: coalesce(x.kind, head(labels(x))),
          file_path: coalesce(x.file_path, x.path, '')
        }] AS path_nodes,
        [r IN relationships(p) | {
          from: coalesce(startNode(r).symbol_id, startNode(r).file_id, startNode(r).lesson_id, ''),
          to: coalesce(endNode(r).symbol_id, endNode(r).file_id, endNode(r).lesson_id, ''),
          type: type(r)
        }] AS path_edges,
        length(p) AS hops`,
      { project_id: params.projectId, from: params.fromSymbolId, to: params.toSymbolId },
    );

    const rec = res.records[0];
    if (!rec) {
      return { found: false, path_nodes: [], path_edges: [], hops: 0 };
    }

    const path_nodes = (rec.get('path_nodes') as any[]).map(n => ({
      id: String(n.id ?? ''),
      name: String(n.name ?? ''),
      kind: String(n.kind ?? ''),
      file_path: String(n.file_path ?? ''),
    }));

    const path_edges = (rec.get('path_edges') as any[]).map(e => ({
      from: String(e.from ?? ''),
      to: String(e.to ?? ''),
      type: String(e.type ?? ''),
    }));

    const hops = Number(rec.get('hops') ?? 0);
    return { found: path_nodes.length > 0, path_nodes, path_edges, hops };
  } finally {
    await session.close();
  }
}

export async function getLessonImpact(params: {
  projectId: string;
  lessonId: string;
  limit?: number;
}): Promise<{
  lesson: { lesson_id: string; title: string; lesson_type: string } | null;
  linked_symbols: Array<{ symbol_id: string; name: string; kind: string; file_path: string; edge: string }>;
  affected_files: string[];
  rationale: string;
  warning?: string;
}> {
  const env = getEnv();
  if (!env.KG_ENABLED) {
    return {
      lesson: null,
      linked_symbols: [],
      affected_files: [],
      rationale: 'Knowledge graph disabled; no lesson-to-symbol links available.',
      ...kgDisabledWarning(),
    };
  }
  const driver = getNeo4jDriver();
  if (!driver) {
    return {
      lesson: null,
      linked_symbols: [],
      affected_files: [],
      rationale: 'Neo4j unavailable; no lesson impact data.',
      ...kgDisabledWarning(),
    };
  }

  const limit = Math.trunc(Math.min(Math.max(params.limit ?? 50, 1), 200));
  const session = driver.session();
  try {
    const res = await session.run(
      `MATCH (l:Lesson {project_id: $project_id, lesson_id: $lesson_id})
       OPTIONAL MATCH (l)-[r:MENTIONS|CONSTRAINS|PREFERS]->(s:Symbol)
       WHERE s IS NULL OR s.project_id = $project_id
       RETURN l.lesson_id AS lesson_id,
              l.title AS title,
              l.lesson_type AS lesson_type,
              collect(DISTINCT {
                symbol_id: s.symbol_id,
                name: s.name,
                kind: s.kind,
                file_path: s.file_path,
                edge: type(r)
              })[0..toInteger($limit)] AS syms`,
      { project_id: params.projectId, lesson_id: params.lessonId, limit },
    );

    const rec = res.records[0];
    if (!rec) {
      return {
        lesson: null,
        linked_symbols: [],
        affected_files: [],
        rationale: 'Lesson not found in graph store (run add_lesson with KG enabled and source_refs).',
      };
    }

    const symsRaw = (rec.get('syms') as any[]) ?? [];
    const linked_symbols = symsRaw
      .filter(s => s && s.symbol_id != null && String(s.symbol_id).length > 0)
      .map(s => ({
        symbol_id: String(s.symbol_id),
        name: String(s.name ?? ''),
        kind: String(s.kind ?? ''),
        file_path: String(s.file_path ?? ''),
        edge: String(s.edge ?? 'MENTIONS'),
      }));

    const files = new Set<string>();
    for (const s of linked_symbols) {
      if (s.file_path) files.add(s.file_path);
    }

    return {
      lesson: {
        lesson_id: String(rec.get('lesson_id')),
        title: String(rec.get('title') ?? ''),
        lesson_type: String(rec.get('lesson_type') ?? ''),
      },
      linked_symbols,
      affected_files: [...files],
      rationale:
        linked_symbols.length === 0
          ? 'No symbol links yet; include source_refs (file paths) in lessons or ensure symbols were indexed.'
          : `Linked ${linked_symbols.length} symbol(s); impacted files derived from symbol file paths.`,
    };
  } finally {
    await session.close();
  }
}
