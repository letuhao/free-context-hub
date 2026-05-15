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
import { allPhase10Tests } from './phase10.test.js';
import { allPhase11PullTests } from './phase11-pull.test.js';
import { allPhase11ImportTests } from './phase11-import.test.js';
// Phase 13 Sprint 13.7
import { allPhase13LeaseTests } from './phase13-leases.test.js';
import { allPhase13ReviewTests } from './phase13-reviews.test.js';
import { allPhase13TaxonomyTests } from './phase13-taxonomy.test.js';
import { allPhase13McpTests } from './phase13-mcp.test.js';
import { allPhase13CrossFeatureTests } from './phase13-cross-feature.test.js';
import { allPhase13AuthScopeTests } from './phase13-auth-scope.test.js';

async function main() {
  const startMs = Date.now();

  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║   E2E API Scenario Tests — Layer 2       ║');
  console.log('╚══════════════════════════════════════════╝\n');

  // Phase 10.6: pass withMcp so phase10-mcp-chunk-search-tool can exercise
  // the MCP search_document_chunks tool end-to-end.
  const ctx = await bootstrapContext({ withMcp: true });

  const allTests: TestFn[] = [
    ...allAuthTests,
    ...allLessonTests,
    ...allGuardrailTests,
    ...allDocumentTests,
    ...allSearchTests,
    ...allSystemTests,
    ...allPhase10Tests,
    ...allPhase11PullTests,
    ...allPhase11ImportTests,
    // Phase 13 Sprint 13.7
    ...allPhase13LeaseTests,
    ...allPhase13ReviewTests,
    ...allPhase13TaxonomyTests,
    ...allPhase13McpTests,
    ...allPhase13CrossFeatureTests,
    ...allPhase13AuthScopeTests, // skipped automatically when auth is disabled
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
