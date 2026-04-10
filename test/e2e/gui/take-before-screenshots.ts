/**
 * Quick script to take "before" screenshots at 1920x1080 (16:9).
 */
import { chromium } from '@playwright/test';
import path from 'node:path';

const GUI_URL = process.env.GUI_URL ?? 'http://localhost:3002';
const OUT = path.resolve(process.env.SCREENSHOT_OUT ?? 'docs/qc/screenshots/before-layout-fix');

const PAGES = [
  { name: 'dashboard', url: '/' },
  { name: 'lessons', url: '/lessons' },
  { name: 'guardrails', url: '/guardrails' },
  { name: 'analytics', url: '/analytics' },
  { name: 'chat', url: '/chat' },
  { name: 'settings', url: '/settings' },
  { name: 'activity', url: '/activity' },
  { name: 'projects-settings', url: '/projects/settings' },
];

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const page = await ctx.newPage();

  for (const pg of PAGES) {
    await page.goto(`${GUI_URL}${pg.url}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    // Full page screenshot to show how much scrolls
    await page.screenshot({ path: path.join(OUT, `${pg.name}.png`), fullPage: true });
    // Viewport-only screenshot to show what user actually sees
    await page.screenshot({ path: path.join(OUT, `${pg.name}-viewport.png`), fullPage: false });
    console.log(`  ${pg.name}: done`);
  }

  await browser.close();
  console.log(`\nScreenshots saved to ${OUT}`);
}

main();
