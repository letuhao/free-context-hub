-- Actor Data Boundary F1c — bootstrap provenance marker for the root credential.
--
-- Wrapped in a single transaction by the migration runner.
--
-- validateApiKey FAILS CLOSED on root-bound keys (F1b) so no errant row can silently mint a root
-- credential through the general path. The LEGITIMATE root credential is minted only by the
-- out-of-band bootstrap (createBootstrapRootKey), which sets is_bootstrap=true. validateApiKey then
-- relaxes to `(p.is_root = false OR k.is_bootstrap)` — a root-bound key authenticates ONLY when it
-- carries this provenance marker. The marker is never settable through createApiKey (the public path).

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS is_bootstrap BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN api_keys.is_bootstrap IS
  'Actor Data Boundary F1c — true only for the out-of-band bootstrap-minted root credential. Set exclusively by createBootstrapRootKey; never via the public createApiKey path. validateApiKey requires it for any root-bound key to authenticate.';

-- At most ONE live (non-revoked) bootstrap credential per principal. Backstops the atomic rotation
-- in createBootstrapRootKey so a reissue race can never leave two simultaneously-valid root secrets.
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_one_live_bootstrap_per_principal
  ON api_keys (principal_id) WHERE is_bootstrap = true AND revoked = false;
