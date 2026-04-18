/**
 * Phase 11 Sprint 11.6a — Knowledge Exchange GUI scenario
 *
 * One browser-layer test covering the export → download → upload →
 * import flow via the Project Settings Knowledge Exchange panel
 * shipped in Sprint 11.4. Proves the panel wires up correctly end-
 * to-end against the live stack.
 *
 * Flow:
 *   1. Seed two empty projects (src + dst) via the REST API
 *   2. Switch GUI to src via localStorage keys used by ProjectProvider
 *   3. Navigate to /projects/settings, scroll to the Exchange panel
 *   4. Click the Export link — capture the download event, save bundle
 *   5. Switch GUI to dst via localStorage + reload
 *   6. Navigate back to /projects/settings
 *   7. setInputFiles on the hidden <input type="file"> inside the dropzone
 *   8. Click "Preview (dry-run)" → assert result panel shows "Dry-run preview"
 *   9. Click "Apply" → assert result panel shows "Imported"
 *  10. Cleanup: DELETE both projects via admin API
 *
 * Data-level import correctness is covered by test/e2e/api/phase11-import.test.ts.
 * This browser test proves the panel wires up (download handler, dropzone
 * file input, preview + apply buttons, result banner). Empty projects are
 * sufficient — the export bundle still carries globally-scoped lesson_types,
 * so the zip is > 0 bytes even with no lessons. We deliberately skip lesson
 * creation here: the embedding request it triggers flakes under full-suite
 * load (same root cause as the Phase 10 flake), and the lesson isn't
 * load-bearing for this particular assertion.
 */

import { test, expect } from './fixtures.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const API_BASE = process.env.API_BASE_URL ?? 'http://localhost:3001';
const ADMIN_TOKEN =
  process.env.CONTEXT_HUB_WORKSPACE_TOKEN ??
  process.env.CONTEXTHUB_ADMIN_TOKEN ??
  'dev-token';

function authHeaders(): Record<string, string> {
  return ADMIN_TOKEN ? { Authorization: `Bearer ${ADMIN_TOKEN}` } : {};
}

async function createProject(projectId: string): Promise<void> {
  const r = await fetch(`${API_BASE}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ project_id: projectId, name: `phase11-exchange ${projectId}` }),
  });
  if (r.status !== 201 && r.status !== 409) {
    throw new Error(`createProject(${projectId}) HTTP ${r.status}`);
  }
}

async function deleteProject(projectId: string): Promise<void> {
  await fetch(`${API_BASE}/api/projects/${encodeURIComponent(projectId)}`, {
    method: 'DELETE',
    headers: authHeaders(),
  }).catch(() => {});
}

test.describe('Phase 11 — Knowledge Exchange GUI', () => {
  const runMarker = Date.now().toString(36);
  const srcProject = `sp116a-gui-src-${runMarker}`;
  const dstProject = `sp116a-gui-dst-${runMarker}`;
  let downloadedBundlePath: string | null = null;

  test.beforeAll(async () => {
    // Two empty projects are enough — the bundle still carries
    // lesson_types (globally exported) so the exported zip is > 0
    // bytes. We skip creating a lesson here because lesson creation
    // triggers an embedding request that flakes under full-suite
    // load; the data-level round-trip assertions live in
    // test/e2e/api/phase11-import.test.ts instead.
    await createProject(srcProject);
    await createProject(dstProject);
  });

  test.afterAll(async () => {
    if (downloadedBundlePath && fs.existsSync(downloadedBundlePath)) {
      fs.rmSync(downloadedBundlePath, { force: true });
    }
    await deleteProject(srcProject);
    await deleteProject(dstProject);
  });

  test('export src → upload into dst → Apply succeeds', async ({ page }) => {
    // 1. Switch GUI to src via localStorage — ProjectProvider reads these
    //    on mount. Must set BOTH the legacy single-project key and the
    //    newer selected-ids JSON array (context keeps them in sync).
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(([id]) => {
      localStorage.setItem('contexthub-project-id', id!);
      localStorage.setItem('contexthub-selected-project-ids', JSON.stringify([id]));
    }, [srcProject]);

    // 2. Navigate to Project Settings
    await page.goto('/projects/settings', { waitUntil: 'networkidle' });

    // 3. Knowledge Exchange section heading (lucide icons + text)
    const exchangeHeading = page.getByText('Knowledge Exchange', { exact: false });
    await expect(exchangeHeading).toBeVisible({ timeout: 10_000 });

    // 4. Export link — wire up the download handler BEFORE clicking.
    //    The panel uses an <a href=".../export" download> anchor.
    const exportLink = page.locator('a[href*="/export"]').first();
    await expect(exportLink).toBeVisible();

    const downloadPromise = page.waitForEvent('download', { timeout: 15_000 });
    await exportLink.click();
    const download = await downloadPromise;

    // Persist the download to a known temp path so we can setInputFiles
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'phase11-gui-'));
    downloadedBundlePath = path.join(tmpDir, 'bundle.zip');
    await download.saveAs(downloadedBundlePath);
    expect(fs.statSync(downloadedBundlePath).size).toBeGreaterThan(0);

    // 5. Switch project to dst and reload
    await page.evaluate(([id]) => {
      localStorage.setItem('contexthub-project-id', id!);
      localStorage.setItem('contexthub-selected-project-ids', JSON.stringify([id]));
    }, [dstProject]);

    await page.goto('/projects/settings', { waitUntil: 'networkidle' });
    await expect(page.getByText('Knowledge Exchange', { exact: false })).toBeVisible({
      timeout: 10_000,
    });

    // 6. The dropzone has a hidden <input type="file"> — setInputFiles
    //    targets it directly (works regardless of drag-drop vs click path).
    const fileInput = page.locator('input[type="file"][accept*="zip"]');
    await fileInput.setInputFiles(downloadedBundlePath);

    // 7. Preview (dry-run) first — should render the result panel
    //    with the "Dry-run preview" header.
    const previewBtn = page.getByRole('button', { name: /Preview.*dry-run/i });
    await expect(previewBtn).toBeEnabled({ timeout: 5_000 });
    await previewBtn.click();

    await expect(page.getByText('Dry-run preview', { exact: false })).toBeVisible({
      timeout: 15_000,
    });

    // 8. Apply for real — panel should swap to "Imported" header.
    //    (Self-pull: cross-tenant guard → skipped=1. applied=true from
    //    importProject's perspective because the transaction committed
    //    even though no lessons materialized in dst.)
    const applyBtn = page.getByRole('button', { name: /^Apply$/i });
    await expect(applyBtn).toBeEnabled();
    await applyBtn.click();

    // Two elements match: the header span (exact) and the toast
    // ("Imported — applied"). Pin to the exact header span.
    await expect(page.getByText('Imported', { exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });
});
