/**
 * Playwright test fixtures for E2E GUI tests.
 * Extends base test with shared setup: pre-flight check, screenshot dir, console error tracking.
 */

import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { CSRF_FILE, CSRF_STORAGE_KEY } from './global-setup.js';

const SCREENSHOT_DIR = path.resolve('docs/qc/screenshots');

/** The CSRF token captured at login (sessionStorage isn't carried by storageState). */
function capturedCsrf(): string | null {
  try {
    return JSON.parse(fs.readFileSync(CSRF_FILE, 'utf8')).csrf ?? null;
  } catch {
    return null;
  }
}

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

export const test = base.extend<{
  consoleErrors: string[];
}>({
  // Re-inject the login CSRF token into sessionStorage before any app code runs, so
  // cookie-authed mutations (POST/PATCH) carry X-CSRF-Token instead of 403-ing.
  page: async ({ page }, use) => {
    const csrf = capturedCsrf();
    if (csrf) {
      await page.addInitScript(
        ([key, token]) => {
          try {
            sessionStorage.setItem(key, token);
          } catch {
            /* sessionStorage unavailable — ignore */
          }
        },
        [CSRF_STORAGE_KEY, csrf] as const,
      );
    }
    await use(page);
  },
  consoleErrors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        const text = msg.text();
        // Ignore common non-critical errors
        if (text.includes('favicon') || text.includes('hydration')) return;
        errors.push(text);
      }
    });
    await use(errors);
  },
});

/**
 * Auth headers for API-side test-data seeding against the hardened (auth-ON) stack.
 * The seeding helpers POST directly to the REST API (not through the browser session),
 * so they need a Bearer token. Provide one via E2E_API_TOKEN (a scoped/admin api_keys
 * token). On an auth-OFF stack leave it unset — helpers send no Authorization header.
 */
export function apiAuthHeaders(): Record<string, string> {
  // Prefer the api_keys Bearer token. NOTE: the legacy single-shared
  // CONTEXT_HUB_WORKSPACE_TOKEN is intentionally NOT used — it is disabled on the
  // hardened stack (MCP_LEGACY_TOKEN_DISABLED=true) and would 401.
  const token = process.env.E2E_API_TOKEN ?? process.env.CONTEXTHUB_ADMIN_TOKEN;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export { expect, SCREENSHOT_DIR };
