/**
 * cache.js — Tiny TTL+LRU cache with in-flight request dedup.
 * Zero dependencies. Used everywhere to keep the API fast and
 * to hammer upstream providers at most once per key.
 */

export class TTLCache {
  constructor({ max = 500, ttl = 5 * 60_000 } = {}) {
    this.max = max;
    this.ttl = ttl;
    this.map = new Map();
  }

  /** A value past its fresh time but inside the stale window: { val, stale: true }. */
  peek(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    const now = Date.now();
    if (now > (e.hard || e.exp)) {
      this.map.delete(key);
      return undefined;
    }
    return { val: e.val, stale: now > e.exp };
  }

  get(key) {
    const e = this.map.get(key);
    if (!e) return undefined;
    if (Date.now() > e.exp) {
      // Keep it for peek(): an expired entry is still the quickest honest answer.
      if (e.hard && Date.now() <= e.hard) return undefined;
      this.map.delete(key);
      return undefined;
    }
    // refresh LRU position
    this.map.delete(key);
    this.map.set(key, e);
    return e.val;
  }

  set(key, val, ttl = this.ttl, staleFor = 0) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, { val, exp: Date.now() + ttl, hard: staleFor ? Date.now() + ttl + staleFor : 0 });
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value);
    return val;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  delete(key) {
    this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }
}

/**
 * Deduplicated async resolver: while a fetch for `key` is in flight,
 * every caller gets the same promise (no duplicate upstream requests).
 */
export class AsyncResolver {
  constructor(cache, { ttl = 5 * 60_000, negativeTtl = 0, staleFor = 0 } = {}) {
    this.cache = cache;
    this.ttl = ttl;
    this.negativeTtl = negativeTtl;
    // stale-while-revalidate: for this long after `ttl`, the old answer is returned at once
    // and a single background refresh replaces it. Nobody waits on an upstream for a page seen before.
    this.staleFor = staleFor;
    this.pending = new Map();
  }

  _load(key, fn, ttlFor) {
    const inflight = this.pending.get(key);
    if (inflight) return inflight;
    const p = (async () => {
      try {
        const val = await fn();
        const isNeg = val === null || val === false;
        if (isNeg && this.negativeTtl > 0) this.cache.set(key, val, this.negativeTtl);
        else if (!isNeg) this.cache.set(key, val, (ttlFor && ttlFor(val)) || this.ttl, this.staleFor);
        return val;
      } finally {
        this.pending.delete(key);
      }
    })();
    this.pending.set(key, p);
    return p;
  }

  /** `ttlFor(value)` may shorten how long a particular answer is kept. */
  async resolve(key, fn, ttlFor) {
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;

    if (this.staleFor) {
      const old = this.cache.peek?.(key);
      if (old?.stale) {
        // Serve the old answer now; refresh quietly. A failed refresh keeps the old one.
        this._load(key, fn, ttlFor).catch(() => {});
        return old.val;
      }
    }
    return this._load(key, fn, ttlFor);
  }

  /** Start loading without waiting (route prefetch, warm-up). */
  warm(key, fn, ttlFor) {
    if (this.cache.get(key) !== undefined || this.pending.has(key)) return;
    this._load(key, fn, ttlFor).catch(() => {});
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Hard deadline for promises that may never settle (youtubei.js has no
 * internal fetch timeout). Returns `fallback` when the deadline hits.
 */
export function withTimeout(promise, ms, fallback = null) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((resolve) => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]);
}

/** fetch with timeout + sensible headers, returns null on any failure */
export async function safeFetch(url, { timeout = 8000, headers = {}, ...rest } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': UA, ...headers },
      ...rest,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36';


/**
 * Keep chosen caches across restarts. A server that comes back up with the pages people looked at
 * yesterday answers them at once (and refreshes them in the background, see `staleFor`) instead of
 * every first visitor paying for a cold upstream. Loaded once at boot; saved a few seconds after a
 * change and on shutdown. Only JSON-safe content caches belong here (never signed stream URLs).
 */
export function persistCaches(dir, named, { maxBytes = 6_000_000, delay = 10_000 } = {}) {
  const dirty = new Set();
  let timer = null;
  const fileOf = (name) => `${dir}/${name}.json`;

  const load = async () => {
    const { readFile } = await import('node:fs/promises');
    const now = Date.now();
    await Promise.all(
      Object.entries(named).map(async ([name, cache]) => {
        try {
          const rows = JSON.parse(await readFile(fileOf(name), 'utf8'));
          for (const [key, row] of rows) {
            if (now > (row.hard || row.exp) || cache.map.has(key)) continue; // never overwrite what a live request already stored
            cache.map.set(key, row);
          }
        } catch {
          // no snapshot yet, or an unreadable one: this cache starts empty
        }
      }),
    );
  };

  /** One cache → one file. Over the cap, the OLDEST half of the rows goes until it fits. */
  const saveOne = async (name) => {
    const { writeFile, rename, unlink, mkdir } = await import('node:fs/promises');
    let rows = [...named[name].map.entries()];
    let text = JSON.stringify(rows);
    while (text.length > maxBytes && rows.length > 1) {
      rows = rows.slice(Math.ceil(rows.length / 2));
      text = JSON.stringify(rows);
    }
    await mkdir(dir, { recursive: true });
    const tmp = `${fileOf(name)}.tmp`;
    const dest = fileOf(name);
    await writeFile(tmp, text);
    try {
      await rename(tmp, dest);
    } catch {
      try {
        await unlink(dest);
        await rename(tmp, dest);
      } catch {
        await writeFile(dest, text);
        await unlink(tmp).catch(() => {});
      }
    }
  };

  const save = async () => {
    const names = [...dirty];
    dirty.clear();
    for (const name of names) {
      try {
        await saveOne(name); // one at a time, yielding between files: a big stringify must not stall the event loop twice in a row
      } catch (err) {
        console.warn(`[cache] snapshot of ${name} failed:`, err.message);
      }
      await new Promise((r) => setTimeout(r, 0));
    }
  };

  for (const [name, cache] of Object.entries(named)) {
    const set = cache.set.bind(cache);
    cache.set = (...args) => {
      const r = set(...args);
      dirty.add(name);
      clearTimeout(timer);
      timer = setTimeout(save, delay);
      timer.unref?.();
      return r;
    };
  }
  for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => void save().finally(() => process.exit(0)));
  process.once('beforeExit', () => void save());
  return load();
}
