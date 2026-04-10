/**
 * Layer 1 — MCP Tool Smoke Tests
 * Call every MCP tool once with minimal args, expect a non-error response.
 * Tools that require optional infrastructure (KG, distillation, git root) self-skip.
 */

import type { TestFn } from '../shared/testContext.js';
import { pass, fail, skip } from '../shared/testContext.js';
import { callTool, withAuth } from '../shared/mcpClient.js';
import { ADMIN_TOKEN } from '../shared/constants.js';

const GROUP = 'mcp-smoke';

/** Shared state for resources created during MCP smoke tests. */
const st: {
  lessonId?: string;
  groupId?: string;
} = {};

function mcpSmoke(
  name: string,
  toolName: string,
  argsFn: (ctx: any) => Record<string, unknown>,
  opts?: { skipIf?: (ctx: any) => string | null; onResult?: (ctx: any, result: any) => void },
): TestFn {
  return async (ctx) => {
    const start = Date.now();
    try {
      if (!ctx.mcp) return skip(name, GROUP, 'MCP client not connected');
      if (opts?.skipIf) {
        const reason = opts.skipIf(ctx);
        if (reason) return skip(name, GROUP, reason);
      }

      const args = withAuth(argsFn(ctx), ADMIN_TOKEN);
      const result = await callTool(ctx.mcp, toolName, args, 60_000);

      // Check for error in response
      if (result?.error && !result?.warning) {
        return fail(name, GROUP, Date.now() - start, `Tool returned error: ${result.error}`);
      }

      if (opts?.onResult) opts.onResult(ctx, result);
      return pass(name, GROUP, Date.now() - start);
    } catch (err: any) {
      return fail(name, GROUP, Date.now() - start, err?.message ?? String(err));
    }
  };
}

// ── Core Tools ───────────────────────────────────────────────────────────

const coreTests: TestFn[] = [
  mcpSmoke('help', 'help', () => ({})),

  mcpSmoke('get_context', 'get_context', (ctx) => ({
    project_id: ctx.projectId,
    task: 'smoke test',
  })),

  mcpSmoke('get_project_summary', 'get_project_summary', (ctx) => ({
    project_id: ctx.projectId,
  })),
];

// ── Lesson Tools ─────────────────────────────────────────────────────────

const lessonTests: TestFn[] = [
  mcpSmoke('add_lesson', 'add_lesson', (ctx) => ({
    lesson_payload: {
      project_id: ctx.projectId,
      lesson_type: 'decision',
      title: `MCP smoke test lesson ${ctx.runMarker}`,
      content: 'Created by MCP smoke test runner',
      tags: ['e2e-mcp-smoke'],
    },
  }), {
    onResult: (ctx, result) => {
      st.lessonId = result?.lesson_id;
      if (st.lessonId) ctx.cleanup.lessonIds.push(st.lessonId);
    },
  }),

  mcpSmoke('list_lessons', 'list_lessons', (ctx) => ({
    project_id: ctx.projectId,
    limit: 3,
  })),

  mcpSmoke('search_lessons', 'search_lessons', (ctx) => ({
    project_id: ctx.projectId,
    query: 'smoke test',
    limit: 3,
  })),

  mcpSmoke('list_lesson_versions', 'list_lesson_versions', (ctx) => ({
    project_id: ctx.projectId,
    lesson_id: st.lessonId ?? 'nonexistent',
  }), {
    skipIf: () => st.lessonId ? null : 'no lesson created',
  }),

  mcpSmoke('update_lesson', 'update_lesson', (ctx) => ({
    project_id: ctx.projectId,
    lesson_id: st.lessonId ?? 'nonexistent',
    title: 'MCP smoke test lesson (updated)',
  }), {
    skipIf: () => st.lessonId ? null : 'no lesson created',
  }),

  mcpSmoke('update_lesson_status', 'update_lesson_status', (ctx) => ({
    project_id: ctx.projectId,
    lesson_id: st.lessonId ?? 'nonexistent',
    status: 'active',
  }), {
    skipIf: () => st.lessonId ? null : 'no lesson created',
  }),
];

// ── Guardrails ───────────────────────────────────────────────────────────

const guardrailTests: TestFn[] = [
  mcpSmoke('check_guardrails', 'check_guardrails', (ctx) => ({
    action_context: { action: 'smoke test action', project_id: ctx.projectId },
  })),
];

// ── Search Tools ─────────────────────────────────────────────────────────

const searchTests: TestFn[] = [
  mcpSmoke('search_code', 'search_code', (ctx) => ({
    project_id: ctx.projectId,
    query: 'test function',
    limit: 3,
  })),

  mcpSmoke('search_code_tiered', 'search_code_tiered', (ctx) => ({
    project_id: ctx.projectId,
    query: 'test',
    limit: 3,
  })),
];

// ── Distillation (skip if not configured) ────────────────────────────────

const distillTests: TestFn[] = [
  mcpSmoke('reflect', 'reflect', (ctx) => ({
    project_id: ctx.projectId,
    topic: 'smoke test topic',
  }), {
    skipIf: () => null, // will fail gracefully if distillation disabled
  }),

  mcpSmoke('compress_context', 'compress_context', () => ({
    text: 'This is a smoke test for the compress context tool.',
  }), {
    skipIf: () => null,
  }),
];

// ── Knowledge Graph (skip if KG off) ─────────────────────────────────────

const kgTests: TestFn[] = [
  mcpSmoke('search_symbols', 'search_symbols', (ctx) => ({
    project_id: ctx.projectId,
    query: 'test',
    limit: 3,
  })),

  mcpSmoke('get_symbol_neighbors', 'get_symbol_neighbors', (ctx) => ({
    project_id: ctx.projectId,
    symbol_id: 'nonexistent',
  })),

  mcpSmoke('trace_dependency_path', 'trace_dependency_path', (ctx) => ({
    project_id: ctx.projectId,
    from_symbol_id: 'a',
    to_symbol_id: 'b',
  })),

  mcpSmoke('get_lesson_impact', 'get_lesson_impact', (ctx) => ({
    project_id: ctx.projectId,
    lesson_id: st.lessonId ?? 'nonexistent',
  })),
];

// ── Git Intelligence ─────────────────────────────────────────────────────

const gitTests: TestFn[] = [
  mcpSmoke('list_commits', 'list_commits', (ctx) => ({
    project_id: ctx.projectId,
    limit: 3,
  })),

  mcpSmoke('get_commit', 'get_commit', (ctx) => ({
    project_id: ctx.projectId,
    sha: '0000000',
  })),

  mcpSmoke('suggest_lessons_from_commits', 'suggest_lessons_from_commits', (ctx) => ({
    project_id: ctx.projectId,
    limit: 1,
  })),

  mcpSmoke('analyze_commit_impact', 'analyze_commit_impact', (ctx) => ({
    project_id: ctx.projectId,
    commit_sha: '0000000',
  })),
];

// ── Workspace & Sources ──────────────────────────────────────────────────

const workspaceTests: TestFn[] = [
  mcpSmoke('list_workspace_roots', 'list_workspace_roots', (ctx) => ({
    project_id: ctx.projectId,
  })),

  mcpSmoke('get_project_source', 'get_project_source', (ctx) => ({
    project_id: ctx.projectId,
  })),
];

// ── Generated Docs ───────────────────────────────────────────────────────

const generatedDocTests: TestFn[] = [
  mcpSmoke('list_generated_documents', 'list_generated_documents', (ctx) => ({
    project_id: ctx.projectId,
  })),

  mcpSmoke('get_generated_document', 'get_generated_document', (ctx) => ({
    project_id: ctx.projectId,
    doc_id: '00000000-0000-0000-0000-000000000000',
  })),
];

// ── Jobs ─────────────────────────────────────────────────────────────────

const jobTests: TestFn[] = [
  mcpSmoke('list_jobs', 'list_jobs', (ctx) => ({
    project_id: ctx.projectId,
  })),

  mcpSmoke('run_next_job', 'run_next_job', (ctx) => ({
    project_id: ctx.projectId,
  })),
];

// ── Groups ───────────────────────────────────────────────────────────────

const groupTests: TestFn[] = [
  mcpSmoke('list_groups', 'list_groups', () => ({})),

  mcpSmoke('create_group', 'create_group', (ctx) => ({
    group_id: `e2e_mcp_${ctx.runMarker.slice(4, 12)}`,
    name: 'MCP smoke test group',
  }), {
    onResult: (ctx, result) => {
      st.groupId = result?.group_id;
      if (st.groupId) ctx.cleanup.groupIds.push(st.groupId);
    },
  }),

  mcpSmoke('list_group_members', 'list_group_members', () => ({
    group_id: st.groupId ?? 'nonexistent',
  }), {
    skipIf: () => st.groupId ? null : 'no group created',
  }),

  mcpSmoke('add_project_to_group', 'add_project_to_group', (ctx) => ({
    group_id: st.groupId ?? 'nonexistent',
    project_id: ctx.projectId,
  }), {
    skipIf: () => st.groupId ? null : 'no group created',
  }),

  mcpSmoke('remove_project_from_group', 'remove_project_from_group', (ctx) => ({
    group_id: st.groupId ?? 'nonexistent',
    project_id: ctx.projectId,
  }), {
    skipIf: () => st.groupId ? null : 'no group created',
  }),

  mcpSmoke('list_project_groups', 'list_project_groups', (ctx) => ({
    project_id: ctx.projectId,
  })),

  mcpSmoke('delete_group', 'delete_group', (ctx) => ({
    group_id: st.groupId ?? 'nonexistent',
  }), {
    skipIf: () => st.groupId ? null : 'no group created',
    onResult: (ctx) => {
      if (st.groupId) {
        ctx.cleanup.groupIds = ctx.cleanup.groupIds.filter((id: string) => id !== st.groupId);
        st.groupId = undefined;
      }
    },
  }),
];

// ── Delete Workspace (uses temp project) ─────────────────────────────────

const deleteTests: TestFn[] = [
  mcpSmoke('delete_workspace', 'delete_workspace', () => ({
    project_id: 'e2e-mcp-temp-delete',
  })),
];

// ── Export all ────────────────────────────────────────────────────────────

export const allMcpSmokeTests: TestFn[] = [
  ...coreTests,
  ...lessonTests,
  ...guardrailTests,
  ...searchTests,
  ...distillTests,
  ...kgTests,
  ...gitTests,
  ...workspaceTests,
  ...generatedDocTests,
  ...jobTests,
  ...groupTests,
  ...deleteTests,
];
