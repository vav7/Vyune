/**
 * What a card already knows about the page it leads to.
 *
 * A card has the title, the artwork and the byline before the page has fetched a single byte.
 * The link leaves them here, and the album / playlist page paints its real header from them on the
 * very first frame — no black screen, no grey boxes — while the track list is still on its way.
 */
export interface NavHint {
  title: string;
  thumb?: string | null;
  subtitle?: string | null;
}

const hints = new Map<string, NavHint>();
const MAX = 120;

function cleanId(id: string): string {
  try {
    return decodeURIComponent(String(id || '')).trim();
  } catch {
    return String(id || '').trim();
  }
}

export function setNavHint(kind: string, rawId: string, hint: NavHint) {
  const id = cleanId(rawId);
  if (!id || !hint?.title) return;
  const key = `${kind}:${id}`;
  hints.delete(key);
  hints.set(key, hint);
  // Also register with VL prefix stripped/added if applicable
  if (id.startsWith('VL')) {
    hints.set(`${kind}:${id.slice(2)}`, hint);
  } else {
    hints.set(`${kind}:VL${id}`, hint);
  }
  if (hints.size > MAX) hints.delete(hints.keys().next().value as string);
  try {
    sessionStorage.setItem(`vy-nav:${key}`, JSON.stringify(hint));
  } catch {}
}

export function getNavHint(kind: string, rawId: string): NavHint | undefined {
  const id = cleanId(rawId);
  const key = `${kind}:${id}`;
  const mem = hints.get(key) || (id.startsWith('VL') ? hints.get(`${kind}:${id.slice(2)}`) : hints.get(`${kind}:VL${id}`));
  if (mem) return mem;
  try {
    const raw = sessionStorage.getItem(`vy-nav:${key}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return undefined;
}
