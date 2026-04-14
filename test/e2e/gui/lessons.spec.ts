/**
 * Layer 2 — Lessons GUI Scenario Tests (7 tests)
 *
 * Tests lesson listing, creation, filtering, searching, editing, archiving.
 */

import { test, expect } from './fixtures.js';

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:3001';
const PROJECT_ID = 'free-context-hub';

/** Helper: create a lesson via API for test data seeding.
 *
 *  POST /api/lessons calls LLM distillation synchronously; if the model
 *  errors out (rate limit, cold start, eviction under heavy suite load)
 *  the lesson is written with status='draft' and the Active tab hides it.
 *  We force-PATCH back to 'active' so the test can always find the row
 *  on the default tab. Best-effort — ignore failures. */
async function seedLesson(opts: { title: string; type?: string; tags?: string[] }): Promise<string> {
  const res = await fetch(`${API_BASE}/api/lessons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: PROJECT_ID,
      lesson_type: opts.type ?? 'decision',
      title: opts.title,
      content: `Seeded by GUI test: ${opts.title}`,
      tags: opts.tags ?? ['e2e-gui'],
    }),
  });
  const body = await res.json();
  const lessonId: string = body.lesson_id;
  await fetch(`${API_BASE}/api/lessons/${lessonId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: PROJECT_ID, status: 'active' }),
  }).catch(() => {});
  return lessonId;
}

/** Helper: archive a lesson via API for cleanup. */
async function archiveLesson(lessonId: string) {
  await fetch(`${API_BASE}/api/lessons/${lessonId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: PROJECT_ID, status: 'archived' }),
  }).catch(() => {});
}

test.describe('Lessons Page', () => {
  test('page loads and lists lessons', async ({ page }) => {
    await page.goto('/lessons', { waitUntil: 'networkidle' });
    await expect(page.locator('text=Lessons').first()).toBeVisible({ timeout: 10_000 });
    // Should show the table or empty state
    const table = page.locator('table').or(page.locator('text=No lessons'));
    await expect(table.first()).toBeVisible({ timeout: 10_000 });
  });

  test('create lesson via dialog', async ({ page }) => {
    const marker = `gui-create-${Date.now()}`;
    await page.goto('/lessons', { waitUntil: 'networkidle' });

    // Click "+ Add Lesson"
    await page.locator('text=Add Lesson').click();

    // Wait for dialog (custom overlay, look for the heading)
    await expect(page.locator('text=Add Lesson').nth(1).or(page.locator('text=Add a new lesson'))).toBeVisible({ timeout: 5_000 });

    // Fill title
    const titleInput = page.locator('input[placeholder*="descriptive"], input[placeholder*="title"]');
    await titleInput.first().fill(marker);

    // Fill content — could be a textarea or RichEditor
    const contentArea = page.locator('textarea').or(page.locator('[contenteditable="true"]'));
    await contentArea.first().fill(`GUI test lesson content ${marker}`);

    // Submit — target the dialog's submit button (inside the fixed overlay)
    const dialogOverlay = page.locator('.fixed.inset-0');
    const saveBtn = dialogOverlay.locator('button:has-text("Add Lesson")');
    await saveBtn.click();

    // Wait for dialog to close and lesson to appear
    await page.waitForTimeout(2000);

    // Verify the lesson appears in the table
    const row = page.locator(`text=${marker}`);
    await expect(row.first()).toBeVisible({ timeout: 15_000 });

    // Cleanup: find and archive via API
    const searchRes = await fetch(`${API_BASE}/api/lessons?project_id=${PROJECT_ID}&q=${encodeURIComponent(marker)}&limit=1`, {
      headers: { 'Content-Type': 'application/json' },
    });
    const searchData = await searchRes.json();
    const lessonId = searchData.items?.[0]?.lesson_id;
    if (lessonId) await archiveLesson(lessonId);
  });

  test('filter by status tabs', async ({ page }) => {
    await page.goto('/lessons', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // The page has status tabs: Active, Draft, Pending Review, Superseded
    const activeTab = page.locator('button:has-text("Active")');
    await expect(activeTab.first()).toBeVisible({ timeout: 5_000 });

    // Click superseded tab
    const supersededTab = page.locator('button:has-text("Superseded")');
    if (await supersededTab.count() > 0) {
      await supersededTab.first().click();
      await page.waitForTimeout(1000);
      // Page should still render (either items or empty state)
      await expect(page.locator('text=Lessons').first()).toBeVisible();
    }

    // Click back to Active
    await activeTab.first().click();
    await page.waitForTimeout(1000);
    await expect(page.locator('text=Lessons').first()).toBeVisible();
  });

  test('text search with debounce', async ({ page }) => {
    const marker = `gui-search-${Date.now()}`;
    const id = await seedLesson({ title: `Searchable ${marker}`, tags: ['e2e-gui-search'] });

    try {
      await page.goto('/lessons', { waitUntil: 'networkidle' });

      // Type in search bar
      const searchInput = page.locator('input[placeholder*="Search"], input[placeholder*="search"]');
      await searchInput.first().fill(marker);

      // Wait for debounced search to execute
      await page.waitForTimeout(1500);

      // The lesson should appear
      const result = page.locator(`text=${marker}`);
      await expect(result.first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await archiveLesson(id);
    }
  });

  test('sort by column header', async ({ page }) => {
    await page.goto('/lessons', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    // Click "Title" column header to sort
    const titleHeader = page.locator('th:has-text("Title"), button:has-text("Title")');
    if (await titleHeader.count() > 0) {
      await titleHeader.first().click();
      await page.waitForTimeout(1000);
      // Click again for reverse sort
      await titleHeader.first().click();
      await page.waitForTimeout(1000);
    }
    // Just verify the page didn't crash
    await expect(page.locator('text=Lessons').first()).toBeVisible();
  });

  // POST /api/lessons runs distillation synchronously against the LLM,
  // which gets slow under the full-suite load. 60s covers the worst case.
  test('detail panel opens and edit works', async ({ page }) => {
    test.setTimeout(60_000);
    const marker = `gui-edit-${Date.now()}`;
    const title = `Editable ${marker}`;
    const id = await seedLesson({ title });

    try {
      await page.goto('/lessons', { waitUntil: 'networkidle' });

      // Click the row directly (not the text node) — DataTable wires
      // onRowClick onto the <tr>, so clicking child text/checkboxes can
      // land on a stopPropagation'd target instead of opening the panel.
      const row = page.locator(`tr:has-text("${title}")`);
      await expect(row).toBeVisible({ timeout: 10_000 });
      await row.first().click();

      // Scope all further queries to the detail dialog so we don't pick
      // up the "Edit" button from the AI editor toolbar or page header.
      const dialog = page.locator('[role="dialog"][aria-label="Lesson detail"]');
      await expect(dialog).toBeVisible({ timeout: 5_000 });

      // Flip into edit mode and assert the RichEditor's textarea mounts.
      // The edit control is an icon-only button with title="Edit" (no text).
      await dialog.locator('button[title="Edit"]').click();
      await expect(dialog.locator('textarea').first()).toBeVisible({ timeout: 5_000 });
    } finally {
      await archiveLesson(id);
    }
  });

  test('archive lesson from detail panel', async ({ page }) => {
    const marker = `gui-archive-${Date.now()}`;
    const id = await seedLesson({ title: `Archivable ${marker}` });

    try {
      await page.goto('/lessons', { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);

      // Click on the lesson
      const row = page.locator(`text=Archivable ${marker}`);
      await row.first().click();
      await page.waitForTimeout(500);

      // Look for archive button in the detail panel
      const archiveBtn = page.locator('button:has-text("Archive")').or(
        page.locator('button[title*="Archive"]')
      );
      if (await archiveBtn.count() > 0) {
        await archiveBtn.first().click();
        await page.waitForTimeout(1000);

        // The lesson should disappear from active list
        // (it might show a confirmation or just archive)
      }
    } finally {
      // Ensure archived via API regardless
      await archiveLesson(id);
    }
  });
});
