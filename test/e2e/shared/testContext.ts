/**
 * E2E test context — bootstraps shared state for all test categories.
 */

import * as dotenv from 'dotenv';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { makeApiClient } from './apiClient.js';
import { connectMcp } from './mcpClient.js';
import { CleanupRegistry } from './cleanup.js';
import { API_BASE, ADMIN_TOKEN, E2E_PROJECT_ID, MCP_URL, RUN_MARKER } from './constants.js';

dotenv.config();

export type TestResult = {
  name: string;
  group: string;
  pass: boolean;
  message: string;
  duration_ms: number;
};

export type TestFn = (ctx: E2ETestContext) => Promise<TestResult>;

export type E2ETestContext = {
  api: ReturnType<typeof makeApiClient>;
  projectId: string;
  adminToken: string;
  runMarker: string;
  mcp?: Client;
  cleanup: CleanupRegistry;
};

/** Create a passing result. */
export function pass(name: string, group: string, duration_ms: number, message = ''): TestResult {
  return { name, group, pass: true, message, duration_ms };
}

/** Create a failing result. */
export function fail(name: string, group: string, duration_ms: number, message: string): TestResult {
  return { name, group, pass: false, message, duration_ms };
}

/** Create a skipped result (counts as pass). */
export function skip(name: string, group: string, reason: string): TestResult {
  return { name, group, pass: true, message: `SKIP: ${reason}`, duration_ms: 0 };
}

/** Bootstrap the E2E test context. */
export async function bootstrapContext(opts?: { withMcp?: boolean }): Promise<E2ETestContext> {
  const api = makeApiClient(API_BASE, ADMIN_TOKEN);
  const cleanup = new CleanupRegistry();

  // Ensure the E2E test project exists
  try {
    await api.post('/api/projects', {
      project_id: E2E_PROJECT_ID,
      name: `E2E Test Project (${RUN_MARKER})`,
    });
  } catch {
    // Project may already exist — that's fine
  }

  let mcp: Client | undefined;
  if (opts?.withMcp) {
    try {
      mcp = await connectMcp(MCP_URL);
    } catch (err) {
      console.warn(`[e2e] Could not connect to MCP at ${MCP_URL}: ${err}`);
    }
  }

  return {
    api,
    projectId: E2E_PROJECT_ID,
    adminToken: ADMIN_TOKEN,
    runMarker: RUN_MARKER,
    mcp,
    cleanup,
  };
}

/** Teardown: run cleanup and close MCP. */
export async function teardownContext(ctx: E2ETestContext): Promise<void> {
  await ctx.cleanup.runAll(ctx.projectId);
  if (ctx.mcp) {
    try { await ctx.mcp.close(); } catch { /* ignore */ }
  }
}

/** Run an array of test functions sequentially. */
export async function runTests(tests: TestFn[], ctx: E2ETestContext): Promise<TestResult[]> {
  const results: TestResult[] = [];
  for (const testFn of tests) {
    try {
      const result = await testFn(ctx);
      results.push(result);
      const icon = result.pass ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
      const skipTag = result.message.startsWith('SKIP:') ? ' \x1b[33m(skipped)\x1b[0m' : '';
      console.log(`  ${icon}  ${result.group}/${result.name} (${result.duration_ms}ms)${skipTag}${result.message && !result.message.startsWith('SKIP:') ? ' — ' + result.message : ''}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results.push({ name: 'unknown', group: 'runner', pass: false, message: `Runner error: ${msg}`, duration_ms: 0 });
      console.log(`  \x1b[31mFAIL\x1b[0m  (runner error) — ${msg}`);
    }
  }
  return results;
}

/** Generate a markdown report from test results. */
export function generateReport(results: TestResult[], durationMs: number, title: string): string {
  const passed = results.filter(r => r.pass).length;
  const skipped = results.filter(r => r.message.startsWith('SKIP:')).length;
  const failed = results.filter(r => !r.pass).length;
  const total = results.length;
  const verdict = failed === 0 ? 'PASS' : 'FAIL';
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -1);

  let md = `# ${title} — ${ts}\n\n`;
  md += `**Result: ${verdict}** — ${passed}/${total} passed, ${skipped} skipped, ${failed} failed (${durationMs}ms total)\n\n`;

  md += '## Results\n\n';
  md += '| # | Group | Test | Result | Duration | Message |\n';
  md += '|---|-------|------|--------|----------|--------|\n';
  results.forEach((r, i) => {
    const result = r.pass ? (r.message.startsWith('SKIP:') ? 'SKIP' : 'PASS') : '**FAIL**';
    const msg = r.message ? r.message.replace(/\|/g, '\\|').slice(0, 120) : '';
    md += `| ${i + 1} | ${r.group} | ${r.name} | ${result} | ${r.duration_ms}ms | ${msg} |\n`;
  });

  if (failed > 0) {
    md += '\n## Failed Tests\n\n';
    for (const f of results.filter(r => !r.pass)) {
      md += `### ${f.group}/${f.name}\n`;
      md += `- Duration: ${f.duration_ms}ms\n`;
      md += `- Message: ${f.message}\n\n`;
    }
  }

  md += '\n## Environment\n\n';
  md += `- API: \`${API_BASE}\`\n`;
  md += `- MCP: \`${MCP_URL}\`\n`;
  md += `- Project: \`${E2E_PROJECT_ID}\`\n`;
  md += `- Run marker: \`${RUN_MARKER}\`\n`;

  return md;
}
