import { createSignal, onCleanup } from 'solid-js';

/**
 * One place that decides how much visual work this device can afford.
 *
 * Every heavy effect (motion clips, the frosted video, big blurs) asks for the
 * current tier instead of deciding for itself. The tier starts from what the
 * device reports and is then corrected by measurement: a short frame-time
 * probe runs after load and again now and then, and drops the tier when the
 * page is really running slow. It only ever steps down inside a session, so
 * effects never flicker on and off.
 */
export type Tier = 'high' | 'mid' | 'low';
export interface TierConfig {
  motion: boolean;
  frostFps: number;
  frostSize: [number, number];
  blur: boolean;
}

export const TIERS: Record<Tier, TierConfig> = {
  high: { motion: true, frostFps: 60, frostSize: [256, 144], blur: true },
  mid: { motion: true, frostFps: 60, frostSize: [192, 108], blur: true },
  low: { motion: false, frostFps: 0, frostSize: [48, 27], blur: false },
};

const ORDER: Tier[] = ['high', 'mid', 'low'];
const KEY = 'vyune-perf-tier';

function initial(): Tier {
  if (typeof navigator === 'undefined') return 'high';
  try {
    const saved = sessionStorage.getItem(KEY) as Tier | null;
    if (saved && ORDER.includes(saved)) return saved;
  } catch {
    // session storage can be unavailable
  }
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (matchMedia?.('(prefers-reduced-motion: reduce)').matches || nav.connection?.saveData) return 'low';
  const cores = nav.hardwareConcurrency ?? 8;
  const memory = nav.deviceMemory ?? 8;
  if (cores <= 2 || memory <= 2) return 'low';
  if (cores < 4 || memory < 4) return 'mid';
  return 'high';
}

let tier: Tier = initial();
const listeners = new Set<() => void>();

function apply() {
  if (typeof document !== 'undefined') document.documentElement.dataset.perf = tier;
}
apply();

function downgrade() {
  const next = ORDER[Math.min(ORDER.indexOf(tier) + 1, ORDER.length - 1)]!;
  if (next === tier) return;
  tier = next;
  try {
    sessionStorage.setItem(KEY, tier);
  } catch {
    // ignore
  }
  apply();
  listeners.forEach((fn) => fn());
}

/** Averages ~1.2 s of frame gaps; a page under ~28 fps steps the tier down. */
function probe() {
  if (typeof requestAnimationFrame !== 'function' || document.hidden) return;
  let last = performance.now();
  const gaps: number[] = [];
  const step = (now: number) => {
    gaps.push(now - last);
    last = now;
    if (gaps.length < 72) return void requestAnimationFrame(step);
    const sorted = gaps.slice(8).sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 16;
    if (median > 50) downgrade();
  };
  requestAnimationFrame(step);
}

if (typeof window !== 'undefined') {
  window.setTimeout(probe, 4000);
  window.setInterval(probe, 45_000);
}

export const currentTier = () => tier;

/**
 * The current tier, as a reactive object.
 *
 * Do NOT destructure it — `const { motion } = useTier()` freezes the value.
 * Read the property where you use it: `tier.motion`.
 */
export function useTier(): TierConfig & { tier: Tier } {
  const [value, setValue] = createSignal(tier);
  const listener = () => setValue(tier);
  listeners.add(listener);
  onCleanup(() => {
    listeners.delete(listener);
  });
  const config = () => TIERS[value()];
  return {
    get tier() {
      return value();
    },
    get motion() {
      return config().motion;
    },
    get frostFps() {
      return config().frostFps;
    },
    get frostSize() {
      return config().frostSize;
    },
    get blur() {
      return config().blur;
    },
  };
}
