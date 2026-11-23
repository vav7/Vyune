import { A } from '@solidjs/router';
import { splitProps, type ComponentProps } from 'solid-js';
import { preloadRoute } from '@/pageRegistry';
import { setNavHint, type NavHint } from '@/lib/navHint';
import { matchPath } from '@/lib/matchPath';
import { prewarmArtworkColor } from '@/lib/artworkColor';

type LinkProps = Omit<ComponentProps<typeof A>, 'href'> & { to: string; hint?: NavHint };

function remember(to: string, hint?: NavHint) {
  if (!hint) return;
  const path = to.split(/[?#]/)[0] ?? to;
  if (hint.thumb) prewarmArtworkColor(hint.thumb);
  const al = matchPath('/album/:id', path);
  if (al) return setNavHint('album', String(al.params.id), hint);
  const pl = matchPath('/playlist/:id', path);
  if (pl) return setNavHint('playlist', String(pl.params.id), hint);
  const ar = matchPath('/artist/:id', path);
  if (ar) return setNavHint('artist', String(ar.params.id), hint);
}

/**
 * A link that loads its page's chunk and first query before the click: on hover (after a
 * short intent delay, so sweeping the mouse across a shelf does not fire a request per card),
 * on focus, and at once on press — touch screens have no hover, and the press comes
 * ~100 ms before the click.
 */
export function PrefetchLink(props: LinkProps) {
  const [own, rest] = splitProps(props, ['to', 'hint', 'onPointerEnter', 'onPointerLeave', 'onPointerDown', 'onFocus', 'onClick']);
  let timer = 0;
  const warm = () => {
    window.clearTimeout(timer);
    remember(own.to, own.hint);
    preloadRoute(own.to);
  };
  return (
    <A
      {...rest}
      href={own.to}
      onPointerEnter={(e) => {
        remember(own.to, own.hint);
        window.clearTimeout(timer);
        timer = window.setTimeout(warm, 60);
        (own.onPointerEnter as ((e: PointerEvent) => void) | undefined)?.(e as PointerEvent);
      }}
      onPointerLeave={(e) => {
        window.clearTimeout(timer);
        (own.onPointerLeave as ((e: PointerEvent) => void) | undefined)?.(e as PointerEvent);
      }}
      onPointerDown={(e) => {
        warm();
        (own.onPointerDown as ((e: PointerEvent) => void) | undefined)?.(e as PointerEvent);
      }}
      onFocus={(e) => {
        warm();
        (own.onFocus as ((e: FocusEvent) => void) | undefined)?.(e as FocusEvent);
      }}
      onClick={(e) => {
        remember(own.to, own.hint);
        (own.onClick as ((e: MouseEvent) => void) | undefined)?.(e as MouseEvent);
      }}
    />
  );
}

export function PrefetchNavLink(props: LinkProps & { end?: boolean }) {
  return <PrefetchLink {...props} />;
}
