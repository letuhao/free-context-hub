/**
 * Actor Data Boundary F2g — headless system-worker bootstrap CLI.
 *
 *   npm run bootstrap:system -- [display_name]
 *
 * Establishes the single non-root system-worker principal the background worker authenticates as,
 * and mints its one `global write` grant (granted by root). Idempotent: a no-op once a usable system
 * identity exists. Requires root to exist first (`npm run bootstrap:root`). Run on the host that holds
 * DATABASE_URL. No secret is printed — the worker authenticates as the principal, not via a key.
 */
import * as dotenv from 'dotenv';
import { getDbPool } from '../db/client.js';
import { bootstrapSystem, assertEnforceReady } from '../services/bootstrap.js';

dotenv.config();

async function main() {
  const displayName = process.argv[2]?.trim() || 'system-worker';

  const result = await bootstrapSystem({ display_name: displayName });

  if (result.status === 'noop') {
    console.log('[bootstrap:system] System-worker identity already established and usable. No-op.');
  } else {
    const verb = result.status === 'created' ? 'Established' : 'Granted';
    console.log(
      `\n[bootstrap:system] ${verb} system-worker principal ${result.principal.principal_id} ` +
        `(kind=${result.principal.kind}, is_root=false) with a global write grant.`,
    );
  }

  try {
    const root = await assertEnforceReady();
    console.log(`[bootstrap:system] enforce-ready: YES (root ${root.principal_id} + system-worker identity usable).`);
    console.log('  You may now set MCP_AUTH_ENABLED=true and restart to enforce the boundary.');
  } catch (e) {
    console.log(`[bootstrap:system] enforce-ready: NO — ${(e as Error).message}`);
  }
}

main()
  .catch((err) => {
    console.error('[bootstrap:system] failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDbPool().end().catch(() => {});
  });
