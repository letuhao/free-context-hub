import assert from 'node:assert/strict';
import test from 'node:test';

import { extractJsonObject, extractJsonArray } from './json.js';

test('extractJsonObject', async (t) => {
  await t.test('plain object', () => {
    assert.deepEqual(extractJsonObject('{"a":1}'), { a: 1 });
  });

  await t.test('object with surrounding prose', () => {
    assert.deepEqual(extractJsonObject('Here you go: {"a":1} done'), { a: 1 });
  });

  await t.test('fenced ```json block', () => {
    assert.deepEqual(extractJsonObject('```json\n{"a":1}\n```'), { a: 1 });
  });

  await t.test('multiple blocks → longest valid wins (reasoning model)', () => {
    assert.deepEqual(extractJsonObject('{"t":0} then final {"a":1,"b":2}'), { a: 1, b: 2 });
  });

  await t.test('braces inside string literals are ignored', () => {
    assert.deepEqual(extractJsonObject('{"a":"has } brace"}'), { a: 'has } brace' });
  });

  await t.test('nested object', () => {
    assert.deepEqual(extractJsonObject('{"a":{"b":1}}'), { a: { b: 1 } });
  });

  await t.test('throws when none', () => {
    assert.throws(() => extractJsonObject('no json here'), /No parseable JSON object/);
  });
});

test('extractJsonArray', async (t) => {
  await t.test('plain array', () => {
    assert.deepEqual(extractJsonArray('[1,2,3]'), [1, 2, 3]);
  });

  await t.test('array with prose', () => {
    assert.deepEqual(extractJsonArray('order: [2,1,3].'), [2, 1, 3]);
  });

  await t.test('fenced array', () => {
    assert.deepEqual(extractJsonArray('```json\n["a","b"]\n```'), ['a', 'b']);
  });

  await t.test('brackets in strings ignored', () => {
    assert.deepEqual(extractJsonArray('["x ] y","z"]'), ['x ] y', 'z']);
  });

  await t.test('throws when none', () => {
    assert.throws(() => extractJsonArray('nothing'), /No parseable JSON array/);
  });
});
