/* persist.ts — a tiny store-to-localStorage bridge for the Solid stores.
 *
 * The old build leaned on Zustand's `persist` middleware. Solid has no
 * equivalent, so this is the same idea in twenty lines: read the snapshot back
 * at start-up, and write it out (debounced) whenever the tracked slice moves.
 *
 * Writes are debounced on one timer per store: the player writes on every
 * queue change, and localStorage is synchronous.
 */

import { createEffect, createRoot } from 'solid-js';

/** Read a JSON value from localStorage, or the fallback when it is absent or damaged. */
export function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Write a JSON value to localStorage. A full quota is not worth an exception. */
export function writeLS(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota — ignore */
  }
}

/**
 * Persist a slice of a Solid store. `read` is tracked, so it must touch the
 * reactive properties it wants saved; `write` receives the plain snapshot.
 */
export function persistSlice<T>(_key: string, read: () => T, write: (value: T) => void, delay = 400): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  createRoot(() => {
    createEffect(() => {
      const value = read();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => write(value), delay);
    });
  });
}
