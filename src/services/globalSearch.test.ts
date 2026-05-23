/**
 * DEFERRED-026 — global search must include git_commits.
 *
 * Regression guard: globalSearch's commits query selected a non-existent column
 * (`author`; the table has `author_name`). The error was swallowed by the query's
 * .catch(), so the commits section silently returned empty while smoke tests stayed
 * green. This test seeds a commit and asserts it surfaces with a populated author.
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import { globalSearch } from './globalSearch.js';
import { getDbPool } from '../db/client.js';

const PROJ = '__test_d026__';
const SHA = 'd026cafe00000000000000000000000000000001';
const TOKEN = 'zzdeferred026token';

async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM git_commits WHERE project_id = $1`, [PROJ]);
  await pool.query(`DELETE FROM projects WHERE project_id = $1`, [PROJ]);
}

before(async () => {
  await cleanup();
  const pool = getDbPool();
  await pool.query(`INSERT INTO projects (project_id, name) VALUES ($1, 'D026')`, [PROJ]);
  await pool.query(
    `INSERT INTO git_commits (project_id, sha, author_name, author_email, committed_at, message)
     VALUES ($1, $2, 'Ada Lovelace', 'ada@example.com', now(), $3)`,
    [PROJ, SHA, `commit about ${TOKEN} feature`],
  );
});

after(cleanup);

test('DEFERRED-026: globalSearch returns matching commits with author populated', async () => {
  const res = await globalSearch({ projectId: PROJ, query: TOKEN });
  assert.equal(res.commits.length, 1, 'commit matching the query must appear (commits section not silently dropped)');
  const c = res.commits[0];
  assert.equal(c.sha, SHA);
  assert.equal(c.author, 'Ada Lovelace', 'author_name is aliased to author (column exists, query succeeds)');
  assert.ok(c.date, 'committed_at aliased to date');
  assert.ok(res.total_count >= 1);
});
