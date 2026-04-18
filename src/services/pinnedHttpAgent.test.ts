/**
 * Sprint 11.6c-sec — pinnedHttpAgent unit tests
 *
 * The load-bearing property we need to prove: a fetch() request whose
 * URL hostname would normally resolve to A instead lands on B when we
 * supply a pinned agent for B. This is what defeats DNS rebinding —
 * the attacker's second DNS answer can never be consulted if we've
 * committed to a specific IP.
 *
 * The test spins up a local HTTP server on 127.0.0.1:<random-port>
 * and fetches `http://fake-host.example.invalid:<port>/ping` with a
 * pinned agent pointed at 127.0.0.1. Without pinning, fetch() would
 * fail with an ENOTFOUND on `fake-host.example.invalid`. With pinning,
 * the request lands on the local server — proving connect bypassed
 * DNS entirely and used our pinned address.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import { once } from 'node:events';

import { pinnedAgentForAddress } from './pinnedHttpAgent.js';

/** Start a local HTTP server on 127.0.0.1 and return {url, close}. */
async function startLocalServer(handler: http.RequestListener): Promise<{
  port: number;
  close: () => Promise<void>;
}> {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no server address');
  return {
    port: addr.port,
    close: async () => {
      server.close();
      await once(server, 'close');
    },
  };
}

test('pinnedAgentForAddress', async (t) => {
  // The most important test: a fetch() to a hostname that has no DNS
  // record whatsoever MUST reach the pinned address. If connect.lookup
  // is being ignored (e.g. because we wired the Agent wrong), undici
  // falls back to global DNS and the request errors with ENOTFOUND.
  await t.test('fetch to a non-resolvable hostname lands on pinned IP', async () => {
    const srv = await startLocalServer((req, res) => {
      res.statusCode = 200;
      res.setHeader('content-type', 'text/plain');
      res.end(`received host: ${req.headers.host}`);
    });

    const agent = pinnedAgentForAddress({ address: '127.0.0.1', family: 4 });
    try {
      // .example.invalid is guaranteed non-resolvable per RFC 6761 / 2606
      const r = await fetch(`http://fake-host.example.invalid:${srv.port}/ping`, {
        dispatcher: agent,
      });
      assert.equal(r.status, 200);
      const body = await r.text();
      // The Host header must still reflect the URL's hostname — this
      // proves pinning touches ONLY DNS resolution, not HTTP semantics.
      assert.match(body, /fake-host\.example\.invalid/);
    } finally {
      await agent.close();
      await srv.close();
    }
  });

  // Fresh agent per test to confirm the override works with different
  // ports — catches any accidental singleton/cached state in the impl.
  await t.test('second pinned agent with a different port works independently', async () => {
    const srv = await startLocalServer((_req, res) => {
      res.statusCode = 200;
      res.end('pong');
    });

    const agent = pinnedAgentForAddress({ address: '127.0.0.1', family: 4 });
    try {
      const r = await fetch(`http://some-other-invalid.example.invalid:${srv.port}/`, {
        dispatcher: agent,
      });
      assert.equal(r.status, 200);
      assert.equal(await r.text(), 'pong');
    } finally {
      await agent.close();
      await srv.close();
    }
  });
});
