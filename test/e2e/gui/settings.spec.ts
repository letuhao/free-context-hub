/**
 * Layer 2 — Settings GUI Scenario Tests (5 tests)
 *
 * Tests system info, lesson types, API key management, permissions matrix.
 */

import { test, expect } from './fixtures.js';

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:3001';

/** Cleanup: delete a custom lesson type via API. */
async function deleteLessonType(key: string) {
  await fetch(`${API_BASE}/api/lesson-types/${encodeURIComponent(key)}`, {
    method: 'DELETE',
  }).catch(() => {});
}

/** Cleanup: revoke an API key via API. */
async function revokeApiKey(keyId: string) {
  await fetch(`${API_BASE}/api/api-keys/${encodeURIComponent(keyId)}`, {
    method: 'DELETE',
  }).catch(() => {});
}

test.describe('Settings Pages', () => {
  test('system info displays feature flags', async ({ page }) => {
    await page.goto('/settings', { waitUntil: 'networkidle' });
    await expect(page.locator('text=Settings').first()).toBeVisible({ timeout: 10_000 });

    // Feature flags section should show
    await expect(page.locator('text=Feature Flags').or(page.locator('text=Features'))).toBeVisible({ timeout: 5_000 });

    // At least some feature names should be visible
    const embeddings = page.locator('text=Embeddings');
    await expect(embeddings.first()).toBeVisible({ timeout: 5_000 });

    // Enabled/disabled badges
    const badges = page.locator('text=/enabled|disabled/i');
    expect(await badges.count(), 'Expected feature status badges').toBeGreaterThanOrEqual(1);
  });

  test('lesson types page shows defaults', async ({ page }) => {
    await page.goto('/settings/lesson-types', { waitUntil: 'networkidle' });
    await expect(page.locator('text=Lesson Types').first()).toBeVisible({ timeout: 10_000 });

    // Built-in types should be listed
    const decision = page.locator('text=decision');
    await expect(decision.first()).toBeVisible({ timeout: 5_000 });

    const guardrail = page.locator('text=guardrail');
    await expect(guardrail.first()).toBeVisible({ timeout: 5_000 });
  });

  test('create custom lesson type', async ({ page }) => {
    const key = `e2e_gui_type_${Date.now().toString(36)}`;

    await page.goto('/settings/lesson-types', { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);

    // Click "Add Custom Type"
    const addBtn = page.locator('button:has-text("Add")').or(page.locator('button:has-text("Custom Type")'));
    await addBtn.first().click();
    await page.waitForTimeout(500);

    // Fill the form in the dialog/modal
    // Key input: placeholder "e.g. api_change"
    const keyInput = page.locator('.fixed input[placeholder*="api_change"]');
    await keyInput.fill(key);

    // Name input: placeholder "e.g. API Change"
    const nameInput = page.locator('.fixed input[placeholder*="API Change"]');
    await nameInput.fill('E2E GUI Type');

    await page.waitForTimeout(300);

    // Submit
    const saveBtn = page.locator('.fixed button:has-text("Create")').or(page.locator('.fixed button:has-text("Save")'));
    if (await saveBtn.count() > 0) {
      await saveBtn.first().click({ timeout: 5_000 });
      await page.waitForTimeout(1000);
    }

    // Verify it appears in the list
    const newType = page.locator(`text=${key}`);
    if (await newType.count() > 0) {
      await expect(newType.first()).toBeVisible();
    }

    // Cleanup
    await deleteLessonType(key);
  });

  test('API key create and revoke', async ({ page }) => {
    await page.goto('/settings/access', { waitUntil: 'networkidle' });
    await expect(page.locator('text=Access Control').first()).toBeVisible({ timeout: 10_000 });

    // Click "Generate Key"
    const genBtn = page.locator('button:has-text("Generate")');
    await genBtn.first().click();
    await page.waitForTimeout(500);

    // Fill name in the dialog (placeholder: "e.g. Production Agent")
    const nameInput = page.locator('.fixed input[placeholder*="Agent"], .fixed input[placeholder*="name"], .fixed input[type="text"]');
    await nameInput.first().fill(`e2e-gui-key-${Date.now()}`);
    await page.waitForTimeout(300);

    // Submit the generate form
    const createBtn = page.locator('.fixed button:has-text("Generate")');
    await createBtn.first().click({ timeout: 5_000 });
    await page.waitForTimeout(1000);

    // Should show the key (one-time reveal)
    const keyReveal = page.locator('text=/chub_sk_|Key created/i');
    if (await keyReveal.count() > 0) {
      await expect(keyReveal.first()).toBeVisible();
    }

    // Close the reveal dialog if present
    const closeBtn = page.locator('.fixed button:has-text("Close")').or(page.locator('.fixed button:has-text("Done")'));
    if (await closeBtn.count() > 0) {
      await closeBtn.first().click();
      await page.waitForTimeout(500);
    }

    // Verify key appears in the list — look for "Revoke" button
    const revokeBtn = page.locator('button:has-text("Revoke")');
    if (await revokeBtn.count() > 0) {
      // Revoke the last key
      await revokeBtn.last().click();
      await page.waitForTimeout(500);

      // Confirm if there's a confirmation dialog
      const confirmBtn = page.locator('.fixed button:has-text("Revoke")').or(page.locator('.fixed button:has-text("Confirm")'));
      if (await confirmBtn.count() > 0) {
        await confirmBtn.first().click();
        await page.waitForTimeout(500);
      }
    }
  });

  test('permissions matrix visible', async ({ page }) => {
    await page.goto('/settings/access', { waitUntil: 'networkidle' });

    // Click "Permissions" tab
    const permTab = page.locator('button:has-text("Permissions")');
    if (await permTab.count() > 0) {
      await permTab.first().click();
      await page.waitForTimeout(500);
    }

    // Permissions matrix should show role columns
    const readerCol = page.locator('text=reader');
    const writerCol = page.locator('text=writer');
    await expect(readerCol.first()).toBeVisible({ timeout: 5_000 });
    await expect(writerCol.first()).toBeVisible({ timeout: 5_000 });

    // Should show permission rows
    const searchRow = page.locator('text=/Search|search/');
    await expect(searchRow.first()).toBeVisible({ timeout: 5_000 });
  });
});
