/**
 * Actor Data Boundary F2b — the authorize() PURE core (no DB): capability lattice + scope coverage +
 * decide(). This is the chokepoint; these tests are the adversary's first target. See
 * docs/specs/2026-06-19-actor-data-boundary-F2-design.md §1–§3.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { capabilityCovers, scopeCovers, decide, type ResourceScope, type GrantLike } from './authorize.js';

// ── capability lattice: read ⊂ write ⊂ admin; delegate orthogonal ──────────────
test('capabilityCovers: read⊂write⊂admin for resource actions', () => {
  assert.equal(capabilityCovers('admin', 'read'), true);
  assert.equal(capabilityCovers('admin', 'write'), true);
  assert.equal(capabilityCovers('admin', 'admin'), true);
  assert.equal(capabilityCovers('write', 'read'), true);
  assert.equal(capabilityCovers('write', 'write'), true);
  assert.equal(capabilityCovers('write', 'admin'), false);
  assert.equal(capabilityCovers('read', 'read'), true);
  assert.equal(capabilityCovers('read', 'write'), false);
  assert.equal(capabilityCovers('read', 'admin'), false);
});

test('capabilityCovers: delegate is orthogonal — covers ONLY delegate, and nothing covers delegate but delegate', () => {
  // admin does NOT confer delegate (the delegation invariant requires an explicit delegate grant/root)
  assert.equal(capabilityCovers('admin', 'delegate'), false);
  assert.equal(capabilityCovers('write', 'delegate'), false);
  assert.equal(capabilityCovers('read', 'delegate'), false);
  // delegate covers ONLY delegate — never a resource action
  assert.equal(capabilityCovers('delegate', 'delegate'), true);
  assert.equal(capabilityCovers('delegate', 'read'), false);
  assert.equal(capabilityCovers('delegate', 'write'), false);
  assert.equal(capabilityCovers('delegate', 'admin'), false);
});

// ── scope coverage: global ⊃ project ⊃ topic ⊃ task ───────────────────────────
const G = (scope_type: GrantLike['scope_type'], scope_id: string | null): GrantLike =>
  ({ grant_id: `g-${scope_type}-${scope_id}`, scope_type, scope_id, capability: 'read' });

const proj: ResourceScope = { kind: 'project', project_id: 'P' };
const topic: ResourceScope = { kind: 'topic', project_id: 'P', topic_id: 'T' };
const task: ResourceScope = { kind: 'task', project_id: 'P', topic_id: 'T', task_id: 'K' };
const glob: ResourceScope = { kind: 'global' };

test('scopeCovers: global grant covers everything', () => {
  for (const r of [glob, proj, topic, task]) assert.equal(scopeCovers(G('global', null), r), true);
});

test('scopeCovers: project grant covers its project/topic/task, not global, not a sibling project', () => {
  assert.equal(scopeCovers(G('project', 'P'), proj), true);
  assert.equal(scopeCovers(G('project', 'P'), topic), true);
  assert.equal(scopeCovers(G('project', 'P'), task), true);
  assert.equal(scopeCovers(G('project', 'P'), glob), false);
  assert.equal(scopeCovers(G('project', 'OTHER'), task), false);
});

test('scopeCovers: topic grant covers its topic + that topic\'s tasks only', () => {
  assert.equal(scopeCovers(G('topic', 'T'), topic), true);
  assert.equal(scopeCovers(G('topic', 'T'), task), true);          // task K is under topic T
  assert.equal(scopeCovers(G('topic', 'T'), proj), false);         // can't cover up to project
  assert.equal(scopeCovers(G('topic', 'OTHER'), task), false);     // sibling topic's grant
  assert.equal(scopeCovers(G('topic', 'T'), glob), false);
});

test('scopeCovers: task grant covers only that exact task', () => {
  assert.equal(scopeCovers(G('task', 'K'), task), true);
  assert.equal(scopeCovers(G('task', 'K'), topic), false);
  assert.equal(scopeCovers(G('task', 'OTHER'), task), false);
});

// ── decide(): the ALLOW/DENY truth table ──────────────────────────────────────
const active = { is_root: false, status: 'active' as const };
const readGrantP: GrantLike = { grant_id: 'gp', scope_type: 'project', scope_id: 'P', capability: 'read' };

test('decide: null principal -> NO_PRINCIPAL', () => {
  assert.deepEqual(decide(null, 'read', proj, []), { allow: false, reason: 'NO_PRINCIPAL' });
});

test('decide: root short-circuits ALLOW even with zero grants', () => {
  assert.deepEqual(decide({ is_root: true, status: 'active' }, 'admin', glob, []), { allow: true, reason: 'ROOT' });
});

test('decide: status gate applies to NON-root only, AFTER the root check', () => {
  // a suspended non-root denies regardless of grants
  assert.deepEqual(
    decide({ is_root: false, status: 'suspended' }, 'read', proj, [readGrantP]),
    { allow: false, reason: 'PRINCIPAL_INACTIVE' },
  );
  // root is never gated by status (root status is axiomatically active anyway)
  assert.deepEqual(decide({ is_root: true, status: 'active' }, 'read', proj, []), { allow: true, reason: 'ROOT' });
});

test('decide: a covering grant -> ALLOW GRANT with matched id', () => {
  assert.deepEqual(decide(active, 'read', proj, [readGrantP]), { allow: true, reason: 'GRANT', matched_grant_id: 'gp' });
});

test('decide: grant present but capability too low -> NO_COVERING_GRANT', () => {
  assert.deepEqual(decide(active, 'write', proj, [readGrantP]), { allow: false, reason: 'NO_COVERING_GRANT' });
});

test('decide: grant present but scope does not cover -> NO_COVERING_GRANT', () => {
  const readGrantOther: GrantLike = { grant_id: 'go', scope_type: 'project', scope_id: 'OTHER', capability: 'read' };
  assert.deepEqual(decide(active, 'read', proj, [readGrantOther]), { allow: false, reason: 'NO_COVERING_GRANT' });
});

test('decide: delegate action needs a delegate grant — admin grant does NOT satisfy it', () => {
  const adminGlobal: GrantLike = { grant_id: 'ga', scope_type: 'global', scope_id: null, capability: 'admin' };
  assert.deepEqual(decide(active, 'delegate', proj, [adminGlobal]), { allow: false, reason: 'NO_COVERING_GRANT' });
  const delegProj: GrantLike = { grant_id: 'gd', scope_type: 'project', scope_id: 'P', capability: 'delegate' };
  assert.deepEqual(decide(active, 'delegate', task, [delegProj]), { allow: true, reason: 'GRANT', matched_grant_id: 'gd' });
});

test('decide: first covering grant wins (deterministic match)', () => {
  const g1: GrantLike = { grant_id: 'g1', scope_type: 'global', scope_id: null, capability: 'admin' };
  const g2: GrantLike = { grant_id: 'g2', scope_type: 'project', scope_id: 'P', capability: 'read' };
  const r = decide(active, 'read', task, [g1, g2]);
  assert.equal(r.allow, true);
  assert.equal((r as { matched_grant_id: string }).matched_grant_id, 'g1');
});
