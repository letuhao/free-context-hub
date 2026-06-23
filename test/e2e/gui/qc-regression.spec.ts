/**
 * QC regression specs — lock in the bugs found during the v0.1.0 QC program so they
 * can never silently regress. Each test maps to a fixed defect or a verified security
 * property, exercised through the real GUI on the hardened (auth-ON) stack.
 *
 *   BUG-GUI-SEARCH (P1) — semantic lesson search read the wrong response key (`matches`)
 *                         and always showed "No semantic results". Commit b418a2a.
 *   ADV-13              — stored XSS in a lesson must render inert (escaped/sanitized).
 *   FIX-5 / W1          — an unauthenticated visitor must be redirected to /login?next=.
 *   GUI-07 / ADV-18     — guardrail simulate is server-evaluated and BLOCKS a risky action.
 *
 * Auth: the suite's global-setup logs in and shares a session storageState. API-side
 * seeding uses E2E_API_TOKEN (see fixtures.apiAuthHeaders).
 */

import { test, expect, apiAuthHeaders } from './fixtures.js';

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:3001';
const PROJECT_ID = 'free-context-hub';

/** Seed an ACTIVE lesson via the REST API (auth-aware). Returns its id. */
async function seedLesson(opts: { title: string; content: string; type?: string; tags?: string[] }): Promise<string> {
  const res = await fetch(`${API_BASE}/api/lessons`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...apiAuthHeaders() },
    body: JSON.stringify({
      project_id: PROJECT_ID,
      lesson_type: opts.type ?? 'decision',
      title: opts.title,
      content: opts.content,
      tags: opts.tags ?? ['e2e-qc-regression'],
    }),
  });
  if (!res.ok) throw new Error(`seedLesson failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  const id: string = body.lesson_id;
  // Distillation may land the lesson as draft; force active so semantic search (active-only) finds it.
  await fetch(`${API_BASE}/api/lessons/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...apiAuthHeaders() },
    body: JSON.stringify({ project_id: PROJECT_ID, status: 'active' }),
  }).catch(() => {});
  return id;
}

/** No hard-delete route exists; archive for cleanup (archived is excluded from search). */
async function deleteLesson(id: string) {
  await fetch(`${API_BASE}/api/lessons/${id}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...apiAuthHeaders() },
    body: JSON.stringify({ project_id: PROJECT_ID, status: 'archived' }),
  }).catch(() => {});
}

test.describe('QC regression', () => {
  test('BUG-GUI-SEARCH: semantic lesson search returns results (not "No semantic results")', async ({ page }) => {
    const marker = `qczzregress${Date.now()}`;
    const id = await seedLesson({
      title: `Regression marker ${marker}`,
      content: `This lesson exists so semantic search can find the unique token ${marker}.`,
      tags: ['e2e-qc-regression', marker],
    });
    try {
      await page.goto('/lessons');
      // Switch to Semantic mode, then search the unique marker.
      await page.getByRole('button', { name: 'Semantic' }).click();
      const box = page.getByPlaceholder('Search lessons...');
      await box.fill(marker);
      await box.press('Enter');

      // The fixed code reads result.matches; the bug showed this empty-state copy.
      await expect(page.getByText('No semantic results')).toHaveCount(0, { timeout: 15_000 });
      // And the seeded lesson surfaces by title.
      await expect(page.getByText(`Regression marker ${marker}`)).toBeVisible({ timeout: 15_000 });
    } finally {
      await deleteLesson(id);
    }
  });

  test('ADV-13: stored XSS in a lesson renders inert (no script execution)', async ({ page }) => {
    const id = await seedLesson({
      type: 'workaround',
      title: 'XSS regression <img src=x onerror="window.__e2e_xss=1">',
      content:
        'Body with <script>window.__e2e_xss=1</script> and a [bad link](javascript:window.__e2e_xss=1) ' +
        'plus an inline image. End.',
      tags: ['e2e-qc-regression', 'xss'],
    });
    try {
      let dialogFired = false;
      page.on('dialog', async (d) => { dialogFired = true; await d.dismiss(); });

      await page.goto(`/lessons/${id}`);
      // Heading (not the breadcrumb) — and it renders the payload as inert text.
      await expect(page.getByRole('heading', { name: /XSS regression/ }).first()).toBeVisible({ timeout: 15_000 });

      const result = await page.evaluate(() => {
        const main = document.querySelector('main') || document.body;
        return {
          xssFlag: Boolean((window as unknown as Record<string, unknown>).__e2e_xss),
          liveScripts: main.querySelectorAll('script').length,
          onerrorImgs: main.querySelectorAll('img[onerror]').length,
          jsLinks: [...main.querySelectorAll('a')].filter((a) =>
            (a.getAttribute('href') || '').toLowerCase().startsWith('javascript:'),
          ).length,
        };
      });

      expect(dialogFired).toBe(false);
      expect(result.xssFlag).toBe(false);
      expect(result.liveScripts).toBe(0);
      expect(result.onerrorImgs).toBe(0);
      expect(result.jsLinks).toBe(0);
    } finally {
      await deleteLesson(id);
    }
  });

  test('GUI-07/ADV-18: guardrail simulate server-blocks a risky action', async ({ page }) => {
    await page.goto('/guardrails');
    const box = page.getByPlaceholder('e.g. git push --force to main');
    await box.fill('git push --force to main');
    await page.getByRole('button', { name: 'Check' }).click();
    // Server-evaluated verdict surfaces as a BLOCKED result (verdict + Recent-Tests badge
    // both contain "BLOCKED" — .first() picks the verdict, avoiding strict-mode ambiguity).
    await expect(page.getByText(/BLOCKED/).first()).toBeVisible({ timeout: 15_000 });
  });
});

// Auth-gate runs WITHOUT the shared session — a fresh, unauthenticated context.
test.describe('QC regression — auth gate', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('FIX-5/W1: unauthenticated visitor is redirected to /login?next=', async ({ page }) => {
    await page.goto('/lessons');
    await page.waitForURL((url) => url.pathname.startsWith('/login'), { timeout: 15_000 });
    expect(page.url()).toContain('/login');
    // next= preserves the intended destination for post-login return.
    expect(decodeURIComponent(page.url())).toContain('next=/lessons');
  });
});
