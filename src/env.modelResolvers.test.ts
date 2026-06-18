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
  resolveGenModel,
  migrateLegacyEnvKeys,
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
      resolveGenModel(e),
    ]);
    assert.equal(models.size, 1, 'every chat role must resolve to the same model');
  });
});

// MED-1: the env-fill makes CHAT_MODEL canonical for the PRODUCTION chat callers
// that read env.DISTILLATION_MODEL directly (chat.ts, distiller, vision, …).
test('migrateLegacyEnvKeys — CHAT_MODEL fills DISTILLATION_MODEL', async (t) => {
  await t.test('CHAT_MODEL set + DISTILLATION_MODEL unset → filled', () => {
    const out = migrateLegacyEnvKeys({ CHAT_MODEL: 'gemma-qat' } as NodeJS.ProcessEnv);
    assert.equal(out.DISTILLATION_MODEL, 'gemma-qat');
  });

  await t.test('explicit DISTILLATION_MODEL wins (deliberate worker override)', () => {
    const out = migrateLegacyEnvKeys(
      { CHAT_MODEL: 'gemma-qat', DISTILLATION_MODEL: 'other' } as NodeJS.ProcessEnv,
    );
    assert.equal(out.DISTILLATION_MODEL, 'other');
  });

  await t.test('explicit EMPTY DISTILLATION_MODEL preserved (.env.baseline disables worker)', () => {
    const out = migrateLegacyEnvKeys(
      { CHAT_MODEL: 'mistral-nemo', DISTILLATION_MODEL: '' } as NodeJS.ProcessEnv,
    );
    assert.equal(out.DISTILLATION_MODEL, '', 'empty string must NOT be overwritten');
  });

  await t.test('CHAT_MODEL unset → DISTILLATION_MODEL untouched (back-compat)', () => {
    const out = migrateLegacyEnvKeys({ DISTILLATION_MODEL: 'legacy' } as NodeJS.ProcessEnv);
    assert.equal(out.DISTILLATION_MODEL, 'legacy');
    assert.equal(out.CHAT_MODEL, undefined);
  });

  await t.test('blank CHAT_MODEL does not fill', () => {
    const out = migrateLegacyEnvKeys({ CHAT_MODEL: '   ' } as NodeJS.ProcessEnv);
    assert.equal(out.DISTILLATION_MODEL, undefined);
  });
});
