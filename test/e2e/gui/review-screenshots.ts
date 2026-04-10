import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const GUI = process.env.GUI_URL ?? 'http://localhost:3002';
const OUT = path.resolve('docs/qc/screenshots/review');
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  { name: 'knowledge-docs', url: '/knowledge/docs' },
  { name: 'knowledge-search', url: '/knowledge/search' },
  { name: 'knowledge-graph', url: '/knowledge/graph' },
  { name: 'projects', url: '/projects' },
  { name: 'projects-groups', url: '/projects/groups' },
  { name: 'projects-git', url: '/projects/git' },
  { name: 'projects-sources', url: '/projects/sources' },
  { name: 'review', url: '/review' },
  { name: 'documents', url: '/documents' },
  { name: 'jobs', url: '/jobs' },
  { name: 'agents', url: '/agents' },
  { name: 'getting-started', url: '/getting-started' },
  { name: 'settings-models', url: '/settings/models' },
  { name: 'settings-lesson-types', url: '/settings/lesson-types' },
  { name: 'settings-access', url: '/settings/access' },
];

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();
  for (const pg of PAGES) {
    await page.goto(`${GUI}${pg.url}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    await page.screenshot({ path: path.join(OUT, `${pg.name}.png`), fullPage: false });
    console.log(`  ${pg.name}: done`);
  }
  await browser.close();
}
main();
