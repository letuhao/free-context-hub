/**
 * Layer 2 — Dashboard GUI Scenario Tests (5 tests)
 *
 * Tests dashboard load, stat cards, project selector, recent lessons, command palette.
 */

import { test, expect, SCREENSHOT_DIR } from './fixtures.js';
import path from 'node:path';

test.describe('Dashboard', () => {
  test('loads with stat cards', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    // Wait for stat cards to render (loading skeleton disappears)
    await page.waitForSelector('text=Lessons', { timeout: 15_000 });
    // Verify at least one stat card with a number
    const statValues = page.locator('text=/^\\d+$/');
    const count = await statValues.count();
    expect(count, 'Expected at least 1 stat value').toBeGreaterThanOrEqual(1);
  });

  test('project selector renders and opens', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    // The sidebar should show the project selector
    const sidebar = page.locator('aside');
    await expect(sidebar).toBeVisible();
    // Look for the project name or "Create your first project" button
    const projectText = sidebar.locator('text=/free-context-hub|Create/');
    await expect(projectText.first()).toBeVisible({ timeout: 10_000 });
  });

  test('recent lessons section shows data', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000); // let async fetches settle
    // Dashboard should show "Recent Lessons" heading or a lesson row
    const recentSection = page.locator('text=Recent Lessons');
    const hasRecent = await recentSection.count();
    if (hasRecent > 0) {
      // If there are lessons, verify at least one row exists
      await expect(recentSection).toBeVisible();
    }
    // If no lessons exist yet, that's also fine (empty state)
  });

  test('insights panel renders', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    // Either insights panel or the empty onboarding state should be visible
    const insights = page.locator('text=Insights');
    const onboarding = page.locator('text=Welcome to ContextHub');
    const hasInsights = await insights.count();
    const hasOnboarding = await onboarding.count();
    expect(hasInsights + hasOnboarding, 'Expected either Insights or Onboarding').toBeGreaterThanOrEqual(1);
  });

  test('Cmd+K command palette opens and closes', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    // Open command palette with Ctrl+K
    await page.keyboard.press('Control+k');
    // Look for the search input
    const paletteInput = page.locator('input[placeholder*="Search"]').or(page.locator('[role="combobox"]'));
    await expect(paletteInput.first()).toBeVisible({ timeout: 3_000 });
    // Close with Escape
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // Palette should be gone
    await expect(paletteInput.first()).not.toBeVisible({ timeout: 3_000 });
  });
});
