/**
 * Integration test runner for ContextHub MCP server.
 *
 * Tests core features (lessons, guardrails, bootstrap) and supplementary
 * features (tiered search profiles) via live MCP tool calls.
 *
 * Usage:
 *   npm run test:integration
 *
 * Requires:
 *   - MCP server running (MCP_SERVER_URL env var, default http://localhost:3000/mcp)
 *   - Embeddings server running (for search tests)
 *   - Project indexed (for tiered search tests)
 *
 * Env vars:
 *   MCP_SERVER_URL           — MCP endpoint (default: http://localhost:3000/mcp)
 *   CONTEXT_HUB_WORKSPACE_TOKEN — optional auth token
 *   PROJECT_ID               — project to test against (default: free-context-hub)
 *   SKIP_TIERED_SEARCH       — set to 'true' to skip tiered search tests (if not indexed)
 */
import * as dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

import { callTool, withAuth } from './testTypes.js';
import type { TestContext, TestFn, TestResult } from './testTypes.js';
import { allLessonTests } from './tests/lessonTests.js';
import { allLessonUpdateTests } from './tests/lessonUpdateTests.js';
import { allGuardrailTests } from './tests/guardrailTests.js';
import { allBootstrapTests } from './tests/bootstrapTests.js';
import { allTieredSearchTests } from './tests/tieredSearchTests.js';

dotenv.config();

// ─── Configuration ───────────────────────────────────────────────────────

const MCP_SERVER_URL = process.env.MCP_SERVER_URL?.trim() || 'http://localhost:3000/mcp';
const WORKSPACE_TOKEN = process.env.CONTEXT_HUB_WORKSPACE_TOKEN?.trim() || undefined;
const PROJECT_ID = process.env.PROJECT_ID?.trim() || process.env.DEFAULT_PROJECT_ID?.trim() || 'free-context-hub';
const SKIP_TIERED = process.env.SKIP_TIERED_SEARCH?.trim() === 'true';

// ─── Runner ──────────────────────────────────────────────────────────────

async function connectMcp(): Promise<Client> {
  const client = new Client(
    { name: 'contexthub-integration-test', version: '1.0.0' },
    { capabilities: {} },
  );
  const transport = new StreamableHTTPClientTransport(new URL(MCP_SERVER_URL), {});
  await client.connect(transport);
  return client;
}

async function runTests(tests: TestFn[], ctx: TestContext): Promise<TestResult[]> {
  const results: TestResult[] = [];
  for (const testFn of tests) {
    try {
      const result = await testFn(ctx);
      results.push(result);
      const icon = result.pass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
      console.log(`  ${icon}  ${result.group}/${result.name} (${result.duration_ms}ms)${result.message ? ' — ' + result.message : ''}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ name: 'unknown', group: 'lessons', pass: false, message: `Runner error: ${msg}`, duration_ms: 0 });
      console.log(`  \x1b[31mFAIL\x1b[0m  (runner error) — ${msg}`);
    }
  }
  return results;
}

async function cleanup(ctx: TestContext): Promise<void> {
  if (!ctx.createdLessonIds.length) return;
  console.log(`\nCleaning up ${ctx.createdLessonIds.length} test lessons...`);

  for (const lessonId of ctx.createdLessonIds) {
    try {
      // Archive test lessons to clean up (no delete_lesson tool, so archive).
      await callTool(ctx.client, 'update_lesson_status', withAuth({
        project_id: ctx.projectId,
        lesson_id: lessonId,
        status: 'archived',
      }, ctx.workspaceToken), 10_000);
    } catch {
      // Best-effort cleanup.
    }
  }
  console.log('  Done.');
}

function generateReport(results: TestResult[], durationMs: number): string {
  const passed = results.filter(r => r.pass).length;
  const total = results.length;
  const verdict = passed === total ? 'PASS' : 'FAIL';
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -1);

  let md = `# Integration Test Report — ${ts}\n\n`;
  md += `**Result: ${verdict}** — ${passed}/${total} tests passed (${durationMs}ms total)\n\n`;

  md += '## Results\n\n';
  md += '| # | Group | Test | Result | Duration | Message |\n';
  md += '|---|-------|------|--------|----------|--------|\n';
  results.forEach((r, i) => {
    const result = r.pass ? 'PASS' : '**FAIL**';
    const msg = r.message ? r.message.replace(/\|/g, '\\|').slice(0, 120) : '';
    md += `| ${i + 1} | ${r.group} | ${r.name} | ${result} | ${r.duration_ms}ms | ${msg} |\n`;
  });

  const failures = results.filter(r => !r.pass);
  if (failures.length > 0) {
    md += '\n## Failed Tests\n\n';
    for (const f of failures) {
      md += `### ${f.group}/${f.name}\n`;
      md += `- Duration: ${f.duration_ms}ms\n`;
      md += `- Message: ${f.message}\n\n`;
    }
  }

  md += '\n## Environment\n\n';
  md += `- MCP URL: \`${MCP_SERVER_URL}\`\n`;
  md += `- Project ID: \`${PROJECT_ID}\`\n`;
  md += `- Tiered search: ${SKIP_TIERED ? 'skipped' : 'included'}\n`;

  return md;
}

// ─── Main ────────────────────────────────────────────────────────────────

async function main() {
  const startMs = Date.now();

  console.log('═══════════════════════════════════════════════');
  console.log('  ContextHub Integration Tests');
  console.log(`  MCP: ${MCP_SERVER_URL}`);
  console.log(`  Project: ${PROJECT_ID}`);
  console.log('═══════════════════════════════════════════════\n');

  // Connect to MCP.
  let client: Client;
  try {
    client = await connectMcp();
    console.log('Connected to MCP server.\n');
  } catch (err) {
    console.error(`\x1b[31mFailed to connect to MCP server at ${MCP_SERVER_URL}\x1b[0m`);
    console.error(err instanceof Error ? err.message : String(err));
    console.error('\nMake sure the server is running: docker compose up -d  or  npm run dev\n');
    process.exit(1);
  }

  const ctx: TestContext = {
    client,
    projectId: PROJECT_ID,
    workspaceToken: WORKSPACE_TOKEN,
    createdLessonIds: [],
  };

  const allResults: TestResult[] = [];

  // Group 1: Lessons (P0).
  console.log('── Lessons ──');
  allResults.push(...await runTests(allLessonTests, ctx));

  // Group 1b: Lesson Update & Versioning.
  console.log('\n── Lesson Updates ──');
  allResults.push(...await runTests(allLessonUpdateTests, ctx));

  // Group 2: Guardrails (P0).
  console.log('\n── Guardrails ──');
  allResults.push(...await runTests(allGuardrailTests, ctx));

  // Group 3: Bootstrap (P0).
  console.log('\n── Session Bootstrap ──');
  allResults.push(...await runTests(allBootstrapTests, ctx));

  // Group 4: Tiered Search (P1-P2).
  if (!SKIP_TIERED) {
    console.log('\n── Tiered Search ──');
    allResults.push(...await runTests(allTieredSearchTests, ctx));
  } else {
    console.log('\n── Tiered Search (SKIPPED: SKIP_TIERED_SEARCH=true) ──');
  }

  // Cleanup.
  await cleanup(ctx);

  // Report.
  const totalMs = Date.now() - startMs;
  const report = generateReport(allResults, totalMs);

  // Write report.
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -1);
  const reportPath = path.resolve('docs', 'qc', `${ts}-integration-report.md`);
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, report, 'utf8');

  // Summary.
  const passed = allResults.filter(r => r.pass).length;
  const total = allResults.length;
  const failed = total - passed;

  console.log('\n═══════════════════════════════════════════════');
  if (failed === 0) {
    console.log(`  \x1b[32mALL ${total} TESTS PASSED\x1b[0m (${totalMs}ms)`);
  } else {
    console.log(`  \x1b[31m${failed} FAILED\x1b[0m / ${total} tests (${totalMs}ms)`);
  }
  console.log(`  Report: ${reportPath}`);
  console.log('═══════════════════════════════════════════════');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
