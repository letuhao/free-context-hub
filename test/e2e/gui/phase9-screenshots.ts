/**
 * Phase 9 visual verification — screenshot all pages at 1920x1080.
 * Captures both single-project and All Projects modes.
 */
import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const GUI = process.env.GUI_URL ?? 'http://localhost:3002';
const OUT = path.resolve('docs/qc/screenshots/phase9');
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  { name: 'dashboard', url: '/' },
  { name: 'lessons', url: '/lessons' },
  { name: 'review', url: '/review' },
  { name: 'guardrails', url: '/guardrails' },
  { name: 'analytics', url: '/analytics' },
  { name: 'chat', url: '/chat' },
  { name: 'documents', url: '/documents' },
  { name: 'getting-started', url: '/getting-started' },
  { name: 'knowledge-docs', url: '/knowledge/docs' },
  { name: 'knowledge-search', url: '/knowledge/search' },
  { name: 'knowledge-graph', url: '/knowledge/graph' },
  { name: 'projects', url: '/projects' },
  { name: 'projects-git', url: '/projects/git' },
  { name: 'projects-settings', url: '/projects/settings' },
  { name: 'jobs', url: '/jobs' },
  { name: 'activity', url: '/activity' },
  { name: 'agents', url: '/agents' },
  { name: 'settings', url: '/settings' },
  { name: 'settings-access', url: '/settings/access' },
];

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();

  // ── Single project mode (default) ──
  console.log('\n=== Single Project Mode ===');
  for (const pg of PAGES) {
    await page.goto(`${GUI}${pg.url}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `single-${pg.name}.png`), fullPage: false });
    console.log(`  ${pg.name}: done`);
  }

  // ── Switch to All Projects mode ──
  console.log('\n=== All Projects Mode ===');
  // Set localStorage to All Projects
  await page.evaluate(() => {
    localStorage.setItem('contexthub-selected-project-ids', JSON.stringify(['__ALL__']));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  for (const pg of PAGES) {
    await page.goto(`${GUI}${pg.url}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `all-${pg.name}.png`), fullPage: false });
    console.log(`  ${pg.name}: done`);
  }

  // Reset back to single project
  await page.evaluate(() => {
    localStorage.setItem('contexthub-selected-project-ids', JSON.stringify(['free-context-hub']));
  });

  await browser.close();
  console.log(`\nScreenshots saved to ${OUT}`);
}

main();
