import assert from 'node:assert/strict';
import test from 'node:test';

import { chatComplete } from './chatComplete.js';

type Captured = { url: string; body: any; headers: any };

function fakeFetch(message: Record<string, unknown>, opts?: { status?: number; capture?: Captured }) {
  return (async (url: string, init: any) => {
    if (opts?.capture) {
      opts.capture.url = url;
      opts.capture.body = JSON.parse(init.body);
      opts.capture.headers = init.headers;
    }
    const status = opts?.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => ({ choices: [{ message, finish_reason: 'stop' }], usage: { prompt_tokens: 1 } }),
      text: async () => 'err body',
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

test('chatComplete', async (t) => {
  await t.test('returns clean extracted answer (strips reasoning)', async () => {
    const r = await chatComplete({
      baseUrl: 'http://x:1234',
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: fakeFetch({ content: '<think>plan</think>answer' }),
    });
    assert.equal(r.content, 'answer');
    assert.equal(r.finish_reason, 'stop');
  });

  await t.test('injects reasoning suppression by default', async () => {
    const cap = {} as Captured;
    await chatComplete({
      baseUrl: 'http://x:1234',
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: fakeFetch({ content: 'a' }, { capture: cap }),
    });
    assert.equal(cap.body.reasoning_effort, 'none');
    assert.deepEqual(cap.body.chat_template_kwargs, { enable_thinking: false });
  });

  await t.test('suppressReasoning:false omits the knobs', async () => {
    const cap = {} as Captured;
    await chatComplete({
      baseUrl: 'http://x:1234',
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      suppressReasoning: false,
      fetchImpl: fakeFetch({ content: 'a' }, { capture: cap }),
    });
    assert.equal(cap.body.reasoning_effort, undefined);
    assert.equal(cap.body.chat_template_kwargs, undefined);
  });

  await t.test('LLM_REASONING_SUPPRESS=off disables globally (no explicit param)', async () => {
    const prev = process.env.LLM_REASONING_SUPPRESS;
    process.env.LLM_REASONING_SUPPRESS = 'off';
    try {
      const cap = {} as Captured;
      await chatComplete({
        baseUrl: 'http://x:1234', model: 'm', messages: [{ role: 'user', content: 'hi' }],
        fetchImpl: fakeFetch({ content: 'a' }, { capture: cap }),
      });
      assert.equal(cap.body.reasoning_effort, undefined);
      assert.equal(cap.body.chat_template_kwargs, undefined);
    } finally {
      if (prev === undefined) delete process.env.LLM_REASONING_SUPPRESS;
      else process.env.LLM_REASONING_SUPPRESS = prev;
    }
  });

  await t.test('explicit suppressReasoning:true overrides env off-switch', async () => {
    const prev = process.env.LLM_REASONING_SUPPRESS;
    process.env.LLM_REASONING_SUPPRESS = 'off';
    try {
      const cap = {} as Captured;
      await chatComplete({
        baseUrl: 'http://x:1234', model: 'm', messages: [{ role: 'user', content: 'hi' }],
        suppressReasoning: true,
        fetchImpl: fakeFetch({ content: 'a' }, { capture: cap }),
      });
      assert.equal(cap.body.reasoning_effort, 'none');
    } finally {
      if (prev === undefined) delete process.env.LLM_REASONING_SUPPRESS;
      else process.env.LLM_REASONING_SUPPRESS = prev;
    }
  });

  await t.test('extraBody chat_template_kwargs is deep-merged (keeps enable_thinking)', async () => {
    const cap = {} as Captured;
    await chatComplete({
      baseUrl: 'http://x:1234', model: 'm', messages: [{ role: 'user', content: 'hi' }],
      extraBody: { chat_template_kwargs: { foo: 'bar' } },
      fetchImpl: fakeFetch({ content: 'a' }, { capture: cap }),
    });
    assert.deepEqual(cap.body.chat_template_kwargs, { enable_thinking: false, foo: 'bar' });
  });

  await t.test('builds /v1/chat/completions URL, handles trailing slash and /v1 suffix', async () => {
    for (const [base, want] of [
      ['http://x:1234', 'http://x:1234/v1/chat/completions'],
      ['http://x:1234/', 'http://x:1234/v1/chat/completions'],
      ['http://x:1234/v1', 'http://x:1234/v1/chat/completions'],
    ] as const) {
      const cap = {} as Captured;
      await chatComplete({
        baseUrl: base, model: 'm', messages: [{ role: 'user', content: 'hi' }],
        fetchImpl: fakeFetch({ content: 'a' }, { capture: cap }),
      });
      assert.equal(cap.url, want);
    }
  });

  await t.test('sets Authorization only when apiKey present', async () => {
    const cap = {} as Captured;
    await chatComplete({
      baseUrl: 'http://x:1234', model: 'm', apiKey: 'sk-1',
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: fakeFetch({ content: 'a' }, { capture: cap }),
    });
    assert.equal(cap.headers.Authorization, 'Bearer sk-1');
  });

  await t.test('passes temperature/seed/max_tokens + extraBody, extraBody can override', async () => {
    const cap = {} as Captured;
    await chatComplete({
      baseUrl: 'http://x:1234', model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
      temperature: 0.2, seed: 42, maxTokens: 600,
      extraBody: { response_format: { type: 'json_object' }, reasoning_effort: 'low' },
      fetchImpl: fakeFetch({ content: 'a' }, { capture: cap }),
    });
    assert.equal(cap.body.temperature, 0.2);
    assert.equal(cap.body.seed, 42);
    assert.equal(cap.body.max_tokens, 600);
    assert.deepEqual(cap.body.response_format, { type: 'json_object' });
    assert.equal(cap.body.reasoning_effort, 'low'); // extraBody merged last
  });

  await t.test('throws with status on non-2xx', async () => {
    await assert.rejects(
      chatComplete({
        baseUrl: 'http://x:1234', model: 'm', messages: [{ role: 'user', content: 'hi' }],
        fetchImpl: fakeFetch({}, { status: 500 }),
      }),
      /chat HTTP 500/,
    );
  });

  await t.test('multimodal content array passes through', async () => {
    const cap = {} as Captured;
    await chatComplete({
      baseUrl: 'http://x:1234', model: 'v',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'q' }, { type: 'image_url', image_url: { url: 'data:...' } }] }],
      fetchImpl: fakeFetch({ content: 'md' }, { capture: cap }),
    });
    assert.equal(cap.body.messages[0].content.length, 2);
    assert.equal(cap.body.messages[0].content[1].type, 'image_url');
  });
});
