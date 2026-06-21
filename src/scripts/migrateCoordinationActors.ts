/**
 * Actor Data Boundary F1f.3 — one-time data migration CLI.
 *
 *   npm run migrate:coordination-actors
 *
 * Rewrites legacy free-text coordination actor_ids onto imported principals. Idempotent; a no-op on
 * empty/already-migrated data. Run BEFORE enabling MCP_AUTH_ENABLED (assertEnforceReady gates on it).
 */
import * as dotenv from 'dotenv';
import { getDbPool } from '../db/client.js';
import { migrateCoordinationActorIds } from '../services/migrateCoordinationActors.js';

dotenv.config();

async function main() {
  const res = await migrateCoordinationActorIds();
  console.log(
    `[migrate:coordination-actors] imported ${res.imported} principal(s) for legacy actor strings; ` +
      `rewrote ${res.scalarColumns} scalar + ${res.arrayColumns} array columns. ` +
      (res.imported === 0 ? '(no-op — already principal-keyed)' : 'Bind credentials to the imported principals to act as them under auth-ON.'),
  );
}

main()
  .catch((err) => {
    console.error('[migrate:coordination-actors] failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDbPool().end().catch(() => {});
  });
