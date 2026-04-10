/**
 * Layer 2 — API Scenario Test Runner.
 * Tests CRUD lifecycles, role enforcement, and business logic.
 *
 * Usage: npm run test:e2e:api
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { bootstrapContext, teardownContext, runTests, generateReport } from '../shared/testContext.js';
import type { TestFn } from '../shared/testContext.js';

import { allAuthTests } from './auth.test.js';
import { allLessonTests } from './lessons.test.js';
import { allGuardrailTests } from './guardrails.test.js';
import { allDocumentTests } from './documents.test.js';
import { allSearchTests } from './search.test.js';
import { allSystemTests } from './system.test.js';

async function main() {
  const startMs = Date.now();

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   E2E API Scenario Tests — Layer 2       ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const ctx = await bootstrapContext();

  const allTests: TestFn[] = [
    ...allAuthTests,
    ...allLessonTests,
    ...allGuardrailTests,
    ...allDocumentTests,
    ...allSearchTests,
    ...allSystemTests,
  ];

  console.log(`  ${allTests.length} tests registered.\n`);

  let results;
  try {
    results = await runTests(allTests, ctx);
  } finally {
    await teardownContext(ctx);
  }

  const durationMs = Date.now() - startMs;
  const report = generateReport(results, durationMs, 'E2E API Scenario Test Report');

  const reportDir = path.resolve('docs/qc');
  await fs.mkdir(reportDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -1);
  const reportPath = path.join(reportDir, `${ts}-e2e-api-scenario-report.md`);
  await fs.writeFile(reportPath, report);
  console.log(`\nReport: ${reportPath}`);

  const passed = results.filter(r => r.pass).length;
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n${passed}/${results.length} passed, ${failed} failed (${durationMs}ms)\n`);

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('API scenario runner crashed:', err);
  process.exit(1);
});
