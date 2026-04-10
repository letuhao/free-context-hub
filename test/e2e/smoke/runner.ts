/**
 * Layer 1 Smoke Test Runner — API + MCP smoke tests.
 * GUI smoke tests run separately via Playwright.
 *
 * Usage: npm run test:e2e:smoke
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { bootstrapContext, teardownContext, runTests, generateReport } from '../shared/testContext.js';
import type { TestFn } from '../shared/testContext.js';

// Test imports
import { allApiSmokeTests } from './api-smoke.test.js';
import { allMcpSmokeTests } from './mcp-smoke.test.js';

async function main() {
  const startMs = Date.now();

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   E2E Smoke Tests — Layer 1              ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const ctx = await bootstrapContext({ withMcp: true });

  const allTests: TestFn[] = [
    ...allApiSmokeTests,
    ...allMcpSmokeTests,
  ];

  console.log(`  ${allTests.length} tests registered.\n`);

  let results;
  try {
    results = await runTests(allTests, ctx);
  } finally {
    await teardownContext(ctx);
  }

  const durationMs = Date.now() - startMs;
  const report = generateReport(results, durationMs, 'E2E Smoke Test Report');

  // Write report
  const reportDir = path.resolve('docs/qc');
  await fs.mkdir(reportDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -1);
  const reportPath = path.join(reportDir, `${ts}-e2e-smoke-report.md`);
  await fs.writeFile(reportPath, report);
  console.log(`\nReport: ${reportPath}`);

  // Summary
  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${passed}/${results.length} passed, ${failed} failed (${durationMs}ms)\n`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Smoke runner crashed:', err);
  process.exit(1);
});
