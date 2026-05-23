/**
 * Phase 16 Sprint 16.1 — validateGoldenQuery + validateShipReadiness invariants.
 * Enforces DESIGN §2.2 (rules R1-R5 in validateGoldenQuery, R7 in validateShipReadiness).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  validateGoldenQuery,
  validateShipReadiness,
  NO_ANSWER_PREFIX,
  type GoldenQuery,
} from './goldenTypes.js';

function baseRow(): GoldenQuery {
  return {
    id: 'q-1',
    group: 'test',
    query: 'How does X work?',
    target_files: ['src/foo.ts'],
  };
}

test('validateGoldenQuery', async (t) => {
  await t.test('retrieval-only row (no ideal_answer) passes — gen fields skipped', () => {
    assert.deepEqual(validateGoldenQuery(baseRow()), []);
  });

  await t.test('valid standard row passes all rules', () => {
    const row: GoldenQuery = {
      ...baseRow(),
      ideal_answer: 'X works by doing A then B.',
      must_contain_facts: ['A happens', 'B happens after A'],
      answer_style: 'concise',
      answer_category: 'standard',
      drafted_by: 'llm',
      drafted_at: '2026-05-24T00:00:00Z',
    };
    assert.deepEqual(validateGoldenQuery(row), []);
  });

  await t.test('R1 — ideal_answer without answer_category', () => {
    const row: GoldenQuery = {
      ...baseRow(),
      ideal_answer: 'X works.',
      must_contain_facts: ['something'],
      drafted_by: 'llm',
    };
    const errors = validateGoldenQuery(row);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].rule, 'R1');
    assert.equal(errors[0].field, 'answer_category');
  });

  await t.test('R2 — standard category requires ≥1 must_contain_facts', () => {
    const row: GoldenQuery = {
      ...baseRow(),
      ideal_answer: 'X works.',
      must_contain_facts: [],
      answer_category: 'standard',
      drafted_by: 'llm',
    };
    const errors = validateGoldenQuery(row);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].rule, 'R2');
  });

  await t.test('R3 — no_answer requires [NO_ANSWER] prefix', () => {
    const row: GoldenQuery = {
      ...baseRow(),
      ideal_answer: 'There is no such endpoint.', // missing prefix
      answer_category: 'no_answer',
      drafted_by: 'human',
    };
    const errors = validateGoldenQuery(row);
    const r3 = errors.find((e) => e.rule === 'R3');
    assert.ok(r3, 'expected R3 violation');
    assert.match(r3!.message, new RegExp(NO_ANSWER_PREFIX.replace(/[[\]]/g, '\\$&')));
  });

  await t.test('R4 — no_answer forbids must_contain_facts', () => {
    const row: GoldenQuery = {
      ...baseRow(),
      ideal_answer: `${NO_ANSWER_PREFIX} No such endpoint exists.`,
      must_contain_facts: ['ghost fact'], // forbidden
      answer_category: 'no_answer',
      drafted_by: 'human',
    };
    const errors = validateGoldenQuery(row);
    const r4 = errors.find((e) => e.rule === 'R4');
    assert.ok(r4, 'expected R4 violation');
  });

  await t.test('valid no_answer row passes (prefix + empty facts)', () => {
    const row: GoldenQuery = {
      ...baseRow(),
      ideal_answer: `${NO_ANSWER_PREFIX} No such endpoint exists in the codebase.`,
      must_contain_facts: [],
      answer_category: 'no_answer',
      drafted_by: 'human',
      drafted_at: '2026-05-24T00:00:00Z',
      reviewed_by: 'letuhao1994@gmail.com',
    };
    assert.deepEqual(validateGoldenQuery(row), []);
  });

  await t.test('R5 — ideal_answer requires drafted_by', () => {
    const row: GoldenQuery = {
      ...baseRow(),
      ideal_answer: 'X works.',
      must_contain_facts: ['something'],
      answer_category: 'standard',
      // missing drafted_by
    };
    const errors = validateGoldenQuery(row);
    const r5 = errors.find((e) => e.rule === 'R5');
    assert.ok(r5, 'expected R5 violation');
  });
});

test('validateShipReadiness (R7)', async (t) => {
  await t.test('llm-drafted row without reviewed_by fails ship-readiness', () => {
    const row: GoldenQuery = {
      ...baseRow(),
      ideal_answer: 'X works.',
      must_contain_facts: ['something'],
      answer_category: 'standard',
      drafted_by: 'llm',
      // missing reviewed_by
    };
    const errors = validateShipReadiness(row);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].rule, 'R7');
  });

  await t.test('llm-drafted row WITH reviewed_by passes', () => {
    const row: GoldenQuery = {
      ...baseRow(),
      ideal_answer: 'X works.',
      must_contain_facts: ['something'],
      answer_category: 'standard',
      drafted_by: 'llm',
      reviewed_by: 'letuhao1994@gmail.com',
    };
    assert.deepEqual(validateShipReadiness(row), []);
  });

  await t.test('human-drafted row without reviewed_by passes (human IS reviewer)', () => {
    const row: GoldenQuery = {
      ...baseRow(),
      ideal_answer: 'X works.',
      must_contain_facts: ['something'],
      answer_category: 'multi_hop',
      drafted_by: 'human',
    };
    assert.deepEqual(validateShipReadiness(row), []);
  });

  await t.test('retrieval-only row (no ideal_answer) trivially ship-ready', () => {
    assert.deepEqual(validateShipReadiness(baseRow()), []);
  });
});
