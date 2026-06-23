/**
 * Playwright global setup — authenticate once against the hardened (auth-ON) stack
 * and persist the session storageState for every spec.
 *
 * The committed stack is auth-ON (DEPLOYMENT_PROFILE=production), so every page redirects
 * to /login until a session cookie exists. We log in through the real /login form (which
 * handles the CSRF handshake) as a pre-provisioned operator, then save the cookie jar.
 *
 * Required env (no secrets in the repo):
 *   E2E_LOGIN_EMAIL    — operator email (default qc-operator@local.test)
 *   E2E_LOGIN_PASSWORD — operator password (REQUIRED; no default)
 * Optional:
 *   GUI_URL            — base URL (default http://localhost:3002)
 *
 * For auth-OFF dev stacks, set E2E_AUTH_DISABLED=1 to skip login (storageState is written
 * empty so specs still run).
 */

import { chromium, type FullConfig } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

export const STORAGE_STATE = path.resolve('test/e2e/gui/.auth/state.json');
// The double-submit CSRF token lives in sessionStorage (ch_csrf_token), which storageState
// does NOT persist. Capture it here so a fixture can re-inject it before each test —
// otherwise every cookie-authed mutation (POST/PATCH) 403s with "CSRF token missing".
export const CSRF_FILE = path.resolve('test/e2e/gui/.auth/csrf.json');
export const CSRF_STORAGE_KEY = 'ch_csrf_token';

export default async function globalSetup(_config: FullConfig) {
  const baseURL = process.env.GUI_URL ?? 'http://localhost:3002';
  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true });

  if (process.env.E2E_AUTH_DISABLED === '1') {
    fs.writeFileSync(STORAGE_STATE, JSON.stringify({ cookies: [], origins: [] }));
    fs.writeFileSync(CSRF_FILE, JSON.stringify({ csrf: null }));
    return;
  }

  const email = process.env.E2E_LOGIN_EMAIL ?? 'qc-operator@local.test';
  const password = process.env.E2E_LOGIN_PASSWORD;
  if (!password) {
    throw new Error(
      'E2E_LOGIN_PASSWORD is required for authenticated e2e against the hardened stack. ' +
        'Set it (and optionally E2E_LOGIN_EMAIL), or set E2E_AUTH_DISABLED=1 for an auth-OFF stack.',
    );
  }

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${baseURL}/login`, { waitUntil: 'networkidle' });
    await page.fill('#email', email);
    await page.fill('#password', password);
    await page.click('button[type=submit]');
    // Login success navigates away from /login (honors ?next=, defaults to /).
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 15_000 });
    await page.context().storageState({ path: STORAGE_STATE });
    // Capture the CSRF token the login flow stored in sessionStorage.
    const csrf = await page.evaluate((k) => sessionStorage.getItem(k), CSRF_STORAGE_KEY);
    fs.writeFileSync(CSRF_FILE, JSON.stringify({ csrf }));
  } finally {
    await browser.close();
  }
}
