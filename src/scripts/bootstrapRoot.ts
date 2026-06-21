/**
 * Actor Data Boundary F1c — headless root bootstrap CLI.
 *
 *   ROOT_BOOTSTRAP_TOKEN=<secret> npm run bootstrap:root -- [display_name]
 *
 * Establishes the single out-of-band root principal and mints its credential, printed ONCE.
 * Idempotent: a no-op once a usable root credential exists; reissues if the root key was lost.
 * Possession is proven by running on the host that holds DATABASE_URL + ROOT_BOOTSTRAP_TOKEN.
 */
import * as dotenv from 'dotenv';
import { getDbPool } from '../db/client.js';
import { getEnv } from '../env.js';
import { bootstrapRoot, assertEnforceReady } from '../services/bootstrap.js';

dotenv.config();

async function main() {
  const token = getEnv().ROOT_BOOTSTRAP_TOKEN;
  if (!token) {
    console.error('[bootstrap:root] ROOT_BOOTSTRAP_TOKEN is not set. Set it in the environment and retry.');
    process.exitCode = 1;
    return;
  }
  const displayName = process.argv[2]?.trim() || 'root';

  const result = await bootstrapRoot({ presentedToken: token, display_name: displayName });

  if (result.status === 'noop') {
    console.log('[bootstrap:root] Root is already established with a usable credential. No-op.');
  } else {
    const verb = result.status === 'created' ? 'Established' : 'Reissued';
    console.log(`\n[bootstrap:root] ${verb} root principal ${result.principal.principal_id} (kind=${result.principal.kind}).`);
    console.log('  Root credential (shown ONCE — store it securely, then rotate ROOT_BOOTSTRAP_TOKEN):\n');
    console.log(`    ${result.key}\n`);
  }

  try {
    const root = await assertEnforceReady();
    console.log(`[bootstrap:root] enforce-ready: YES (root ${root.principal_id} has a usable credential).`);
    console.log('  You may now set MCP_AUTH_ENABLED=true and restart to enforce the boundary.');
  } catch (e) {
    console.log(`[bootstrap:root] enforce-ready: NO — ${(e as Error).message}`);
  }
}

main()
  .catch((err) => {
    console.error('[bootstrap:root] failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDbPool().end().catch(() => {});
  });
