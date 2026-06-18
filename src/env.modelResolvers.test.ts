/**
 * Model-orchestration single-source-of-truth resolvers.
 *
 * These guard the invariant that fixed the LM Studio model-swap thrash: every
 * chat caller derives from ONE canonical model so LM Studio is never asked for
 * a second chat model. Regressions here re-introduce the swap.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveChatModel,
  resolveAnswererModel,
  resolveJudgeModel,
  resolveGenModel,
  type Env,
} from './env.js';

// Minimal Env stub — resolvers only read the model fields.
function env(over: Partial<Env>): Env {
  return over as Env;
}

test('model resolvers — single source of truth', async (t) => {
  await t.test('CHAT_MODEL is the canonical chat model', () => {
    assert.equal(resolveChatModel(env({ CHAT_MODEL: 'gemma-qat' })), 'gemma-qat');
  });

  await t.test('falls back to DISTILLATION_MODEL when CHAT_MODEL unset (back-compat)', () => {
    assert.equal(resolveChatModel(env({ DISTILLATION_MODEL: 'gemma-qat' })), 'gemma-qat');
  });

  await t.test('CHAT_MODEL wins over DISTILLATION_MODEL', () => {
    assert.equal(
      resolveChatModel(env({ CHAT_MODEL: 'a', DISTILLATION_MODEL: 'b' })),
      'a',
    );
  });

  await t.test('answerer defaults to the chat model (no divergent hardcode)', () => {
    assert.equal(resolveAnswererModel(env({ CHAT_MODEL: 'gemma-qat' })), 'gemma-qat');
  });

  await t.test('answerer honors its explicit override', () => {
    assert.equal(
      resolveAnswererModel(env({ CHAT_MODEL: 'gemma-qat', ANSWERER_AGENT_MODEL: 'mistral' })),
      'mistral',
    );
  });

  await t.test('judge defaults to the chat model → SHARES the loaded instance (no swap)', () => {
    assert.equal(resolveJudgeModel(env({ CHAT_MODEL: 'gemma-qat' })), 'gemma-qat');
  });

  await t.test('judge honors its explicit override (deliberate cross-judge run)', () => {
    assert.equal(
      resolveJudgeModel(env({ CHAT_MODEL: 'gemma-qat', JUDGE_AGENT_MODEL: 'mistral' })),
      'mistral',
    );
  });

  await t.test('gen scripts default to the chat model', () => {
    const prev = process.env.GEN_MODEL;
    delete process.env.GEN_MODEL;
    try {
      assert.equal(resolveGenModel(env({ CHAT_MODEL: 'gemma-qat' })), 'gemma-qat');
    } finally {
      if (prev !== undefined) process.env.GEN_MODEL = prev;
    }
  });

  await t.test('all chat roles resolve to ONE model when only CHAT_MODEL is set', () => {
    const e = env({ CHAT_MODEL: 'gemma-qat' });
    const models = new Set([
      resolveChatModel(e),
      resolveAnswererModel(e),
      resolveJudgeModel(e),
    ]);
    assert.equal(models.size, 1, 'every chat role must resolve to the same model');
  });
});
