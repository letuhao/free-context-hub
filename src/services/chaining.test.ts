/**
 * Phase 15 Sprint 15.7 — chaining helper unit tests.
 *
 * Pure-function tests for the chaining module: validateExecutionTask +
 * buildChainedTaskParams. emitChain is exercised end-to-end through
 * requests.test.ts and motions.test.ts because it requires a real DB
 * transaction.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  validateExecutionTask,
  buildChainedTaskParams,
  type ExecutionTaskBlob,
} from './chaining.js';

// ── validateExecutionTask ────────────────────────────────────────────────────

test('chaining.validate: null/undefined → null', () => {
  assert.equal(validateExecutionTask(null), null);
  assert.equal(validateExecutionTask(undefined), null);
});

test('chaining.validate: minimal valid blob → typed blob', () => {
  const r = validateExecutionTask({ title: 'hi' });
  assert.deepEqual(r, { title: 'hi' });
});

test('chaining.validate: full valid blob → typed blob', () => {
  const ok = {
    title: 'Custom',
    topology: 'sequential',
    slot: 'my-exec',
    kind: 'doc_review',
    depends_on: ['00000000-0000-0000-0000-000000000001'],
    raci: { responsible: 'alice' },
  };
  const r = validateExecutionTask(ok);
  assert.deepEqual(r, ok);
});

test('chaining.validate: non-object blob → BAD_REQUEST', () => {
  assert.throws(() => validateExecutionTask(42), /execution_task must be an object/);
  assert.throws(() => validateExecutionTask('x'), /execution_task must be an object/);
  assert.throws(() => validateExecutionTask([]), /execution_task must be an object/);
});

test('chaining.validate: bad topology → BAD_REQUEST', () => {
  assert.throws(
    () => validateExecutionTask({ topology: 'bogus' }),
    /topology must be one of/,
  );
});

test('chaining.validate: title > 512 chars → BAD_REQUEST', () => {
  const long = 'a'.repeat(513);
  assert.throws(() => validateExecutionTask({ title: long }), /title must be at most/);
});

test('chaining.validate: slot regex violation → BAD_REQUEST', () => {
  assert.throws(
    () => validateExecutionTask({ slot: 'BAD-SLOT' }),
    /slot must be a lowercase-kebab/,
  );
});

test('chaining.validate: slot > 64 chars → BAD_REQUEST', () => {
  const long = 'a'.repeat(65); // valid regex chars, but too long
  assert.throws(() => validateExecutionTask({ slot: long }), /slot must be at most 64 characters/);
});

test('chaining.validate: empty kind → BAD_REQUEST', () => {
  assert.throws(() => validateExecutionTask({ kind: '' }), /kind must be a non-empty/);
  assert.throws(() => validateExecutionTask({ kind: '   ' }), /kind must be a non-empty/);
});

test('chaining.validate: kind > 64 chars → BAD_REQUEST', () => {
  const long = 'a'.repeat(65);
  assert.throws(() => validateExecutionTask({ kind: long }), /kind must be at most/);
});

test('chaining.validate: depends_on non-UUID → BAD_REQUEST', () => {
  assert.throws(
    () => validateExecutionTask({ depends_on: ['not-a-uuid'] }),
    /depends_on entries must be task UUIDs/,
  );
});

test('chaining.validate: depends_on > 32 entries → BAD_REQUEST', () => {
  const ids = Array.from({ length: 33 }, (_, i) => `00000000-0000-0000-0000-0000000000${(i % 100).toString().padStart(2, '0')}`);
  assert.throws(() => validateExecutionTask({ depends_on: ids }), /depends_on must have at most/);
});

test('chaining.validate: raci > 8 KB JSON → BAD_REQUEST', () => {
  const huge = { data: 'x'.repeat(8200) };
  assert.throws(() => validateExecutionTask({ raci: huge }), /raci must be at most 8192 bytes/);
});

test('chaining.validate: raci non-object → BAD_REQUEST', () => {
  assert.throws(() => validateExecutionTask({ raci: 'str' }), /raci must be an object/);
  assert.throws(() => validateExecutionTask({ raci: [] }), /raci must be an object/);
});

// ── buildChainedTaskParams ──────────────────────────────────────────────────

test('chaining.build: request, null blob → derived defaults', () => {
  const p = buildChainedTaskParams({
    source: 'request',
    source_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    topic_id: 'topic-1',
    kind: 'artifact_review',
    blob: null,
    acting_actor: 'alice',
  });
  assert.equal(p.title, 'Execute approved request: artifact_review');
  assert.equal(p.topology, 'parallel');
  assert.equal(p.slot, 'exec-aaaaaaaabbbbcccc');
  assert.equal(p.kind, 'artifact_review');
  assert.deepEqual(p.depends_on, []);
  assert.deepEqual(p.raci, { source_request: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
  assert.equal(p.created_by, 'alice');
});

test('chaining.build: motion, null blob → derived defaults', () => {
  const p = buildChainedTaskParams({
    source: 'motion',
    source_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    topic_id: 'topic-1',
    kind: 'policy_change',
    blob: null,
    acting_actor: 'system:tally',
  });
  assert.equal(p.title, 'Execute carried motion: policy_change');
  assert.equal(p.topology, 'parallel');
  assert.equal(p.slot, 'exec-aaaaaaaabbbbcccc');
  assert.deepEqual(p.raci, { source_motion: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
  assert.equal(p.created_by, 'system:tally');
});

test('chaining.build: blob overrides defaults (title, topology, slot, kind, depends_on)', () => {
  const blob: ExecutionTaskBlob = {
    title: 'Custom title',
    topology: 'sequential',
    slot: 'custom-slot',
    kind: 'custom-kind',
    depends_on: ['11111111-2222-3333-4444-555555555555'],
  };
  const p = buildChainedTaskParams({
    source: 'request',
    source_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    topic_id: 'topic-1',
    kind: 'default_kind',
    blob,
    acting_actor: 'alice',
  });
  assert.equal(p.title, 'Custom title');
  assert.equal(p.topology, 'sequential');
  assert.equal(p.slot, 'custom-slot');
  assert.equal(p.kind, 'custom-kind');
  assert.deepEqual(p.depends_on, ['11111111-2222-3333-4444-555555555555']);
});

test('chaining.build: blob raci merges with system source-link key (system wins)', () => {
  const blob: ExecutionTaskBlob = {
    raci: { responsible: 'alice', source_request: 'wrong-id' }, // try to clobber
  };
  const p = buildChainedTaskParams({
    source: 'request',
    source_id: 'real-id',
    topic_id: 'topic-1',
    kind: 'k',
    blob,
    acting_actor: 'alice',
  });
  assert.equal(p.raci.responsible, 'alice');
  assert.equal(p.raci.source_request, 'real-id'); // system key wins
});
