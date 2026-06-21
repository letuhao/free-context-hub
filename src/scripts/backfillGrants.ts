/**
 * Actor Data Boundary F2e — backfill grants from api_keys role/scope CLI.
 *
 *   npm run backfill:grants
 *
 * Synthesizes a covering grant for every active, principal-bound, non-root credential from its
 * (role, project_scope), so enabling enforcement can't lock existing callers out. Idempotent; a
 * no-op once every eligible credential already has a grant. Requires a root principal
 * (`npm run bootstrap:root` first). Run BEFORE enabling MCP_AUTH_ENABLED — assertEnforceReady gates
 * on countCredentialsWithoutGrants()===0.
 */
import * as dotenv from 'dotenv';
import { getDbPool } from '../db/client.js';
import { backfillGrantsFromApiKeys, countCredentialsWithoutGrants } from '../services/backfillGrants.js';

dotenv.config();

async function main() {
  const res = await backfillGrantsFromApiKeys();
  const remaining = await countCredentialsWithoutGrants();
  console.log(
    `[backfill:grants] scanned ${res.scanned} uncovered credential(s); minted ${res.created} grant(s), ` +
      `skipped ${res.skippedRevoked} deliberately-revoked + ${res.skipped} unmappable. ` +
      `${remaining} credential(s) still without a covering grant.` +
      (remaining === 0
        ? ' Grant coverage complete — enforce-ready on this gate.'
        : ' Re-grant or revoke the skipped credentials before enabling enforcement (backfill will not resurrect a revoked grant).'),
  );
}

main()
  .catch((err) => {
    console.error('[backfill:grants] failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getDbPool().end().catch(() => {});
  });
