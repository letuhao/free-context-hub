import assert from 'node:assert/strict';
import test from 'node:test';

import { extractAnswerText, stripReasoningBlocks } from './extractAnswer.js';

test('stripReasoningBlocks', async (t) => {
  await t.test('removes a well-formed <think> pair', () => {
    assert.equal(stripReasoningBlocks('<think>plan plan</think>The answer.'), 'The answer.');
  });

  await t.test('removes pair in the middle, keeps surrounding text', () => {
    assert.equal(stripReasoningBlocks('A <think>x</think> B'), 'A  B');
  });

  await t.test('handles <reasoning> and <thinking> and attributes', () => {
    assert.equal(stripReasoningBlocks('<reasoning a="b">r</reasoning>ans'), 'ans');
    assert.equal(stripReasoningBlocks('<thinking>t</thinking>ans'), 'ans');
  });

  await t.test('case-insensitive', () => {
    assert.equal(stripReasoningBlocks('<THINK>x</THINK>ans'), 'ans');
  });

  await t.test('drops a dangling unclosed opener to end (truncated mid-thought)', () => {
    assert.equal(stripReasoningBlocks('answer so far <think>still reasoning when cut'), 'answer so far ');
    assert.equal(stripReasoningBlocks('<think>only reasoning, no answer'), '');
  });

  await t.test('multiple pairs', () => {
    assert.equal(stripReasoningBlocks('<think>a</think>X<think>b</think>Y'), 'XY');
  });

  await t.test('leaves normal text untouched', () => {
    assert.equal(stripReasoningBlocks('just a normal answer [1]'), 'just a normal answer [1]');
  });

  await t.test('empty / falsy', () => {
    assert.equal(stripReasoningBlocks(''), '');
  });
});

test('extractAnswerText', async (t) => {
  await t.test('plain content', () => {
    assert.equal(extractAnswerText({ content: 'hello' }), 'hello');
  });

  await t.test('strips reasoning from content', () => {
    assert.equal(extractAnswerText({ content: '<think>plan</think>final' }), 'final');
  });

  await t.test('content empty → falls back to reasoning_content', () => {
    assert.equal(extractAnswerText({ content: '', reasoning_content: 'recovered' }), 'recovered');
  });

  await t.test('content is pure reasoning → falls back to reasoning_content', () => {
    assert.equal(
      extractAnswerText({ content: '<think>only thinking, cut off', reasoning_content: 'fallback' }),
      'fallback',
    );
  });

  await t.test('real content wins over reasoning_content (never returns reasoning when answer exists)', () => {
    assert.equal(
      extractAnswerText({ content: 'the answer', reasoning_content: 'long internal trace' }),
      'the answer',
    );
  });

  await t.test('trims', () => {
    assert.equal(extractAnswerText({ content: '  spaced  ' }), 'spaced');
  });

  await t.test('null / undefined / non-string content → empty', () => {
    assert.equal(extractAnswerText(null), '');
    assert.equal(extractAnswerText(undefined), '');
    assert.equal(extractAnswerText({ content: 123 as unknown as string }), '');
    assert.equal(extractAnswerText({}), '');
  });

  await t.test('both empty → empty string (caller decides if error)', () => {
    assert.equal(extractAnswerText({ content: '', reasoning_content: '' }), '');
  });
});
