/**
 * DEFERRED-008 — lesson_types.scope round-trips through the exchange path.
 *
 * Verifies the export SELECT carries `scope`, the import INSERT/UPDATE persists it,
 * and a pre-fix bundle (no `scope` field) defaults to 'global' (prior behavior).
 */

import assert from 'node:assert/strict';
import test, { before, after, beforeEach } from 'node:test';
import { mkdtempSync, rmSync, createWriteStream, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { PassThrough } from 'node:stream';
import { exportProject } from './exportProject.js';
import { importProject } from './importProject.js';
import { encodeBundle, openBundle, type BundleData } from './bundleFormat.js';
import { getDbPool } from '../../db/client.js';

const PROJ = '__test_d008__';
const PROFILE_TYPE = '__test_d008_profile_type';
const GLOBAL_TYPE = '__test_d008_global_type';
const NOSCOPE_TYPE = '__test_d008_noscope_type';

let tmpDir: string;

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM lesson_types WHERE type_key = ANY($1::text[])`,
    [[PROFILE_TYPE, GLOBAL_TYPE, NOSCOPE_TYPE]]);
  await pool.query(`DELETE FROM lessons WHERE project_id = $1`, [PROJ]);
  await pool.query(`DELETE FROM guardrails WHERE project_id = $1`, [PROJ]);
  await pool.query(`DELETE FROM projects WHERE project_id = $1`, [PROJ]);
}

before(() => { tmpDir = mkdtempSync(path.join(os.tmpdir(), 'd008-')); });
after(async () => { rmSync(tmpDir, { recursive: true, force: true }); await cleanup(); });
beforeEach(cleanup);

async function exportToFile(): Promise<string> {
  const file = path.join(tmpDir, `export-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
  const ws = createWriteStream(file);
  await exportProject({ projectId: PROJ }, ws);
  await once(ws, 'finish').catch(() => {}); // exportProject ends the stream
  return file;
}

async function encodeToFile(data: BundleData): Promise<string> {
  const file = path.join(tmpDir, `bundle-${Date.now()}-${Math.random().toString(36).slice(2)}.zip`);
  const chunks: Buffer[] = [];
  const sink = new PassThrough();
  sink.on('data', (c: Buffer) => chunks.push(c));
  const done = once(sink, 'end');
  await encodeBundle(data, sink);
  sink.end();
  await done;
  writeFileSync(file, Buffer.concat(chunks));
  return file;
}

test('DEFERRED-008 AC1: exportProject lesson_types JSONL carries scope', async () => {
  const pool = getDbPool();
  await pool.query(`INSERT INTO projects (project_id, name) VALUES ($1, 'D008')`, [PROJ]);
  await pool.query(
    `INSERT INTO lesson_types (type_key, display_name, scope, is_builtin) VALUES ($1, 'Profile Type', 'profile', false)`,
    [PROFILE_TYPE],
  );

  const file = await exportToFile();
  const reader = await openBundle(file);
  try {
    const rows: any[] = [];
    for await (const lt of reader.lesson_types()) rows.push(lt);
    const profileRow = rows.find((r) => r.type_key === PROFILE_TYPE);
    assert.ok(profileRow, 'exported bundle includes the profile type');
    assert.equal(profileRow.scope, 'profile', 'export SELECT carries scope (not dropped)');
  } finally {
    await reader.close();
  }
});

test('DEFERRED-008 AC4: a scope=profile type round-trips as profile (import create path)', async () => {
  const pool = getDbPool();
  // import a hand-built bundle whose lesson_types row carries scope='profile'
  const bundle = await encodeToFile({
    project: { project_id: PROJ, name: 'D008', description: null },
    lessons: [],
    guardrails: [],
    lesson_types: [
      { type_key: PROFILE_TYPE, display_name: 'Profile Type', description: null, color: '#888888', template: null, is_builtin: false, scope: 'profile', created_at: null },
    ],
  });
  const res = await importProject({ targetProjectId: PROJ, bundlePath: bundle, policy: 'overwrite' });
  assert.equal(res.counts.lesson_types.created, 1);

  const r = await pool.query<{ scope: string }>(`SELECT scope FROM lesson_types WHERE type_key=$1`, [PROFILE_TYPE]);
  assert.equal(r.rows[0].scope, 'profile', 'imported type preserves scope=profile (no silent global)');
});

test('DEFERRED-008 AC4: a scope=global type round-trips as global', async () => {
  const pool = getDbPool();
  const bundle = await encodeToFile({
    project: { project_id: PROJ, name: 'D008', description: null },
    lessons: [], guardrails: [],
    lesson_types: [
      { type_key: GLOBAL_TYPE, display_name: 'Global Type', description: null, color: '#888888', template: null, is_builtin: false, scope: 'global', created_at: null },
    ],
  });
  await importProject({ targetProjectId: PROJ, bundlePath: bundle, policy: 'overwrite' });
  const r = await pool.query<{ scope: string }>(`SELECT scope FROM lesson_types WHERE type_key=$1`, [GLOBAL_TYPE]);
  assert.equal(r.rows[0].scope, 'global');
});

test('DEFERRED-008 AC5: a pre-fix bundle row (no scope field) defaults to global', async () => {
  const pool = getDbPool();
  const bundle = await encodeToFile({
    project: { project_id: PROJ, name: 'D008', description: null },
    lessons: [], guardrails: [],
    lesson_types: [
      // NO `scope` field — simulates a bundle produced before the DEFERRED-008 fix
      { type_key: NOSCOPE_TYPE, display_name: 'Legacy Type', description: null, color: '#888888', template: null, is_builtin: false, created_at: null },
    ],
  });
  await importProject({ targetProjectId: PROJ, bundlePath: bundle, policy: 'overwrite' });
  const r = await pool.query<{ scope: string }>(`SELECT scope FROM lesson_types WHERE type_key=$1`, [NOSCOPE_TYPE]);
  assert.equal(r.rows[0].scope, 'global', 'pre-fix bundle defaults to global (no regression, no CHECK violation)');
});
