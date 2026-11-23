/**
 * io.js — how a lookup talks to the network.
 *
 * Upgraded with:
 *  - Global HTTP Cache: responses cached across lookups (2h fresh, 5m for 404s).
 *  - Domain Rate Limiter & Cooldown Tracker: handles 429 Too Many Requests and 503 Busy.
 *  - Jittered Exponential Backoff: automatically retries transient throttling gracefully.
 *  - Cross-lookup In-flight Deduplication: multiple providers or concurrent queries
 *    requesting the same upstream URL share a single in-flight promise.
 */

import { TTLCache, safeFetch, UA } from '../cache.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Shared cache across all lookups: max 1500 entries, 2 hours TTL
export const GLOBAL_HTTP_CACHE = new TTLCache({ max: 1500, ttl: 2 * 3600_000 });
const NEGATIVE_TTL = 5 * 60_000; // 5 min for 404 or empty responses

// Domain cooldown tracker: hostname -> cooldown timestamp
const DOMAIN_COOLDOWNS = new Map();

// In-flight global promise deduplication: key -> Promise
const GLOBAL_INFLIGHT = new Map();

function getHostname(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

function isDomainCoolingDown(host) {
  if (!host) return false;
  const cooldownUntil = DOMAIN_COOLDOWNS.get(host);
  if (!cooldownUntil) return false;
  if (Date.now() > cooldownUntil) {
    DOMAIN_COOLDOWNS.delete(host);
    return false;
  }
  return true;
}

function markDomainCooldown(host, retryAfterSec = 12) {
  if (!host) return;
  const ms = Math.min(60_000, Math.max(3000, retryAfterSec * 1000));
  DOMAIN_COOLDOWNS.set(host, Date.now() + ms);
}

export function createIo() {
  /** { ok, status, text } or null. Same URL + headers → same request. */
  async function get(url, { timeout = 5000, headers = {}, retryBusy = true } = {}) {
    const key = `${url}\n${JSON.stringify(headers)}`;

    // 1. Check global persistent cache first
    const cached = GLOBAL_HTTP_CACHE.get(key);
    if (cached !== undefined) {
      return cached;
    }

    // 2. Check domain cooldown (e.g. if lrclib.net or apple is actively returning 429)
    const host = getHostname(url);
    if (isDomainCoolingDown(host)) {
      // If domain is cooled down, don't spam upstream
      return null;
    }

    // 3. Deduplicate in-flight requests globally
    let pending = GLOBAL_INFLIGHT.get(key);
    if (!pending) {
      pending = (async () => {
        let attempts = 0;
        const maxAttempts = retryBusy ? 3 : 1;
        let lastRes = null;

        while (attempts < maxAttempts) {
          attempts++;
          const res = await safeFetch(url, {
            timeout,
            headers: {
              'User-Agent': UA,
              Accept: 'application/json, text/plain, */*',
              ...headers,
            },
          });

          if (!res) {
            if (attempts < maxAttempts) {
              await sleep(350 + Math.random() * 200);
              continue;
            }
            break;
          }

          // Handle Rate Limiting (429) or Service Busy (503)
          if (res.status === 429 || res.status === 503) {
            lastRes = res;
            const retryAfterHeader = res.headers?.get?.('retry-after');
            const retrySec = retryAfterHeader ? parseInt(retryAfterHeader, 10) || 5 : 5;
            
            if (attempts < maxAttempts) {
              // Exponential backoff with jitter
              const backoffMs = Math.min(2500, attempts * 500 + Math.floor(Math.random() * 300));
              await sleep(backoffMs);
              continue;
            } else {
              // Exhausted retries on 429: mark cooldown
              markDomainCooldown(host, retrySec);
            }
          }

          try {
            const body = { ok: res.ok, status: res.status, text: await res.text() };
            // Cache successful or legitimate 404 responses
            if (res.ok) {
              GLOBAL_HTTP_CACHE.set(key, body, 2 * 3600_000);
            } else if (res.status === 404) {
              GLOBAL_HTTP_CACHE.set(key, body, NEGATIVE_TTL);
            }
            return body;
          } catch {
            return null;
          }
        }

        return null;
      })();

      GLOBAL_INFLIGHT.set(key, pending);
      pending.finally(() => GLOBAL_INFLIGHT.delete(key));
    }

    return pending;
  }

  /** Parsed JSON of a successful GET, else null. */
  async function json(url, opts) {
    const res = await get(url, opts);
    if (!res?.ok || !res.text) return null;
    try {
      return JSON.parse(res.text);
    } catch {
      return null;
    }
  }

  /** The body of a successful GET, else null. */
  async function text(url, opts) {
    const res = await get(url, opts);
    return res?.ok && res.text ? res.text : null;
  }

  return { get, json, text };
}
