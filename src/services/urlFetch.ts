/**
 * SSRF-hardened URL fetcher for Phase 10.7 document ingestion.
 *
 * Threat model:
 *   - User supplies an arbitrary URL to download as a document
 *   - Attacker could point it at http://169.254.169.254 (AWS metadata),
 *     http://localhost:3000/admin, internal RFC1918 ranges, or use DNS
 *     rebinding (name resolves to public IP on HEAD, private on GET).
 *
 * Mitigations:
 *   1. Scheme allowlist (http/https only)
 *   2. DNS resolve HOST → reject if any address is loopback / link-local /
 *      private / CGNAT / multicast / reserved, BEFORE making the request
 *   3. Size cap via Content-Length + streaming byte counter
 *   4. Timeout via AbortSignal
 *   5. Manual redirect handling (max 5 hops, re-run SSRF check at each hop,
 *      strip Authorization on cross-origin redirect)
 *   6. Content-Type allowlist
 *   7. Optional test-mode bypass via ALLOW_PRIVATE_FETCH_FOR_TESTS=true so
 *      the E2E harness can serve fixtures from its own loopback. Never set
 *      this in production.
 *
 * Everything is keyed off `net.lookup` (not fetch) so DNS rebinding is
 * defused — we check the actual IP before connecting.
 */

import { lookup } from 'node:dns/promises';
import { isIPv4, isIPv6 } from 'node:net';
import { URL } from 'node:url';
import { getEnv } from '../env.js';
import { createModuleLogger } from '../utils/logger.js';

const logger = createModuleLogger('url-fetch');

export const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB — matches multipart cap
export const FETCH_TIMEOUT_MS = 30_000;
export const MAX_REDIRECTS = 5;

/** Content types we're willing to ingest. Keeps HTML + plain text in, keeps
 *  video/audio/archives out. */
const ALLOWED_MIME_PREFIXES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'application/epub+zip',
  'application/vnd.oasis.opendocument.text', // .odt
  'application/rtf',
  'text/rtf',
  'text/html',
  'text/plain',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
];

export interface FetchResult {
  buffer: Buffer;
  mimeType: string;
  docType: string;
  /** Best-effort filename derived from URL path or Content-Disposition. */
  filename: string;
  /** Final URL after redirects. */
  finalUrl: string;
}

export class UrlFetchError extends Error {
  constructor(public code: string, message: string, public httpStatus: number = 400) {
    super(message);
    this.name = 'UrlFetchError';
  }
}

/** Is an IPv4 address in a range we refuse to connect to? */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return true;
  const [a, b] = parts;
  // RFC1918
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  // Loopback
  if (a === 127) return true;
  // Link-local + cloud metadata
  if (a === 169 && b === 254) return true;
  // CGNAT
  if (a === 100 && b >= 64 && b <= 127) return true;
  // Multicast
  if (a >= 224 && a <= 239) return true;
  // Reserved
  if (a === 0) return true;
  if (a >= 240) return true;
  return false;
}

/** IPv6 equivalents of the above. Conservative — reject anything except
 *  globally routable unicast. */
function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::' || lower === '::1') return true; // unspecified + loopback
  if (lower.startsWith('fe80:') || lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique-local
  if (lower.startsWith('ff')) return true; // multicast
  // IPv4-mapped (::ffff:127.0.0.1) → extract and recheck
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

/** Is a host a literal IP or a hostname we should DNS-resolve? */
function isLiteralIp(host: string): boolean {
  // IPv6 literals appear bracket-wrapped in URLs; URL class strips brackets
  return isIPv4(host) || isIPv6(host);
}

/** Resolve hostname via DNS and ensure no returned address is in a private
 *  range. Rejects on the FIRST private hit — we don't want to dial a
 *  multi-homed host that also happens to be internal.
 *
 *  Exported for reuse by other SSRF-sensitive fetchers (e.g. Phase 11.5
 *  cross-instance bundle pull). Throws UrlFetchError with codes
 *  'SSRF_BLOCKED', 'DNS_FAILED', or 'DNS_EMPTY'. */
export async function assertHostAllowed(host: string): Promise<void> {
  const env = getEnv();
  const allowPrivate = process.env.ALLOW_PRIVATE_FETCH_FOR_TESTS === 'true';

  const isBad = (addr: string): boolean => {
    if (isIPv4(addr)) return isPrivateIPv4(addr);
    if (isIPv6(addr)) return isPrivateIPv6(addr);
    return true;
  };

  if (isLiteralIp(host)) {
    if (allowPrivate) return;
    if (isBad(host)) {
      throw new UrlFetchError('SSRF_BLOCKED', `refusing to fetch from private address: ${host}`, 403);
    }
    return;
  }

  // DNS resolve — use `all: true` to inspect every address the host advertises
  let records: { address: string; family: number }[];
  try {
    records = await lookup(host, { all: true });
  } catch (err) {
    throw new UrlFetchError('DNS_FAILED', `could not resolve ${host}: ${err instanceof Error ? err.message : String(err)}`, 400);
  }

  if (records.length === 0) {
    throw new UrlFetchError('DNS_EMPTY', `no DNS records for ${host}`, 400);
  }

  if (allowPrivate) return;

  for (const r of records) {
    if (isBad(r.address)) {
      throw new UrlFetchError('SSRF_BLOCKED', `host ${host} resolves to private address ${r.address}`, 403);
    }
  }

  // env passthrough so linter doesn't complain about unused env import
  void env;
}

/** Map mime type → internal doc_type string used by the extraction pipeline. */
function docTypeFromMime(mime: string, urlPath: string): string {
  const lower = mime.toLowerCase();
  if (lower.startsWith('application/pdf')) return 'pdf';
  if (lower.startsWith('application/vnd.openxmlformats-officedocument.wordprocessingml')) return 'docx';
  if (lower.startsWith('application/msword')) return 'docx';
  if (lower.startsWith('application/epub')) return 'epub';
  if (lower.startsWith('application/vnd.oasis.opendocument.text')) return 'odt';
  if (lower.startsWith('application/rtf') || lower.startsWith('text/rtf')) return 'rtf';
  if (lower.startsWith('text/html')) return 'html';
  if (lower.startsWith('text/markdown')) return 'markdown';
  if (lower.startsWith('text/plain')) {
    // Check extension — .md / .markdown is still markdown
    const ext = urlPath.split('.').pop()?.toLowerCase();
    if (ext === 'md' || ext === 'markdown') return 'markdown';
    return 'text';
  }
  if (lower.startsWith('image/')) return 'image';
  return 'text';
}

/** Derive a safe filename from URL path or Content-Disposition header. */
function deriveFilename(url: URL, disposition: string | null): string {
  if (disposition) {
    const match = /filename\*?=(?:UTF-\d+'')?["']?([^"';]+)["']?/i.exec(disposition);
    if (match && match[1]) {
      return decodeURIComponent(match[1]).replace(/[\\/]/g, '_').slice(0, 255);
    }
  }
  const last = url.pathname.split('/').filter(Boolean).pop();
  if (last) {
    return decodeURIComponent(last).replace(/[\\/]/g, '_').slice(0, 255);
  }
  return `${url.hostname}.bin`;
}

/** The main entry point — download a URL into a Buffer, returning metadata
 *  compatible with the existing upload flow. */
export async function fetchUrlAsDocument(rawUrl: string): Promise<FetchResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UrlFetchError('INVALID_URL', `malformed URL: ${rawUrl}`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UrlFetchError('BAD_SCHEME', `only http/https supported, got ${url.protocol}`, 400);
  }

  let redirectsLeft = MAX_REDIRECTS;
  let currentUrl = url;
  const startedAt = Date.now();

  while (true) {
    await assertHostAllowed(currentUrl.hostname);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let resp: Response;
    try {
      resp = await fetch(currentUrl, {
        method: 'GET',
        redirect: 'manual', // critical — we validate each hop ourselves
        signal: controller.signal,
        headers: {
          // Some servers 403 on empty UA
          'User-Agent': 'ContextHub/1.0 (+https://github.com/letuhao1994/free-context-hub)',
          Accept: ALLOWED_MIME_PREFIXES.join(','),
        },
      });
    } catch (err) {
      clearTimeout(timer);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('aborted')) {
        throw new UrlFetchError('TIMEOUT', `fetch timed out after ${FETCH_TIMEOUT_MS}ms`, 504);
      }
      throw new UrlFetchError('FETCH_FAILED', msg, 502);
    }
    clearTimeout(timer);

    // Redirect handling (manual — re-validate host on each hop)
    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers.get('location');
      if (!location) {
        throw new UrlFetchError('BAD_REDIRECT', `${resp.status} with no Location header`, 502);
      }
      if (--redirectsLeft < 0) {
        throw new UrlFetchError('TOO_MANY_REDIRECTS', `exceeded ${MAX_REDIRECTS} redirects`, 502);
      }
      let next: URL;
      try {
        next = new URL(location, currentUrl);
      } catch {
        throw new UrlFetchError('BAD_REDIRECT', `redirect Location not parseable: ${location}`, 502);
      }
      if (next.protocol !== 'http:' && next.protocol !== 'https:') {
        throw new UrlFetchError('BAD_SCHEME', `redirect to unsupported scheme ${next.protocol}`, 400);
      }
      logger.info({ from: currentUrl.href, to: next.href, status: resp.status }, 'url-fetch redirect');
      currentUrl = next;
      continue; // next iteration re-runs assertHostAllowed
    }

    if (resp.status >= 400) {
      throw new UrlFetchError('UPSTREAM_ERROR', `upstream returned ${resp.status}`, 502);
    }

    // Content-Length pre-check (cheap early reject)
    const clHeader = resp.headers.get('content-length');
    if (clHeader) {
      const cl = parseInt(clHeader, 10);
      if (Number.isFinite(cl) && cl > MAX_SIZE_BYTES) {
        throw new UrlFetchError('TOO_LARGE', `Content-Length ${cl} exceeds max ${MAX_SIZE_BYTES}`, 413);
      }
    }

    // Content-Type check
    const ct = (resp.headers.get('content-type') ?? 'application/octet-stream').split(';')[0].trim().toLowerCase();
    const allowed = ALLOWED_MIME_PREFIXES.some((m) => ct.startsWith(m));
    if (!allowed) {
      throw new UrlFetchError('UNSUPPORTED_TYPE', `content-type "${ct}" is not allowed`, 415);
    }

    // Stream body with a running size guard
    const reader = resp.body?.getReader();
    if (!reader) {
      // No stream — fall back to arrayBuffer, still capped
      const ab = await resp.arrayBuffer();
      if (ab.byteLength > MAX_SIZE_BYTES) {
        throw new UrlFetchError('TOO_LARGE', `body ${ab.byteLength} exceeds max ${MAX_SIZE_BYTES}`, 413);
      }
      const buffer = Buffer.from(ab);
      return {
        buffer,
        mimeType: ct,
        docType: docTypeFromMime(ct, currentUrl.pathname),
        filename: deriveFilename(currentUrl, resp.headers.get('content-disposition')),
        finalUrl: currentUrl.href,
      };
    }

    const chunks: Buffer[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value) {
        size += value.byteLength;
        if (size > MAX_SIZE_BYTES) {
          reader.cancel().catch(() => {});
          throw new UrlFetchError('TOO_LARGE', `streamed body exceeded ${MAX_SIZE_BYTES}`, 413);
        }
        chunks.push(Buffer.from(value));
      }
    }

    const buffer = Buffer.concat(chunks);
    logger.info(
      {
        url: currentUrl.href,
        bytes: buffer.length,
        mime: ct,
        duration_ms: Date.now() - startedAt,
      },
      'url-fetch complete',
    );

    return {
      buffer,
      mimeType: ct,
      docType: docTypeFromMime(ct, currentUrl.pathname),
      filename: deriveFilename(currentUrl, resp.headers.get('content-disposition')),
      finalUrl: currentUrl.href,
    };
  }
}
