/**
 * io.js — how a lookup talks to the network.
 *
 * Every lookup gets its own `Io`. Requests are de-duplicated inside it: the
 * Apple-timed catalogues (lrc.red, BiniLyrics) hand out the very same
 * document, and two providers asking for one URL cost one request. A failure
 * of any kind — timeout, refusal, bad JSON — is `null`, never an exception:
 * a provider that cannot answer simply has no sheet.
 */

import { safeFetch, UA } from '../cache.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createIo() {
  const memo = new Map();

  /** { ok, status, text } or null. Same URL + headers → same request. */
  function get(url, { timeout = 5000, headers = {}, retryBusy = false } = {}) {
    const key = `${url}\n${JSON.stringify(headers)}`;
    let pending = memo.get(key);
    if (!pending) {
      pending = (async () => {
        let res = await safeFetch(url, { timeout, headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', ...headers } });
        // Community APIs answer 503 "busy" now and then: one polite retry.
        if (retryBusy && res?.status === 503) {
          await sleep(700);
          res = await safeFetch(url, { timeout, headers: { 'User-Agent': UA, ...headers } });
        }
        if (!res) return null;
        try {
          return { ok: res.ok, status: res.status, text: await res.text() };
        } catch {
          return null;
        }
      })();
      memo.set(key, pending);
    }
    return pending;
  }

  /** Parsed JSON of a successful GET, else null. */
  async function json(url, opts) {
    const res = await get(url, opts);
    if (!res?.ok) return null;
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
