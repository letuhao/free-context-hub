/**
 * Playwright test fixtures for E2E GUI tests.
 * Extends base test with shared setup: pre-flight check, screenshot dir, console error tracking.
 */

import { test as base, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SCREENSHOT_DIR = path.resolve('docs/qc/screenshots');

// Ensure screenshot directory exists
if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

export const test = base.extend<{
  consoleErrors: string[];
}>({
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

export { expect, SCREENSHOT_DIR };
