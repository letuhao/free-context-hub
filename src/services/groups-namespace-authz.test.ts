/**
 * Actor Data Boundary F2g / DEFERRED-049 — the group namespace split (B2) + resolveProjectIds self-defense
 * (A2) + listGroups member_count redaction.
 *
 * B2 makes `group` its own scope level: a `project` grant no longer covers a same-named group's TOPOLOGY,
 * createGroup refuses to take over a non-group project row, and the lessons-read surface allows EITHER a
 * project OR a group read grant (a group_id doubles as a lessons partition). These tests pin all of it.
 */

import assert from 'node:assert/strict';
import test, { before, after } from 'node:test';
import {
  createGroup, createProject, resolveProjectIds, listGroups, canReadLessonsPartition, listAllProjects,
} from './projectGroups.js';
import { searchLessonsMulti } from './lessons.js';
import { createPrincipal, getRootPrincipal } from './principals.js';
import { createGrant, listGrants } from './grants.js';
import { grantCapability } from './grantCapability.js';
import { ContextHubError } from '../core/errors.js';
import { getDbPool } from '../db/client.js';

const PREFIX = '__test_ns049__';
const ENTRY = `${PREFIX}entry`;       // a member project the caller owns
const REALPROJ = `${PREFIX}realproj`; // a NON-group project (the collision victim)
const REALPROJ_NAME = 'Real Project Name';
const GR = `${PREFIX}grp`;            // a group (projects row + project_groups row)
const NEWGRP = `${PREFIX}newgrp`;     // a not-yet-existent group (createGroup success)

const isBadRequest = (e: unknown) => e instanceof ContextHubError && e.code === 'BAD_REQUEST';
const isNotFound = (e: unknown) => e instanceof ContextHubError && e.code === 'NOT_FOUND';

let mutator: string;     // write@group {GR,NEWGRP,REALPROJ} + write@project GR
let entryReader: string; // read@project ENTRY + read@group GR  → resolveProjectIds = [ENTRY, GR]
let entryOnly: string;   // read@project ENTRY only             → resolveProjectIds = [ENTRY]
let groupReader: string; // read@group GR
let projReader: string;  // read@project GR (legacy project grant on a group id)
let fakeGroupReader: string; // read@group REALPROJ (a plain project, NOT a group) — must NOT leak
let delGroup: string;    // delegate@group GR + read@group GR  → CAN grant read@group GR
let delProject: string;  // delegate@project GR + read@project GR → must NOT grant read@group GR
let grantee: string;     // receives delegated grants
let outsider: string;    // no grants
let grantor: string;
const saved = { auth: process.env.MCP_AUTH_ENABLED, emb: process.env.EMBEDDINGS_BASE_URL };

async function setAuth(on: boolean) {
  process.env.MCP_AUTH_ENABLED = on ? 'true' : 'false';
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
}
async function cleanup() {
  const pool = getDbPool();
  await pool.query(`DELETE FROM project_group_members WHERE group_id LIKE $1 OR project_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM project_groups WHERE group_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM lessons WHERE project_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(`DELETE FROM projects WHERE project_id LIKE $1`, [`${PREFIX}%`]);
  await pool.query(
    `DELETE FROM grants WHERE grantee_principal IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)
        OR granted_by IN (SELECT principal_id FROM principals WHERE display_name LIKE $1)`,
    [`${PREFIX}%`],
  );
  await pool.query(`DELETE FROM principals WHERE display_name LIKE $1`, [`${PREFIX}%`]);
}

before(async () => {
  await cleanup();
  const pool = getDbPool();
  // Seed rows directly (deterministic, no auth in setup).
  await pool.query(`INSERT INTO projects (project_id, name) VALUES ($1,$1)`, [ENTRY]);
  await pool.query(`INSERT INTO projects (project_id, name) VALUES ($1,$2)`, [REALPROJ, REALPROJ_NAME]);
  await pool.query(`INSERT INTO projects (project_id, name) VALUES ($1,$1)`, [GR]);
  await pool.query(`INSERT INTO project_groups (group_id, name) VALUES ($1,$1)`, [GR]);
  await pool.query(`INSERT INTO project_group_members (group_id, project_id) VALUES ($1,$2)`, [GR, ENTRY]);

  const mk = async (n: string) => (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}${n}` })).principal_id;
  grantor = await mk('grantor');
  mutator = await mk('mutator');
  entryReader = await mk('entryReader');
  entryOnly = await mk('entryOnly');
  groupReader = await mk('groupReader');
  projReader = await mk('projReader');
  fakeGroupReader = await mk('fakeGroupReader');
  delGroup = await mk('delGroup');
  delProject = await mk('delProject');
  grantee = await mk('grantee');
  outsider = await mk('outsider');
  const g = (grantee: string, scope_type: 'project' | 'group', scope_id: string, capability: 'read' | 'write') =>
    createGrant({ grantee_principal: grantee, scope_type, scope_id, capability, granted_by: grantor });
  await g(mutator, 'group', GR, 'write');
  await g(mutator, 'group', NEWGRP, 'write');
  await g(mutator, 'group', REALPROJ, 'write'); // group-write on an id that is actually a project → reaches collision-reject
  await g(mutator, 'project', GR, 'write');      // for createProject-on-group-id test
  await g(entryReader, 'project', ENTRY, 'read');
  await g(entryReader, 'group', GR, 'read');
  await g(entryOnly, 'project', ENTRY, 'read');
  await g(groupReader, 'group', GR, 'read');
  await g(projReader, 'project', GR, 'read');
  await g(fakeGroupReader, 'group', REALPROJ, 'read'); // read@group on a PLAIN project id (REALPROJ is not a group)
  // delegation-invariant fixtures: delGroup holds delegate+read in the GROUP namespace; delProject holds
  // them in the PROJECT namespace (must NOT reach a group target).
  await createGrant({ grantee_principal: delGroup, scope_type: 'group', scope_id: GR, capability: 'delegate', granted_by: grantor });
  await createGrant({ grantee_principal: delGroup, scope_type: 'group', scope_id: GR, capability: 'read', granted_by: grantor });
  await createGrant({ grantee_principal: delProject, scope_type: 'project', scope_id: GR, capability: 'delegate', granted_by: grantor });
  await createGrant({ grantee_principal: delProject, scope_type: 'project', scope_id: GR, capability: 'read', granted_by: grantor });

  // Closed embeddings port → searchLessonsMulti falls back to FTS-only, so the positive union case
  // doesn't depend on a live embedder.
  process.env.EMBEDDINGS_BASE_URL = 'http://127.0.0.1:1';
  await setAuth(true);
});
after(async () => {
  await cleanup();
  if (saved.auth === undefined) delete process.env.MCP_AUTH_ENABLED; else process.env.MCP_AUTH_ENABLED = saved.auth;
  if (saved.emb === undefined) delete process.env.EMBEDDINGS_BASE_URL; else process.env.EMBEDDINGS_BASE_URL = saved.emb;
  const { _resetEnvCacheForTest } = await import('../env.js');
  _resetEnvCacheForTest();
});

// ── B1: createGroup collision-reject ──────────────────────────────────────────
test('createGroup on an existing NON-group project → BAD_REQUEST, victim name unchanged', async () => {
  await assert.rejects(createGroup({ group_id: REALPROJ, name: 'Hijacked', actingPrincipalId: mutator }), isBadRequest);
  const row = await getDbPool().query(`SELECT name FROM projects WHERE project_id=$1`, [REALPROJ]);
  assert.equal(row.rows[0].name, REALPROJ_NAME, 'a rejected createGroup must NOT rename the victim project');
});

test('createGroup idempotent-update of an existing group still works', async () => {
  const res = await createGroup({ group_id: GR, name: 'Renamed Group', actingPrincipalId: mutator });
  assert.equal(res.group_id, GR);
});

test('createProject on an existing group id → BAD_REQUEST (already exists)', async () => {
  await assert.rejects(createProject({ project_id: GR, actingPrincipalId: mutator, name: 'x' }), isBadRequest);
});

// ── A2: resolveProjectIds self-defends ────────────────────────────────────────
test('resolveProjectIds: read on entry + read@group → [entry, group]', async () => {
  const ids = await resolveProjectIds(ENTRY, true, entryReader);
  assert.deepEqual(ids, [ENTRY, GR]);
});

test('resolveProjectIds: read on entry only (no group authority) → [entry], foreign group dropped', async () => {
  const ids = await resolveProjectIds(ENTRY, true, entryOnly);
  assert.deepEqual(ids, [ENTRY]);
});

test('resolveProjectIds: no read on the entry project → throws (NOT_FOUND)', async () => {
  await assert.rejects(resolveProjectIds(ENTRY, true, outsider), isNotFound);
});

// ── the lessons-read UNION: read@group OR read@project covers a group's lessons ─
test('canReadLessonsPartition: read@group OR read@project both grant a group id; outsider denied', async () => {
  assert.equal(await canReadLessonsPartition(groupReader, GR), true);  // via group
  assert.equal(await canReadLessonsPartition(projReader, GR), true);   // via legacy project grant
  assert.equal(await canReadLessonsPartition(outsider, GR), false);
});

// [adv REVIEW-CODE #1] a read@group grant on a PLAIN PROJECT id must NOT leak that project's lessons —
// the group arm only fires for a real group row (resolveResourceScope trusts group ids w/o existence check).
test('canReadLessonsPartition: read@group on a NON-group project id does NOT grant it (no namespace collapse)', async () => {
  assert.equal(await canReadLessonsPartition(fakeGroupReader, REALPROJ), false);
});

test('searchLessonsMulti: a read@group grant passes authz for a group id; an outsider gets NOT_FOUND', async () => {
  // outsider: authz denies the only id → NOT_FOUND (before any query).
  await assert.rejects(searchLessonsMulti({ projectIds: [GR], actingPrincipalId: outsider, query: 'anything' }), isNotFound);
  // groupReader: authz passes (group grant) → resolves to a result (FTS-only, empty), NOT a NOT_FOUND.
  const r = await searchLessonsMulti({ projectIds: [GR], actingPrincipalId: groupReader, query: 'anything' });
  assert.ok(Array.isArray(r.matches));
});

// ── sub-issue 0: listGroups redacts member_count for non-grant callers ─────────
// [Domain 8 / adversary] listAllProjects must NOT enumerate every tenant — it filters to projects the
// caller can read (per-row, not throw). entryReader has read@project ENTRY only.
test('listAllProjects: filters to caller-readable projects (no cross-tenant enumeration)', async () => {
  const visibleToReader = (await listAllProjects(entryReader)).map((p) => p.project_id);
  assert.ok(visibleToReader.includes(ENTRY), 'reader sees its own project');
  assert.ok(!visibleToReader.includes(REALPROJ), 'reader does NOT see a project it cannot read');
  // outsider sees none of THIS suite's projects.
  const visibleToOutsider = (await listAllProjects(outsider)).map((p) => p.project_id);
  for (const pid of [ENTRY, REALPROJ, GR]) {
    assert.ok(!visibleToOutsider.includes(pid), `outsider must not see ${pid}`);
  }
});

test('listGroups: member_count is a number for a read@group caller, NULL for a non-grant caller; name always present', async () => {
  const asReader = (await listGroups(groupReader)).find((g) => g.group_id === GR);
  assert.ok(asReader, 'group must be listed for the reader');
  assert.equal(typeof asReader!.member_count, 'number');

  const asOutsider = (await listGroups(outsider)).find((g) => g.group_id === GR);
  assert.ok(asOutsider, 'group NAME must still be listed (shared-pool catalog)');
  assert.equal(asOutsider!.member_count, null, 'member_count must be redacted for a non-grant caller');
});

// ── [review-impl #3] grant_capability flows through the GROUP namespace + respects the split ──
test('grantCapability: a delegate@group + read@group caller CAN grant read@group; a project-delegate CANNOT', async () => {
  const granted = await grantCapability({
    callerPrincipalId: delGroup, grantee_principal: grantee, scope_type: 'group', scope_id: GR, capability: 'read',
  });
  assert.equal(granted.scope_type, 'group');
  assert.equal(granted.scope_id, GR);
  assert.equal(granted.capability, 'read');

  // a PROJECT delegate must NOT be able to mint a GROUP grant (no namespace conflation in delegation).
  const isForbidden = (e: unknown) => e instanceof ContextHubError && e.code === 'FORBIDDEN';
  await assert.rejects(
    grantCapability({ callerPrincipalId: delProject, grantee_principal: grantee, scope_type: 'group', scope_id: GR, capability: 'read' }),
    isForbidden,
  );
});

// ── [review-impl #3] the migration 0070 mirror logic: read/write/admin mirrored, delegate EXCLUDED,
//    granted_by re-attributed to the active root. Runs the exact backfill SELECT against seeded data
//    (covers the branch that was a no-op on this DB). ──
test('migration 0070 mirror: project grants on a group id mirror to group (read/write/admin), delegate excluded, granted_by=root', async () => {
  const pool = getDbPool();
  const root = await getRootPrincipal();
  if (!root) { return; } // root-free CI DB → graceful skip (mirror attributes to root)
  const MGRP = `${PREFIX}mirgrp`;
  const holder = (await createPrincipal({ kind: 'agent', display_name: `${PREFIX}mirholder` })).principal_id;
  await pool.query(`INSERT INTO projects (project_id, name) VALUES ($1,$1) ON CONFLICT DO NOTHING`, [MGRP]);
  await pool.query(`INSERT INTO project_groups (group_id, name) VALUES ($1,$1) ON CONFLICT DO NOTHING`, [MGRP]);
  // legacy project-scoped grants on the group id: read + delegate.
  await createGrant({ grantee_principal: holder, scope_type: 'project', scope_id: MGRP, capability: 'read', granted_by: grantor });
  await createGrant({ grantee_principal: holder, scope_type: 'project', scope_id: MGRP, capability: 'delegate', granted_by: grantor });

  // the exact backfill from migrations/0070_group_scope_type.sql.
  await pool.query(
    `INSERT INTO grants (grantee_principal, scope_type, scope_id, capability, granted_by)
     SELECT g.grantee_principal, 'group', g.scope_id, g.capability,
            COALESCE((SELECT principal_id FROM principals WHERE is_root = true AND status = 'active' LIMIT 1), g.granted_by)
       FROM grants g
      WHERE g.scope_type = 'project' AND g.revoked_at IS NULL
        AND g.capability <> 'delegate'
        AND EXISTS (SELECT 1 FROM project_groups pg WHERE pg.group_id = g.scope_id)
     ON CONFLICT (grantee_principal, scope_type, scope_id, capability) WHERE revoked_at IS NULL DO NOTHING`,
  );

  const mirrored = await listGrants({ grantee_principal: holder, scope_type: 'group', scope_id: MGRP });
  const caps = mirrored.map((m) => m.capability).sort();
  assert.deepEqual(caps, ['read'], 'only the resource capability is mirrored; delegate is excluded');
  assert.equal(mirrored[0].granted_by, root.principal_id, 'mirrored grant is attributed to the active root');
});
