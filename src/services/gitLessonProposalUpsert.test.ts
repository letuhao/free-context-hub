import assert from 'node:assert/strict';
import test from 'node:test';

import { upsertGitLessonProposalDraft } from './gitLessonProposalUpsert.js';

test('upsertGitLessonProposalDraft', async t => {
  await t.test('SQL includes ON CONFLICT (idempotent draft per commit)', async () => {
    const executedSql: string[] = [];
    const stableId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const pool = {
      async query(sql: string, _args: unknown[]) {
        executedSql.push(sql);
        return { rows: [{ proposal_id: stableId }] };
      },
    };
    const input = {
      projectId: 'test-project',
      sourceCommitSha: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      lessonType: 'general_note',
      title: 'Draft title',
      content: 'Draft body',
      tags: ['phase5-git-intelligence'],
      sourceRefs: ['git:deadbeef'],
      rationale: 'test',
    };
    const id1 = await upsertGitLessonProposalDraft(pool, input);
    const id2 = await upsertGitLessonProposalDraft(pool, input);
    assert.equal(id1, stableId);
    assert.equal(id2, stableId);
    assert.ok(executedSql[0]?.includes('ON CONFLICT'), 'expected ON CONFLICT in upsert SQL');
    assert.ok(executedSql[0]?.includes('git_lesson_proposals'), 'expected target table');
    assert.equal(executedSql.length, 2);
  });
});
