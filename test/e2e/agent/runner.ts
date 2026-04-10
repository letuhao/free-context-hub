/**
 * Layer 2 — Agent MCP→GUI Visual Test Runner.
 * Calls MCP tools then verifies results in the GUI via Playwright screenshots.
 *
 * Usage: npm run test:e2e:agent
 */

import * as dotenv from 'dotenv';
import fs from 'node:fs/promises';
import path from 'node:path';
import { runTests, generateReport } from '../shared/testContext.js';
import type { TestFn, TestResult } from '../shared/testContext.js';
import { bootstrapAgentContext, teardownAgentContext } from './agentContext.js';
import { allLessonFlowTests } from './lessonFlow.spec.js';
import { allGuardrailFlowTests } from './guardrailFlow.spec.js';
import { allBootstrapFlowTests } from './bootstrapFlow.spec.js';

dotenv.config();

async function main() {
  const startMs = Date.now();

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   E2E Agent MCP→GUI Tests — Layer 2      ║');
  console.log('╚══════════════════════════════════════════╝\n');

  let ctx;
  try {
    ctx = await bootstrapAgentContext();
  } catch (err) {
    console.error('Failed to bootstrap agent context:', err);
    process.exit(1);
  }

  const allTests: TestFn[] = [
    ...allLessonFlowTests,
    ...allGuardrailFlowTests,
    ...allBootstrapFlowTests,
  ];

  console.log(`  ${allTests.length} tests registered.\n`);

  let results: TestResult[];
  try {
    // Pass the agent context (which has mcp + page) as the test context
    results = await runTests(allTests, ctx as any);
  } finally {
    await teardownAgentContext(ctx);
  }

  const durationMs = Date.now() - startMs;
  const report = generateReport(results, durationMs, 'E2E Agent MCP→GUI Test Report');

  const reportDir = path.resolve('docs/qc');
  await fs.mkdir(reportDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -1);
  const reportPath = path.join(reportDir, `${ts}-e2e-agent-report.md`);
  await fs.writeFile(reportPath, report);
  console.log(`\nReport: ${reportPath}`);
  console.log(`Screenshots: docs/qc/screenshots/agent-tests/`);

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${passed}/${results.length} passed, ${failed} failed (${durationMs}ms)\n`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Agent runner crashed:', err);
  process.exit(1);
});
