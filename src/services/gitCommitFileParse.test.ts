import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { parseCommitFilesFromOutputs } from './gitCommitFileParse.js';

test('parseCommitFilesFromOutputs', async t => {
  await t.test('keeps deleted file path even when file does not exist on disk', async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'git-parse-'));
    try {
      // Regression: D lines were dropped because fast-glob onlyFiles matched nothing for removed paths.
      const nameStatus = 'D\tsrc/deleted-only.ts\n';
      const numstat = '-\t-\tsrc/deleted-only.ts\n';
      const rows = await parseCommitFilesFromOutputs(root, nameStatus, numstat, []);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]?.change_kind, 'D');
      assert.equal(rows[0]?.file_path, 'src/deleted-only.ts');
      assert.equal(rows[0]?.additions, null);
      assert.equal(rows[0]?.deletions, null);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
