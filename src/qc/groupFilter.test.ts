import assert from 'node:assert/strict';
import test from 'node:test';

import { filterQueriesByGroup, parseGroupsArg } from './groupFilter.js';

const Q = (id: string, group?: string) => ({ id, group });

test('filterQueriesByGroup', async (t) => {
  const rows = [
    Q('a', 'edge-no-answer'),
    Q('b', 'edge-multi-hop'),
    Q('c', 'confident-hit'),
    Q('d', 'edge-distractor'),
    Q('e'), // no group
  ];

  await t.test('null patterns → all (copy, not same ref)', () => {
    const out = filterQueriesByGroup(rows, null);
    assert.equal(out.length, rows.length);
    assert.notEqual(out, rows);
  });

  await t.test('undefined patterns → all', () => {
    assert.equal(filterQueriesByGroup(rows, undefined).length, rows.length);
  });

  await t.test('empty array → all (no filter)', () => {
    assert.equal(filterQueriesByGroup(rows, []).length, rows.length);
  });

  await t.test('all-blank patterns → all (no silent empty)', () => {
    assert.equal(filterQueriesByGroup(rows, ['', '  ']).length, rows.length);
  });

  await t.test('exact group match', () => {
    const out = filterQueriesByGroup(rows, ['confident-hit']);
    assert.deepEqual(out.map((r) => r.id), ['c']);
  });

  await t.test('prefix wildcard matches all edge-* groups', () => {
    const out = filterQueriesByGroup(rows, ['edge-*']);
    assert.deepEqual(out.map((r) => r.id), ['a', 'b', 'd']);
  });

  await t.test('mixed exact + prefix, deduped by single pass (no double-include)', () => {
    const out = filterQueriesByGroup(rows, ['edge-*', 'edge-no-answer', 'confident-hit']);
    assert.deepEqual(out.map((r) => r.id), ['a', 'b', 'c', 'd']);
  });

  await t.test('rows without a group are excluded when filtering', () => {
    const out = filterQueriesByGroup(rows, ['edge-*']);
    assert.ok(!out.some((r) => r.id === 'e'));
  });

  await t.test('case-sensitive (group names are lowercase-kebab)', () => {
    assert.equal(filterQueriesByGroup(rows, ['Edge-*']).length, 0);
    assert.equal(filterQueriesByGroup(rows, ['CONFIDENT-HIT']).length, 0);
  });

  await t.test('non-matching pattern → empty (visible, not all)', () => {
    assert.equal(filterQueriesByGroup(rows, ['does-not-exist']).length, 0);
  });
});

test('parseGroupsArg', async (t) => {
  await t.test('absent flag → null (no filter)', () => {
    assert.equal(parseGroupsArg(undefined), null);
  });

  await t.test('empty / whitespace string → null', () => {
    assert.equal(parseGroupsArg(''), null);
    assert.equal(parseGroupsArg('  '), null);
  });

  await t.test('comma list trimmed + blanks dropped', () => {
    assert.deepEqual(parseGroupsArg('edge-*, confident-hit ,'), ['edge-*', 'confident-hit']);
  });

  await t.test('single value', () => {
    assert.deepEqual(parseGroupsArg('edge-no-answer'), ['edge-no-answer']);
  });
});
