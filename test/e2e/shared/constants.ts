/**
 * Shared constants for all E2E test categories.
 * All configurable via environment variables with sensible defaults.
 */

export const API_BASE = process.env.API_BASE_URL?.trim() || 'http://localhost:3001';
export const MCP_URL = process.env.MCP_SERVER_URL?.trim() || 'http://localhost:3000/mcp';
export const GUI_URL = process.env.GUI_URL?.trim() || 'http://localhost:3002';
export const E2E_PROJECT_ID = process.env.E2E_PROJECT_ID?.trim() || 'e2e-test-project';
export const ADMIN_TOKEN = process.env.CONTEXT_HUB_WORKSPACE_TOKEN?.trim() || '';

/** Unique marker for this test run — used in titles/content to avoid collisions. */
export const RUN_MARKER = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
