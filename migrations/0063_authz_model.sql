-- Phase 15 Sprint 15.11 — authorization model (DEFERRED-015/016/017).
--
-- Wrapped in a single transaction by the migration runner
-- (src/db/applyMigrations.ts:40-43 — BEGIN/COMMIT per file, ROLLBACK on error),
-- so a failure of api_keys_active_name_uniq (duplicate active names) rolls back
-- the WHOLE file atomically. If that index fails: two active api_keys share a
-- name — revoke the duplicate (UPDATE api_keys SET revoked=true WHERE key_id=...)
-- then re-run.

-- A. Level-grant chain (015): audit who granted a participant's level.
ALTER TABLE topic_participants
  ADD COLUMN granted_by TEXT NULL;
COMMENT ON COLUMN topic_participants.granted_by IS
  'Sprint 15.11 — actor_id who granted this level (NULL for owner self-bootstrap / legacy rows). Audit + grant-chain provenance.';

-- B. Proxies (017 Q3): a principal authorizes a proxy to cast their ballot in a body.
CREATE TABLE proxies (
  body_id    UUID NOT NULL REFERENCES decision_bodies(body_id) ON DELETE CASCADE,
  principal  TEXT NOT NULL,
  proxy      TEXT NOT NULL,
  granted_by TEXT NOT NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (body_id, principal, proxy),
  CHECK (principal <> proxy)
);
CREATE INDEX proxies_proxy_idx ON proxies (body_id, proxy);
COMMENT ON TABLE proxies IS
  'Sprint 15.11 (DEFERRED-017 Q3) — proxy voting grants. principal authorizes proxy to cast on their behalf in body_id. castVote(proxy_for) verifies a row exists (auth-on).';

-- C. Key provisioning (016 / Q4): track who minted a key + enforce uniqueness.
ALTER TABLE api_keys
  ADD COLUMN created_by TEXT NULL;
COMMENT ON COLUMN api_keys.created_by IS
  'Sprint 15.11 — actor/operator who minted this key (apiKeyName of the admin caller, or NULL for legacy/env-token-minted). Per-operator key-count limit keys off this.';

-- Actor-identity uniqueness — at most one ACTIVE (non-revoked) key per name.
CREATE UNIQUE INDEX api_keys_active_name_uniq
  ON api_keys (name) WHERE revoked = false;
