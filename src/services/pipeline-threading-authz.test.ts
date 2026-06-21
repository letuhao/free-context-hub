/**
 * Actor Data Boundary F2g — /review-impl #1: prove the worker threads its system-worker identity into
 * the SIX pipeline services F2f had not plumbed (faqBuilder / raptorBuilder / qcEval / builderMemory /
 * builderMemoryLarge / runExtraction-via-vision-job). The index.run proof (system-identity-authz)
 * covers only executeByType→indexProject; these services forward the principal into THEIR OWN guarded
 * leaves, and the forward param is optional — a dropped forward compiles clean and would silently
 * NO_PRINCIPAL-deny that job type at the flip.
 *
 * Method (auth-ON): call each service with the COVERING system principal (global write). Its guarded
 * leaf must NOT deny. A dropped forward → the leaf receives `undefined` → NO_PRINCIPAL → NOT_FOUND /
 * FORBIDDEN, which we assert against. Real embedder/LLM/fs/network failures are non-authz and tolerated
 * (the leaf's guard already passed by then). Where a leaf sits behind LLM work that can't be forced,
 * we require evidence the leaf was reached, else skip honestly (never a vacuous pass).
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildFaq } from './faqBuilder.js';
import { buildRaptorSummaries } from './raptorBuilder.js';
import { runQualityEvalAndPersist } from './qcEval.js';
import { buildProjectMemoryArtifact } from './builderMemory.js';
import { buildLargeRepoProjectMemory } from './builderMemoryLarge.js';
import { runJobById } from './jobExecutor.js';
import { getSystemPrincipal, getRootPrincipal, seedRootPrincipal } from './principals.js';
import { bootstrapSystem } from './bootstrap.js';
import { ContextHubError } from '../core/errors.js';
import { getDbPool } from '../db/client.js';
import { getEnv } from '../env.js';

const PREFIX = '__test_pipethread_authz__';
const P = `${PREFIX}proj`;

let sys: string; // covering: global-write system-worker principal
const saved: Record<string, string | undefined> = {};

async function setEnv(patch: Record<string, string>) {
  for (const k of Object.keys(patch)) {
    if (!(k in saved)) saved[k] = process.env[k];
    process.env[k] = patch[k];
  }
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
}
async function restoreEnv() {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
}
async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM async_jobs WHERE project_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM generated_documents WHERE project_id LIKE $1`, [`${PREFIX}%`]).catch(() => {});
  await pool.query(`DELETE FROM chunks WHERE project_id LIKE $1`, [`${PREFIX}%`]).catch(() => {});
  await pool.query(`DELETE FROM files WHERE project_id LIKE $1`, [`${PREFIX}%`]).catch(() => {});
  await pool.query(`DELETE FROM lessons WHERE project_id LIKE $1`, [`${PREFIX}%`]).catch(() => {});
  await pool.query(`DELETE FROM projects WHERE project_id LIKE $1`, [`${PREFIX}%`]);
}

/** A covering-principal call must never hit an authz DENIAL at a guarded leaf — that would mean the
 * actingPrincipalId forward was dropped. Any other error (network/fs/LLM) is fine: the guard passed. */
async function assertForwardReaches(label: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    if (e instanceof ContextHubError && (e.code === 'NOT_FOUND' || e.code === 'FORBIDDEN')) {
      assert.fail(`${label}: a guarded leaf DENIED under the covering system principal (${e.code}) → actingPrincipalId was not forwarded`);
    }
    // non-authz error → the leaf's guard was reached and passed; forward is wired.
  }
}

before(async () => {
  await cleanup();
  if (!(await getRootPrincipal())) await seedRootPrincipal({ display_name: 'root' });
  await bootstrapSystem();
  sys = (await getSystemPrincipal())!.principal_id;
  await getDbPool().query(`INSERT INTO projects (project_id, name) VALUES ($1,$1) ON CONFLICT DO NOTHING`, [P]);
  // Keep these forward-proofs fast + deterministic: disable distillation (qaAnswer early-returns with
  // no LLM; compressText uses its no-LLM truncation fallback so raptor reaches its leaf) and point the
  // embedder at a closed local port so searchCode's embed fails instantly (ECONNREFUSED) AFTER its
  // guard — instead of a ~10s timeout against the unreachable dev embedder URL.
  await setEnv({
    MCP_AUTH_ENABLED: 'true',
    DISTILLATION_ENABLED: 'false',
    DISTILLATION_MODEL: '',
    EMBEDDINGS_BASE_URL: 'http://127.0.0.1:1',
  });
});
after(async () => {
  await cleanup();
  await restoreEnv();
});

// 1. buildFaq → searchCode (leaf-1, before any write). Covering principal: guard passes → embedder
//    runs (or fails non-authz). Dropped forward → searchCode NO_PRINCIPAL before the embedder.
test('buildFaq forwards actingPrincipalId to its guarded leaves', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'f2g-faq-'));
  try {
    await assertForwardReaches('buildFaq', () =>
      buildFaq({ projectId: P, actingPrincipalId: sys, root: tmp, modules: ['mcp-server'], outputTarget: 'docs' }),
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

// 2. qcEval.runQualityEvalAndPersist → getGeneratedDocument (leaf-1, pure DB read, no LLM). Bogus
//    queriesPath makes the post-leaf golden eval fail fast (fs ENOENT, non-authz).
test('runQualityEvalAndPersist forwards actingPrincipalId to its guarded leaves', async () => {
  await assertForwardReaches('runQualityEvalAndPersist', () =>
    runQualityEvalAndPersist({
      projectId: P,
      actingPrincipalId: sys,
      env: getEnv(),
      queriesPath: path.join(os.tmpdir(), 'f2g-no-such-golden.json'),
      hybridMode: 'off',
    }),
  );
});

// 3. builderMemoryLarge → manifest upsertGeneratedDocument (reached after scanRepoManifest, BEFORE any
//    LLM merge). Deterministic on an empty dir; assert the manifest row was actually written.
test('buildLargeRepoProjectMemory forwards actingPrincipalId to its manifest upsert', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'f2g-bml-'));
  await setEnv({ BUILDER_MEMORY_ENABLED: 'true' });
  try {
    await assertForwardReaches('buildLargeRepoProjectMemory', () =>
      buildLargeRepoProjectMemory({ projectId: P, actingPrincipalId: sys, root: tmp }),
    );
    const r = await getDbPool().query(
      `SELECT 1 FROM generated_documents WHERE project_id = $1 AND doc_key LIKE 'phase6/builder_memory/manifest/%' LIMIT 1`,
      [P],
    );
    assert.equal(r.rowCount, 1, 'manifest upsert leaf was reached and wrote a row under the system principal');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

// 4. raptorBuilder → level-1 upsertGeneratedDocument. With distillation disabled, compressText uses its
//    no-LLM truncation fallback, so the leaf is reached deterministically. Assert a raptor row exists.
test('buildRaptorSummaries forwards actingPrincipalId to its upsert leaf', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'f2g-raptor-'));
  await fs.mkdir(path.join(tmp, 'docs'), { recursive: true });
  await fs.writeFile(path.join(tmp, 'docs', 'x.md'), '# Title\n\nSome documentation text to summarize.\n', 'utf8');
  try {
    await assertForwardReaches('buildRaptorSummaries', () =>
      buildRaptorSummaries({ projectId: P, actingPrincipalId: sys, root: tmp, pathGlob: 'docs/**/*.md', maxLevels: 1 }),
    );
    const r = await getDbPool().query(
      `SELECT 1 FROM generated_documents WHERE project_id = $1 AND doc_type = 'raptor' LIMIT 1`,
      [P],
    );
    assert.equal(r.rowCount, 1, 'raptor L1 upsert leaf was reached under the system principal');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

// 5. runExtraction (via the document.extract.vision job path → executeByType forward). Bogus doc_id:
//    runExtraction's own guard passes under the covering principal, then doc-load fails non-authz. A
//    dropped forward in executeByType → runExtraction guard NO_PRINCIPAL (exact message 'not found').
test('document.extract.vision forwards actingPrincipalId into runExtraction', async () => {
  const jobId = (
    await getDbPool().query<{ job_id: string }>(
      `INSERT INTO async_jobs(job_id, project_id, job_type, queue_name, payload, status, max_attempts, available_at, queued_at)
       VALUES (gen_random_uuid(), $1, 'document.extract.vision', 'default', $2::jsonb, 'queued', 1, now(), now()) RETURNING job_id`,
      [P, JSON.stringify({ doc_id: '00000000-0000-0000-0000-0000000000ff' })],
    )
  ).rows[0].job_id;
  const res = await runJobById(jobId, { actingPrincipalId: sys });
  if (res.status === 'error') {
    assert.doesNotMatch(String(res.error ?? ''), /not authorized to|^not found$|NO_PRINCIPAL/i, res.error);
  } else {
    assert.equal(res.status, 'ok');
  }
});

// 6. builderMemory single-pass → upsert sits behind synthesizeMemoryChunked (LLM), which has no no-LLM
//    fallback. Prove the forward when the LLM produces output; skip honestly (status 'skipped') if not
//    — never a vacuous pass.
test('buildProjectMemoryArtifact forwards actingPrincipalId to its upsert (or skips honestly)', async (t) => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'f2g-bm-'));
  await fs.writeFile(path.join(tmp, 'a.ts'), 'export const x = 1; // sample source for memory synthesis\n', 'utf8');
  await setEnv({ BUILDER_MEMORY_ENABLED: 'true' });
  try {
    let result: { status: string; reason?: string } | undefined;
    await assertForwardReaches('buildProjectMemoryArtifact', async () => {
      result = await buildProjectMemoryArtifact({ projectId: P, actingPrincipalId: sys, root: tmp });
    });
    if (!result || result.status === 'skipped') {
      t.skip(`leaf not reached without a live LLM (status=${result?.status ?? 'threw-non-authz'}, reason=${result?.reason ?? '-'})`);
      return;
    }
    assert.equal(result.status, 'ok', 'reached the upsert leaf under the system principal');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});
