/**
 * Layer 1 — GUI Smoke Tests
 * Navigate to every page, wait for load, take screenshot, verify no console errors.
 * Screenshots saved to docs/qc/screenshots/ as visual baseline.
 */

import { test, expect, SCREENSHOT_DIR } from './fixtures.js';
import path from 'node:path';

const PAGES: { name: string; url: string; waitFor?: string }[] = [
  // ── Main ──
  { name: 'dashboard', url: '/', waitFor: 'text=Dashboard' },
  { name: 'chat', url: '/chat', waitFor: 'text=Chat' },

  // ── Knowledge ──
  { name: 'lessons', url: '/lessons', waitFor: 'text=Lessons' },
  { name: 'review', url: '/review', waitFor: 'text=Review' },
  { name: 'guardrails', url: '/guardrails', waitFor: 'text=Guardrails' },
  { name: 'documents', url: '/documents', waitFor: 'text=Documents' },
  { name: 'getting-started', url: '/getting-started', waitFor: 'text=Getting Started' },
  { name: 'knowledge-docs', url: '/knowledge/docs', waitFor: 'text=Generated' },
  { name: 'knowledge-search', url: '/knowledge/search', waitFor: 'text=Search' },
  { name: 'knowledge-graph', url: '/knowledge/graph', waitFor: 'text=Graph' },

  // ── Project ──
  { name: 'projects', url: '/projects', waitFor: 'text=Overview' },
  { name: 'projects-groups', url: '/projects/groups', waitFor: 'text=Groups' },
  { name: 'projects-git', url: '/projects/git', waitFor: 'text=Git' },
  { name: 'projects-sources', url: '/projects/sources', waitFor: 'text=Sources' },
  { name: 'projects-settings', url: '/projects/settings', waitFor: 'text=Settings' },

  // ── System ──
  { name: 'jobs', url: '/jobs', waitFor: 'text=Jobs' },
  { name: 'activity', url: '/activity', waitFor: 'text=Activity' },
  { name: 'analytics', url: '/analytics', waitFor: 'text=Analytics' },
  { name: 'settings', url: '/settings', waitFor: 'text=Settings' },
  { name: 'settings-models', url: '/settings/models', waitFor: 'text=Model' },
  { name: 'settings-lesson-types', url: '/settings/lesson-types', waitFor: 'text=Lesson Types' },
  { name: 'agents', url: '/agents', waitFor: 'text=Agent' },
  { name: 'settings-access', url: '/settings/access', waitFor: 'text=Access' },
];

for (const pg of PAGES) {
  test(`gui-smoke: ${pg.name} (${pg.url})`, async ({ page, consoleErrors }) => {
    await page.goto(pg.url, { waitUntil: 'networkidle' });

    // Wait for key text to appear (confirms page rendered, not stuck on loading)
    if (pg.waitFor) {
      const selector = pg.waitFor.startsWith('text=')
        ? page.locator(`text=${pg.waitFor.slice(5)}`)
        : page.locator(pg.waitFor);
      await selector.first().waitFor({ state: 'visible', timeout: 10_000 });
    }

    // Take screenshot
    const screenshotPath = path.join(SCREENSHOT_DIR, `${pg.name}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    // Assert no critical console errors
    const critical = consoleErrors.filter(
      (e) => !e.includes('Warning:') && !e.includes('DevTools') && !e.includes('net::ERR'),
    );
    expect(critical, `Console errors on ${pg.url}`).toHaveLength(0);
  });
}
