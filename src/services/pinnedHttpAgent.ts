/**
 * Phase 11 Sprint 11.6c-sec — DNS-rebinding pinning for fetch().
 *
 * Closes the TOCTOU race between our hostname validation and undici's
 * connect-time DNS resolution. Without pinning, a DNS-rebinding
 * attacker can return a public IP when we call dns.lookup() (passes
 * the SSRF allowlist check), then return a private IP when undici
 * resolves the same hostname a few milliseconds later for the actual
 * connect(). Our safety check has been bypassed.
 *
 * With pinning, we resolve the hostname ONCE upstream
 * (urlFetch.assertHostAllowed), check every returned address against
 * the private-range denylist, and then pass a pre-validated address
 * to an undici Agent whose connect.lookup always returns THAT address
 * regardless of the hostname. The second DNS lookup never happens —
 * attacker's second answer is unreachable.
 *
 * Scope of pinning: per-request. Create a fresh Agent before each
 * fetch(), pass it via `dispatcher`, close it in finally. For urlFetch's
 * manual redirect loop, create a new agent per HOP because the hostname
 * (and therefore the validated address) changes. Re-using one agent
 * across hops would ignore the second hop's validation and send
 * traffic to the first hop's IP.
 *
 * Preservation of HTTPS guarantees: this override only affects DNS
 * resolution. SNI, Host header, and certificate validation all
 * continue to use the URL's original hostname. Pinning does NOT
 * weaken HTTPS security — it only prevents the attacker's second
 * DNS answer from being consulted.
 */

import { Agent } from 'undici';

export interface PinnedAddress {
  /** IPv4 or IPv6 literal (as returned by dns.lookup). */
  address: string;
  /** 4 or 6 — matches dns.lookup's `family` field. */
  family: 4 | 6;
}

/**
 * Create an undici Agent that uses `pinned.address` for every connect,
 * ignoring the hostname passed to the `lookup` callback.
 *
 * Caller contract:
 *   - Validate the address upstream (assertHostAllowed or equivalent)
 *     BEFORE creating the agent — this helper does not re-check.
 *   - Pass the agent as `dispatcher` to one or more fetch() calls,
 *     then `await agent.close()` when done (finally block).
 *   - For redirect chains where the hostname changes, create a new
 *     agent per hop.
 */
export function pinnedAgentForAddress(pinned: PinnedAddress): Agent {
  return new Agent({
    connect: {
      lookup: (_hostname: string, opts: any, cb: any) => {
        // Ignore the hostname — the caller has already validated
        // `pinned.address` and committed us to using it. DNS is
        // never consulted at connect time.
        //
        // Callback shape depends on opts.all: undici uses `all: true`
        // under the hood (it wants the full address list to iterate
        // through), so we must return an array of { address, family }
        // records, not the 3-arg shape used when all=false.
        if (opts && opts.all) {
          cb(null, [{ address: pinned.address, family: pinned.family }]);
        } else {
          cb(null, pinned.address, pinned.family);
        }
      },
    },
  });
}
