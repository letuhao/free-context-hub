import { chromium } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const GUI = process.env.GUI_URL ?? 'http://localhost:3002';
const OUT = path.resolve('docs/qc/screenshots/sprint-9.11');
fs.mkdirSync(OUT, { recursive: true });

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();

  // Single project mode
  console.log('=== Single Project ===');
  await page.goto(`${GUI}/projects`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'single-projects-overview.png'), fullPage: false });
  console.log('  projects overview: done');

  await page.goto(`${GUI}/projects/groups`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'single-groups.png'), fullPage: false });
  console.log('  groups: done');

  // Check sidebar
  await page.screenshot({ path: path.join(OUT, 'sidebar.png'), fullPage: false, clip: { x: 0, y: 0, width: 240, height: 1080 } });
  console.log('  sidebar: done');

  // All Projects mode
  console.log('=== All Projects ===');
  await page.evaluate(() => {
    localStorage.setItem('contexthub-selected-project-ids', JSON.stringify(['__ALL__']));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);

  await page.goto(`${GUI}/projects`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'all-projects-overview.png'), fullPage: false });
  console.log('  all projects overview: done');

  await page.goto(`${GUI}/projects/groups`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, 'all-groups.png'), fullPage: false });
  console.log('  all groups: done');

  // Check sidebar in All Projects mode
  await page.screenshot({ path: path.join(OUT, 'sidebar-all.png'), fullPage: false, clip: { x: 0, y: 0, width: 240, height: 1080 } });
  console.log('  sidebar (all): done');

  // Reset
  await page.evaluate(() => {
    localStorage.setItem('contexthub-selected-project-ids', JSON.stringify(['free-context-hub']));
  });

  await browser.close();
  console.log(`\nScreenshots saved to ${OUT}`);
}
main();
