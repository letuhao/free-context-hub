-- DEFERRED-060 A4 — bound the hard lock as an account-DoS vector with an OPTIONAL auto-expiry.
--
-- The hard lock (OWASP ASVS V6) was sticky: ~10 bad passwords locked a known email until an admin or a
-- password reset cleared it — an account-DoS an attacker can trigger against any address they know. This
-- adds an optional expiry: a hard lock set while AUTH_LOCKOUT_HARD_DURATION_SECONDS > 0 carries a
-- hard_locked_until and self-clears once now() passes it (a successful login afterward fully resets the
-- lock). NULL preserves the original PERMANENT semantics (admin/reset-only), so pre-existing locked rows
-- AND the duration=0 configuration are unchanged. The expiry is stamped ONCE at the lock transition (not
-- refreshed by later failures), so an attacker who keeps hammering can't extend the lock indefinitely.
ALTER TABLE human_credentials ADD COLUMN IF NOT EXISTS hard_locked_until TIMESTAMPTZ NULL;

COMMENT ON COLUMN human_credentials.hard_locked_until IS
  'Optional hard-lock expiry (DEFERRED-060 A4). NULL = permanent (admin/reset-only). When set, the hard lock self-clears once now() passes it; stamped once at lock transition from AUTH_LOCKOUT_HARD_DURATION_SECONDS.';
