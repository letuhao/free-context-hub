/**
 * Phase 11 Sprint 11.5 — Cross-instance project pull.
 *
 * Fetches a full project bundle from a remote ContextHub instance and
 * applies it locally via importProject(). Thin orchestrator — all
 * correctness concerns (FK order, conflict policy, transactional
 * apply, cross-tenant guard) live in importProject.
 *
 * Pipeline (in order):
 *   - Validate remote URL: parseable by WHATWG URL, scheme in {http, https}
 *   - Validate remote_project_id: length cap
 *   - Validate api_key: allow-list visible-ASCII before header construction
 *   - SSRF guard via assertHostAllowed (reused from urlFetch.ts — rejects
 *     loopback / RFC1918 / link-local / CGNAT / multicast / reserved,
 *     plus IPv6 equivalents). Test-mode bypass via
 *     ALLOW_PRIVATE_FETCH_FOR_TESTS lets the self-pull integration test
 *     target loopback.
 *   - GET <origin>/api/projects/<remote_project_id>/export with optional
 *     Bearer api_key. redirect=manual — we don't chase 3xx because every
 *     hop would need its own SSRF check and the remote /export never
 *     emits a redirect in practice.
 *   - Timeout discipline: a setTimeout-backed AbortController fires if the
 *     response headers haven't arrived within FETCH_TIMEOUT_MS. The timer
 *     is cleared once we have a Response, so body drain is bounded by
 *     MAX_BUNDLE_BYTES (the ByteCounter transform aborts at 500 MB)
 *     rather than by a wall clock — otherwise a legitimate 500 MB pull
 *     over a slow link would be aborted mid-stream.
 *   - Stream body to a temp file via node:stream.pipeline(resp.body,
 *     ByteCounter, createWriteStream).
 *   - Hand off to importProject({ bundlePath: tmpPath, ... }).
 *   - finally: best-effort unlink + rmdir of the temp file / directory.
 *
 * Returns an ImportResult superset with a `remote` field (url +
 * project_id + bytes_fetched).
 *
 * Idempotent under repeat pulls because UUIDs are preserved in the
 * bundle and policy=skip is the default on the import side.
 *
 * Known limitations (remaining after Sprint 11.6c-sec):
 *   - No bundle caching. Repeat pulls of the same remote bundle re-fetch
 *     every time.
 *   - No GUI — pull is API-only for now (Sprint 11.4 shipped export /
 *     import in the Knowledge Exchange panel).
 *
 * Fixed in Sprint 11.6c-sec:
 *   - Body-stall timeout (StallTransform with BODY_STALL_MS idle timer)
 *     now defends against slow-loris drip-feeding.
 *   - DNS rebinding TOCTOU closed via pinnedHttpAgent — the address
 *     validated by assertHostAllowed is the exact IP undici connects
 *     to; no second DNS lookup can happen.
 */

import { promises as fs, createWriteStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

import { assertHostAllowed, UrlFetchError } from '../urlFetch.js';
import { pinnedAgentForAddress } from '../pinnedHttpAgent.js';
import {
  importProject,
  type ImportResult,
  type ConflictPolicy,
} from './importProject.js';
import { createModuleLogger } from '../../utils/logger.js';

const logger = createModuleLogger('pull-from-remote');

/** Matches the /api/projects/:id/import multer cap. A pull is equivalent
 *  to uploading the same bundle to /import, so the ceiling should be
 *  the same. */
export const MAX_BUNDLE_BYTES = 500 * 1024 * 1024;

/** Connect + headers timeout. Cleared once the response returns, so
 *  body drain is bounded by MAX_BUNDLE_BYTES rather than a wall clock.
 *  Otherwise a 500 MB bundle over a 5 Mbps link (~13 min) would abort
 *  mid-stream. Same pattern urlFetch.ts uses. */
export const FETCH_TIMEOUT_MS = 60_000;

/** Per-chunk idle timeout for the streamed response body. Resets on
 *  every chunk received from the remote. Fires if NO data arrives for
 *  this long — the slow-loris defense. Sized to match
 *  FETCH_TIMEOUT_MS so the "connect takes N seconds" budget and
 *  "no-progress takes N seconds" budget are consistent. */
export const BODY_STALL_MS = 60_000;

export type PullErrorCode =
  | 'invalid_url'
  | 'invalid_api_key'
  | 'invalid_project_id'
  | 'bad_scheme'
  | 'ssrf_blocked'
  | 'unreachable'
  | 'timeout'
  | 'upstream_error'
  | 'bad_content_type'
  | 'too_large';

/** Allow-list for api_key characters: visible ASCII + HTAB. RFC 7230 would
 *  permit more (obs-text 0x80-0xFF), but real API keys are alphanumeric +
 *  simple punctuation, and an allow-list closes the window where undici
 *  might reject a byte we didn't block and echo it in the TypeError message.
 *  The credential-echo risk is what motivates pre-validation: fetch() throws
 *  a TypeError whose .message includes the raw header value, which would
 *  otherwise flow through our catch → PullError → 502 JSON response. */
const API_KEY_ALLOWED_RE = /^[\x20-\x7E\t]+$/;

/** Cap on remoteProjectId length. A 10 KB id doesn't exploit anything
 *  but blows past URL length limits and creates noisy logs. */
const MAX_PROJECT_ID_LENGTH = 256;

export class PullError extends Error {
  constructor(
    public readonly code: PullErrorCode,
    message: string,
    public readonly httpStatus: number,
  ) {
    super(`[${code}] ${message}`);
    this.name = 'PullError';
  }
}

export interface PullFromRemoteOptions {
  /** Target project on THIS instance (from the URL param). */
  targetProjectId: string;
  /** Base URL of the remote ContextHub, e.g. `https://peer.example.com`. */
  remoteUrl: string;
  /** Project id on the remote instance. */
  remoteProjectId: string;
  /** Optional Bearer token for the remote's auth middleware. */
  apiKey?: string;
  policy?: ConflictPolicy;
  dryRun?: boolean;
  conflictsCap?: number;
}

export interface PullFromRemoteResult extends ImportResult {
  remote: {
    url: string;
    project_id: string;
    bytes_fetched: number;
  };
}

/** Counts bytes flowing through and errors out when the running total
 *  exceeds `maxBytes`. Using a Transform (not a Writable) lets
 *  pipeline() wire us between the fetch stream and the file sink. */
class ByteCounter extends Transform {
  bytes = 0;
  constructor(private readonly maxBytes: number) {
    super();
  }
  _transform(
    chunk: Buffer,
    _enc: BufferEncoding,
    cb: (err?: Error | null, data?: Buffer) => void,
  ) {
    this.bytes += chunk.length;
    if (this.bytes > this.maxBytes) {
      cb(new PullError('too_large', `bundle exceeded ${this.maxBytes} bytes`, 413));
      return;
    }
    cb(null, chunk);
  }
}

/** Slow-loris defense: a body-stall timer that resets on every chunk
 *  passing through and fires if NO chunk arrives for `ms` milliseconds.
 *  Without this, a malicious remote can keep a connection open
 *  indefinitely by drip-feeding the body under our byte cap, tying up
 *  the import worker. Armed in the constructor so it also catches the
 *  case where the first chunk never arrives after the headers returned.
 *
 *  Exported for unit testing — the 60s production timeout is too long
 *  to exercise in a CI test run, so tests construct with a small ms. */
export class StallTransform extends Transform {
  private timer: NodeJS.Timeout | undefined;
  constructor(private readonly ms: number) {
    super();
    this.armTimer();
  }
  private armTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.destroy(
        new PullError('timeout', `body stalled for ${this.ms}ms without data`, 504),
      );
    }, this.ms);
  }
  _transform(
    chunk: Buffer,
    _enc: BufferEncoding,
    cb: (err?: Error | null, data?: Buffer) => void,
  ) {
    this.armTimer();
    cb(null, chunk);
  }
  _flush(cb: (err?: Error | null) => void) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    cb();
  }
  // _destroy runs when the stream is destroyed (upstream error, abort,
  // etc.). Without clearing the timer here it'd fire later against an
  // already-destroyed stream — harmless in practice but leaks a pending
  // setTimeout until the ms elapse.
  _destroy(err: Error | null, cb: (err: Error | null) => void) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    cb(err);
  }
}

export async function pullFromRemote(
  opts: PullFromRemoteOptions,
): Promise<PullFromRemoteResult> {
  // Validate remote_url
  let parsed: URL;
  try {
    parsed = new URL(opts.remoteUrl);
  } catch {
    throw new PullError('invalid_url', `malformed remote_url: ${opts.remoteUrl}`, 400);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new PullError('bad_scheme', `unsupported scheme ${parsed.protocol}`, 400);
  }

  // Validate remote_project_id — length cap + (downstream) encodeURIComponent
  // covers path traversal / url injection attempts.
  if (opts.remoteProjectId.length > MAX_PROJECT_ID_LENGTH) {
    throw new PullError(
      'invalid_project_id',
      `remote_project_id exceeds ${MAX_PROJECT_ID_LENGTH} chars`,
      400,
    );
  }

  // Validate api_key — allow-list visible-ASCII + HTAB before constructing
  // the Authorization header. Prevents undici's TypeError from echoing the
  // raw credential back through our error response path.
  if (opts.apiKey !== undefined && !API_KEY_ALLOWED_RE.test(opts.apiKey)) {
    throw new PullError(
      'invalid_api_key',
      'api_key contains characters outside visible ASCII',
      400,
    );
  }

  // SSRF guard + DNS-rebinding pinning (Sprint 11.6c-sec). The resolved
  // address is passed to pinnedAgentForAddress so undici uses that exact
  // IP for connect — the second DNS lookup that used to enable the
  // rebinding attack never happens.
  let pinned;
  try {
    pinned = await assertHostAllowed(parsed.hostname);
  } catch (e) {
    if (e instanceof UrlFetchError) {
      // Map urlFetch codes to pull codes. DNS failures are treated as
      // unreachable (502) because we haven't actually connected yet.
      if (e.code === 'SSRF_BLOCKED') {
        throw new PullError('ssrf_blocked', e.message, 403);
      }
      throw new PullError('unreachable', e.message, 502);
    }
    throw e;
  }

  // Build export URL from the sanitized origin. We intentionally drop
  // any pathname / search / hash the caller supplied on remote_url — v1
  // contract is that remote_url is a bare origin like
  // `https://peer.example.com`. If we later want to support reverse-proxy
  // path prefixes, that's an additive option; for now, simpler is safer.
  const origin = `${parsed.protocol}//${parsed.host}`;
  const exportPath = `/api/projects/${encodeURIComponent(opts.remoteProjectId)}/export`;
  const exportUrl = `${origin}${exportPath}`;

  const startedAt = Date.now();
  logger.info(
    {
      targetProjectId: opts.targetProjectId,
      remoteOrigin: origin,
      remoteProjectId: opts.remoteProjectId,
      hasApiKey: !!opts.apiKey,
      policy: opts.policy ?? 'skip',
      dryRun: opts.dryRun ?? false,
    },
    'pull-from-remote starting',
  );

  // Allocate temp dir + file INSIDE the try so a late failure between
  // mkdtemp and fetch can't leak the directory.
  let tmpDir: string | undefined;
  let tmpPath: string | undefined;
  const agent = pinnedAgentForAddress(pinned);
  try {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ch-pull-'));
    tmpPath = path.join(tmpDir, `${randomBytes(8).toString('hex')}.zip`);
    // Fetch with connect-only timeout. Once headers arrive, clear the
    // timer so body drain isn't capped by a wall clock — body is
    // bounded by MAX_BUNDLE_BYTES via ByteCounter AND BODY_STALL_MS
    // idle timeout via StallTransform instead.
    const controller = new AbortController();
    const connectTimer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let resp: Response;
    try {
      resp = await fetch(exportUrl, {
        method: 'GET',
        redirect: 'manual',
        signal: controller.signal,
        dispatcher: agent,
        headers: {
          'User-Agent': 'ContextHub/1.0 (+pull-from)',
          Accept: 'application/zip',
          ...(opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {}),
        },
      } as RequestInit & { dispatcher: unknown });
    } catch (err) {
      clearTimeout(connectTimer);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes('abort') || msg.toLowerCase().includes('timeout')) {
        throw new PullError('timeout', `fetch timed out after ${FETCH_TIMEOUT_MS}ms`, 504);
      }
      throw new PullError('unreachable', msg, 502);
    }
    clearTimeout(connectTimer);

    // 3xx — remote redirected. We don't follow (design choice).
    if (resp.status >= 300 && resp.status < 400) {
      throw new PullError(
        'upstream_error',
        `remote responded with redirect ${resp.status} (not followed)`,
        502,
      );
    }

    if (resp.status >= 400) {
      throw new PullError(
        'upstream_error',
        `remote returned HTTP ${resp.status}`,
        502,
      );
    }

    // Content-Type check — exact match on the type/subtype, tolerating
    // only `application/zip` and `application/zip+<suffix>`. Loose
    // startsWith would accept `application/zipper` or `application/zip2`.
    const ctHeader = (resp.headers.get('content-type') ?? '').toLowerCase();
    const ctType = ctHeader.split(';')[0].trim();
    const ctOk = ctType === 'application/zip' || ctType.startsWith('application/zip+');
    if (!ctOk) {
      throw new PullError(
        'bad_content_type',
        `remote returned content-type "${ctHeader || '(missing)'}", expected application/zip`,
        502,
      );
    }

    // Content-Length pre-check (cheap early reject; chunked responses
    // may omit this header, in which case ByteCounter is the
    // authoritative guard).
    const clHeader = resp.headers.get('content-length');
    if (clHeader) {
      const cl = parseInt(clHeader, 10);
      if (Number.isFinite(cl) && cl > MAX_BUNDLE_BYTES) {
        throw new PullError(
          'too_large',
          `Content-Length ${cl} exceeds max ${MAX_BUNDLE_BYTES}`,
          413,
        );
      }
    }

    if (!resp.body) {
      throw new PullError('upstream_error', 'remote returned empty body', 502);
    }

    // Stream to disk with byte-count guard + body-stall defense.
    // StallTransform sits before ByteCounter so its idle timer ticks
    // on every chunk received from the remote — a stalled connection
    // aborts within BODY_STALL_MS regardless of how much has been
    // received so far.
    const stall = new StallTransform(BODY_STALL_MS);
    const counter = new ByteCounter(MAX_BUNDLE_BYTES);
    // Readable.fromWeb bridges WHATWG ReadableStream to Node Readable.
    await pipeline(
      Readable.fromWeb(resp.body as unknown as Parameters<typeof Readable.fromWeb>[0]),
      stall,
      counter,
      createWriteStream(tmpPath),
    );
    const bytesFetched = counter.bytes;

    logger.info(
      {
        targetProjectId: opts.targetProjectId,
        remoteOrigin: origin,
        bytesFetched,
        durationMs: Date.now() - startedAt,
      },
      'pull-from-remote fetched bundle',
    );

    // Hand off to importProject — all correctness concerns from here
    // (FK order, conflict policy, transactional apply, cross-tenant
    // guard) live in that service.
    const result = await importProject({
      targetProjectId: opts.targetProjectId,
      bundlePath: tmpPath,
      policy: opts.policy,
      dryRun: opts.dryRun,
      conflictsCap: opts.conflictsCap,
    });

    return {
      ...result,
      remote: {
        url: origin,
        project_id: opts.remoteProjectId,
        bytes_fetched: bytesFetched,
      },
    };
  } finally {
    // Best-effort cleanup — never block on or throw from here. tmpPath /
    // tmpDir may be undefined if mkdtemp itself failed (disk full etc);
    // skip in that case.
    if (tmpPath) {
      fs.unlink(tmpPath).catch(() => {
        /* ignore */
      });
    }
    if (tmpDir) {
      fs.rmdir(tmpDir).catch(() => {
        /* ignore */
      });
    }
    // Destroy the pinned agent. Using destroy() rather than close()
    // because the agent is per-request throwaway: cleanup must be
    // bounded-time (force-close any stuck sockets) rather than waiting
    // for graceful drain, which could hang indefinitely on a
    // dropped-network partner. Safe to call AFTER the pipeline above
    // resolves — body is already fully drained in the success path, or
    // the stream errored (and undici already tore down its sockets) in
    // the failure path.
    await agent.destroy().catch(() => { /* ignore */ });
  }
}
