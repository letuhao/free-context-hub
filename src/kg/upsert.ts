import path from 'node:path';
import type { Driver } from 'neo4j-driver';

import { getEnv } from '../env.js';
import { getNeo4jDriver } from './client.js';
import { extractTsMorphFileGraph } from './extractor/tsMorphExtractor.js';
import { makeFileGraphId, makeSymbolGraphId, normalizeRepoPath } from './ids.js';

export type GraphIngestResult =
  | { status: 'skipped'; reason: string }
  | { status: 'ok'; file_id: string; symbols_upserted: number; edges_upserted: number }
  | { status: 'error'; message: string };

function getDriverOrNull(): Driver | null {
  const env = getEnv();
  if (!env.KG_ENABLED) return null;
  return getNeo4jDriver();
}

async function clearFileGraph(driver: Driver, fileId: string): Promise<void> {
  const session = driver.session();
  try {
    await session.executeWrite(tx =>
      tx.run(
        `MATCH (f:File {file_id: $file_id})
         OPTIONAL MATCH (f)-[:DECLARES]->(s:Symbol)
         DETACH DELETE s
         WITH f
         OPTIONAL MATCH (f)-[ri:IMPORTS]->()
         DELETE ri`,
        { file_id: fileId },
      ),
    );
  } finally {
    await session.close();
  }
}

export async function upsertFileGraphFromDisk(params: {
  projectId: string;
  rootAbs: string;
  fileRel: string;
}): Promise<GraphIngestResult> {
  const env = getEnv();
  if (!env.KG_ENABLED) {
    return { status: 'skipped', reason: 'KG_ENABLED=false' };
  }

  const driver = getDriverOrNull();
  if (!driver) {
    return { status: 'skipped', reason: 'Neo4j driver unavailable' };
  }

  const fileRel = normalizeRepoPath(params.fileRel);
  const abs = path.join(params.rootAbs, fileRel);

  const extracted = extractTsMorphFileGraph({
    projectId: params.projectId,
    rootAbs: params.rootAbs,
    fileRel,
    fileAbs: abs,
  });

  if (!extracted) {
    return { status: 'skipped', reason: 'not_ts_or_js' };
  }

  const fileId = makeFileGraphId(params.projectId, fileRel);

  if (extracted.symbols.length === 0) {
    await clearFileGraph(driver, fileId);
    return { status: 'skipped', reason: 'no_extractable_symbols' };
  }

  const symbolRows = extracted.symbols.map(s => ({
    symbol_id: makeSymbolGraphId(params.projectId, fileRel, s.fqn, s.signature),
    name: s.name,
    kind: s.kind,
    fqn: s.fqn,
    signature: s.signature,
  }));

  const importEdges = extracted.edges
    .filter((e): e is Extract<typeof e, { type: 'IMPORTS' }> => e.type === 'IMPORTS')
    .map(e => ({
      target_file_id: makeFileGraphId(params.projectId, normalizeRepoPath(e.target_file_rel)),
      specifier: e.specifier,
    }));

  const callEdges = extracted.edges
    .filter((e): e is Extract<typeof e, { type: 'CALLS' }> => e.type === 'CALLS')
    .map(e => {
      const from = extracted.symbols.find(s => s.fqn === e.from_fqn);
      const to = extracted.symbols.find(s => s.fqn === e.to_fqn);
      if (!from || !to) return null;
      return {
        from_id: makeSymbolGraphId(params.projectId, fileRel, from.fqn, from.signature),
        to_id: makeSymbolGraphId(params.projectId, fileRel, to.fqn, to.signature),
      };
    })
    .filter((x): x is { from_id: string; to_id: string } => Boolean(x));

  const extendsEdges = extracted.edges
    .filter((e): e is Extract<typeof e, { type: 'EXTENDS' }> => e.type === 'EXTENDS')
    .map(e => {
      const from = extracted.symbols.find(s => s.fqn === e.from_fqn);
      const to = extracted.symbols.find(s => s.fqn === e.to_fqn);
      if (!from || !to) return null;
      return {
        from_id: makeSymbolGraphId(params.projectId, fileRel, from.fqn, from.signature),
        to_id: makeSymbolGraphId(params.projectId, fileRel, to.fqn, to.signature),
      };
    })
    .filter((x): x is { from_id: string; to_id: string } => Boolean(x));

  const implEdges = extracted.edges
    .filter((e): e is Extract<typeof e, { type: 'IMPLEMENTS' }> => e.type === 'IMPLEMENTS')
    .map(e => {
      const from = extracted.symbols.find(s => s.fqn === e.from_fqn);
      const to = extracted.symbols.find(s => s.fqn === e.to_fqn);
      if (!from || !to) return null;
      return {
        from_id: makeSymbolGraphId(params.projectId, fileRel, from.fqn, from.signature),
        to_id: makeSymbolGraphId(params.projectId, fileRel, to.fqn, to.signature),
      };
    })
    .filter((x): x is { from_id: string; to_id: string } => Boolean(x));

  const session = driver.session();
  try {
    await session.executeWrite(async tx => {
      await tx.run(
        `MERGE (p:Project {project_id: $project_id})
         ON CREATE SET p.created_at = datetime()
         SET p.updated_at = datetime()
         WITH p
         MERGE (f:File {file_id: $file_id})
         ON CREATE SET f.created_at = datetime()
         SET f.path = $path, f.project_id = $project_id, f.updated_at = datetime()
         MERGE (p)-[:HAS_FILE]->(f)
         WITH f
         OPTIONAL MATCH (f)-[:DECLARES]->(s:Symbol)
         DETACH DELETE s
         WITH f
         OPTIONAL MATCH (f)-[ri:IMPORTS]->()
         DELETE ri`,
        { project_id: params.projectId, file_id: fileId, path: fileRel },
      );

      for (const s of symbolRows) {
        await tx.run(
          `MATCH (f:File {file_id: $file_id})
           MERGE (sym:Symbol {symbol_id: $symbol_id})
           SET sym.name = $name,
               sym.kind = $kind,
               sym.fqn = $fqn,
               sym.signature = $signature,
               sym.file_path = $file_path,
               sym.file_id = $file_id,
               sym.project_id = $project_id,
               sym.updated_at = datetime()
           MERGE (f)-[:DECLARES]->(sym)`,
          {
            file_id: fileId,
            symbol_id: s.symbol_id,
            name: s.name,
            kind: s.kind,
            fqn: s.fqn,
            signature: s.signature,
            file_path: fileRel,
            project_id: params.projectId,
          },
        );
      }

      for (const e of importEdges) {
        await tx.run(
          `MATCH (src:File {file_id: $src})
           MERGE (dst:File {file_id: $dst})
           ON CREATE SET dst.created_at = datetime(), dst.path = $dst_placeholder, dst.project_id = $project_id
           SET dst.project_id = coalesce(dst.project_id, $project_id)
           MERGE (src)-[r:IMPORTS]->(dst)
           SET r.specifier = $specifier, r.updated_at = datetime()`,
          {
            src: fileId,
            dst: e.target_file_id,
            dst_placeholder: '(pending_index)',
            project_id: params.projectId,
            specifier: e.specifier,
          },
        );
      }

      for (const e of callEdges) {
        await tx.run(
          `MATCH (a:Symbol {symbol_id: $from}), (b:Symbol {symbol_id: $to})
           MERGE (a)-[r:CALLS]->(b)
           SET r.updated_at = datetime()`,
          { from: e.from_id, to: e.to_id },
        );
      }
      for (const e of extendsEdges) {
        await tx.run(
          `MATCH (a:Symbol {symbol_id: $from}), (b:Symbol {symbol_id: $to})
           MERGE (a)-[r:EXTENDS]->(b)
           SET r.updated_at = datetime()`,
          { from: e.from_id, to: e.to_id },
        );
      }
      for (const e of implEdges) {
        await tx.run(
          `MATCH (a:Symbol {symbol_id: $from}), (b:Symbol {symbol_id: $to})
           MERGE (a)-[r:IMPLEMENTS]->(b)
           SET r.updated_at = datetime()`,
          { from: e.from_id, to: e.to_id },
        );
      }
    });

    const edgesUpserted = importEdges.length + callEdges.length + extendsEdges.length + implEdges.length;
    return { status: 'ok', file_id: fileId, symbols_upserted: symbolRows.length, edges_upserted: edgesUpserted };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  } finally {
    await session.close();
  }
}
