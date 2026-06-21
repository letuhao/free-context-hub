/**
 * Actor Data Boundary F2g / DEFERRED-048 (full closure) — specifying ANY indexed filesystem path is a
 * GLOBAL capability under enforcement. The explicit-root chokepoint (payload-root-exec-authz.test) is
 * necessary but insufficient: the worker indexes whatever is STORED in project_sources.repo_root /
 * project_workspaces.root_path. So:
 *   - the setters (configureProjectSource / register_workspace_root, and prepareRepo via configure) gate
 *     on global write and STAMP the authorizer;
 *   - resolveProjectRoot re-verifies the stamp still holds global write — a null/legacy/auth-off stamp is
 *     NOT honored under enforcement; the chunks.root fallback (no provenance) is not honored either.
 * Real DB + auth-ON.
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { configureProjectSource, registerWorkspaceRoot, prepareRepo } from '../core/index.js';
import { resolveProjectRoot } from '../utils/resolveProjectRoot.js';
import { createPrincipal, getRootPrincipal, seedRootPrincipal, getSystemPrincipal } from './principals.js';
import { createGrant } from './grants.js';
import { bootstrapSystem } from './bootstrap.js';
import { ContextHubError } from '../core/errors.js';
import { getDbPool } from './../db/client.js';

const PREFIX = '__test_idxroot_authz__';
let sys: string; // global write
let projWriter: string; // write@<project> only, NOT global
let grantor: string;
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
  await pool.query(`DELETE FROM project_sources WHERE project_id LIKE $1`, [`${PREFIX}%`]).catch(() => {});
  await pool.query(`DELETE FROM project_workspaces WHERE project_id LIKE $1`, [`${PREFIX}%`]).catch(() => {});
  await pool.query(`DELETE FROM chunks WHERE project_id LIKE $1`, [`${PREFIX}%`]).catch(() => {});
  await pool.query(`DELETE FROM projects WHERE project_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(
    `DELETE FROM grants WHERE grantee_principal IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)
        OR granted_by IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`,
    [`${PREFIX}%`],
  );
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1`, [`${PREFIX}%`]);
}
const isForbidden = (e: unknown) => e instanceof ContextHubError && e.code === 'FORBIDDEN';

/** Project-scoped writer for a specific project id (each test isolates its own project). */
async function projWith(pid: string): Promise<void> {
  await getDbPool().query(`INSERT INTO projects (project_id, name) VALUES ($1,$1) ON CONFLICT DO NOTHING`, [pid]);
  await createGrant({ grantee_principal: projWriter, scope_type: 'project', scope_id: pid, capability: 'write', granted_by: grantor });
}

before(async () => {
  await cleanup();
  if (!(await getRootPrincipal())) await seedRootPrincipal({ display_name: 'root' });
  await bootstrapSystem();
  sys = (await getSystemPrincipal())!.principal_id;
  grantor = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}grantor` })).principal_id;
  projWriter = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}pw` })).principal_id;
  await setEnv({ MCP_AUTH_ENABLED: 'true' });
});
after(async () => {
  await cleanup();
  await restoreEnv();
});

// ── setter gates ─────────────────────────────────────────────────────────────
test('configureProjectSource with an explicit repo_root by a NON-global principal → FORBIDDEN', async () => {
  const P = `${PREFIX}cfg`;
  await projWith(P);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'idx-cfg-'));
  try {
    await assert.rejects(
      configureProjectSource({ projectId: P, actingPrincipalId: projWriter, sourceType: 'local_workspace', repoRoot: tmp }),
      isForbidden,
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});
test('configureProjectSource with an explicit repo_root by the GLOBAL system principal → ok + stamps the authorizer', async () => {
  const P = `${PREFIX}cfgok`;
  await projWith(P);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'idx-cfgok-'));
  try {
    const res = await configureProjectSource({ projectId: P, actingPrincipalId: sys, sourceType: 'local_workspace', repoRoot: tmp });
    assert.equal(res.status, 'ok');
    const row = await getDbPool().query<{ a: string | null }>(
      `SELECT repo_root_authorized_by AS a FROM project_sources WHERE project_id=$1 LIMIT 1`,
      [P],
    );
    assert.equal(row.rows[0].a, sys);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});
test('prepareRepo by a NON-global principal → FORBIDDEN before any clone/FS write [/review-impl #1]', async () => {
  const P = `${PREFIX}prep`;
  await projWith(P);
  // The up-front gate must reject BEFORE mkdir/git-clone — so a bogus url/cache never gets touched.
  await assert.rejects(
    prepareRepo({
      projectId: P,
      actingPrincipalId: projWriter,
      gitUrl: 'https://example.invalid/x.git',
      cacheRoot: path.join(os.tmpdir(), `${PREFIX}should-not-be-created`),
    }),
    isForbidden,
  );
  // prove no FS side effect happened (the gate fired before mkdir)
  await assert.rejects(fs.stat(path.join(os.tmpdir(), `${PREFIX}should-not-be-created`)), /ENOENT/);
});
test('registerWorkspaceRoot by a NON-global principal → FORBIDDEN', async () => {
  const P = `${PREFIX}ws`;
  await projWith(P);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'idx-ws-'));
  try {
    await assert.rejects(
      registerWorkspaceRoot({ projectId: P, actingPrincipalId: projWriter, rootPath: tmp }),
      isForbidden,
    );
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

// ── resolve-time re-verify ───────────────────────────────────────────────────
test('resolveProjectRoot: stored repo_root stamped by the global principal → honored', async () => {
  const P = `${PREFIX}r2ok`;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'idx-r2-'));
  try {
    await getDbPool().query(`INSERT INTO projects (project_id, name) VALUES ($1,$1) ON CONFLICT DO NOTHING`, [P]);
    await getDbPool().query(
      `INSERT INTO project_sources(project_id, source_type, repo_root, repo_root_authorized_by, enabled, updated_at)
       VALUES ($1,'local_workspace',$2,$3,true, now())`,
      [P, tmp, sys],
    );
    assert.equal(await resolveProjectRoot(P), tmp);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});
test('resolveProjectRoot: stored repo_root with a NULL stamp (legacy/auth-off) → NOT honored → resolution fails', async () => {
  const P = `${PREFIX}r2null`;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'idx-r2n-'));
  try {
    await getDbPool().query(`INSERT INTO projects (project_id, name) VALUES ($1,$1) ON CONFLICT DO NOTHING`, [P]);
    await getDbPool().query(
      `INSERT INTO project_sources(project_id, source_type, repo_root, repo_root_authorized_by, enabled, updated_at)
       VALUES ($1,'local_workspace',$2,NULL,true, now())`,
      [P, tmp],
    );
    // null stamp ⇒ branch 2 skipped; no workspace; chunks not honored under enforcement ⇒ "could not resolve".
    await assert.rejects(resolveProjectRoot(P), /Could not auto-resolve root|root path is required/i);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});
test('resolveProjectRoot: stored repo_root stamped by a NON-global principal → NOT honored', async () => {
  const P = `${PREFIX}r2pw`;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'idx-r2p-'));
  try {
    await projWith(P);
    await getDbPool().query(
      `INSERT INTO project_sources(project_id, source_type, repo_root, repo_root_authorized_by, enabled, updated_at)
       VALUES ($1,'local_workspace',$2,$3,true, now())`,
      [P, tmp, projWriter],
    );
    await assert.rejects(resolveProjectRoot(P), /Could not auto-resolve root|root path is required/i);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});
test('resolveProjectRoot: stored workspace root_path stamped by the global principal → honored (is_active branch works)', async () => {
  const P = `${PREFIX}r3ok`;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'idx-r3-'));
  try {
    await getDbPool().query(`INSERT INTO projects (project_id, name) VALUES ($1,$1) ON CONFLICT DO NOTHING`, [P]);
    await getDbPool().query(
      `INSERT INTO project_workspaces(project_id, root_path, root_path_authorized_by, is_active, updated_at)
       VALUES ($1,$2,$3,true, now())`,
      [P, tmp, sys],
    );
    assert.equal(await resolveProjectRoot(P), tmp);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});
// ── write-side integrity (REVIEW-CODE pass 3) ────────────────────────────────
test('configureProjectSource without repo_root by a project writer does NOT clobber a global-stamped root [p3 #1]', async () => {
  const P = `${PREFIX}clobber`;
  await projWith(P);
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'idx-clob-'));
  try {
    // global configures a stamped repo_root
    await configureProjectSource({ projectId: P, actingPrincipalId: sys, sourceType: 'remote_git', gitUrl: 'g', repoRoot: tmp });
    // project-scoped writer updates the SAME source with no repo_root (allowed — gate only fires on repo_root)
    await configureProjectSource({ projectId: P, actingPrincipalId: projWriter, sourceType: 'remote_git', gitUrl: 'g2' });
    const row = await getDbPool().query<{ r: string | null; a: string | null }>(
      `SELECT repo_root AS r, repo_root_authorized_by AS a FROM project_sources WHERE project_id=$1 AND source_type='remote_git'`,
      [P],
    );
    assert.equal(row.rows[0].r, path.resolve(tmp), 'repo_root preserved');
    assert.equal(row.rows[0].a, sys, 'stamp preserved (not nulled)');
    assert.equal(await resolveProjectRoot(P), path.resolve(tmp), 'still honored after the no-root update');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});
test('resolveProjectRoot: a DISABLED source is NOT honored even with a valid global stamp [p3 #2]', async () => {
  const P = `${PREFIX}disabled`;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'idx-dis-'));
  try {
    await getDbPool().query(`INSERT INTO projects (project_id, name) VALUES ($1,$1) ON CONFLICT DO NOTHING`, [P]);
    await getDbPool().query(
      `INSERT INTO project_sources(project_id, source_type, repo_root, repo_root_authorized_by, enabled, updated_at)
       VALUES ($1,'local_workspace',$2,$3,false, now())`,
      [P, tmp, sys],
    );
    await assert.rejects(resolveProjectRoot(P), /Could not auto-resolve root|root path is required/i);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});

test('resolveProjectRoot: chunks.root fallback (no provenance) → NOT honored under enforcement', async () => {
  const P = `${PREFIX}r4`;
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'idx-r4-'));
  try {
    await getDbPool().query(`INSERT INTO projects (project_id, name) VALUES ($1,$1) ON CONFLICT DO NOTHING`, [P]);
    // a chunk carrying a root, but NO project_sources / project_workspaces row → only branch 4 could match.
    await getDbPool()
      .query(`INSERT INTO chunks(project_id, root, path, content, start_line, end_line) VALUES ($1,$2,'x.ts','x',1,1)`, [P, tmp])
      .catch(async () => {
        // schema variant: minimal insert
        await getDbPool().query(`INSERT INTO chunks(project_id, root, path) VALUES ($1,$2,'x.ts')`, [P, tmp]).catch(() => {});
      });
    await assert.rejects(resolveProjectRoot(P), /Could not auto-resolve root|root path is required/i);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
});
