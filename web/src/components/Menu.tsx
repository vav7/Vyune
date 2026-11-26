import { createEffect, createSignal, onCleanup, onMount, type JSX } from 'solid-js';
import { Portal } from 'solid-js/web';
import { Check } from 'lucide-solid';

export type MenuPlacement = 'above-start' | 'below-end';

interface MenuProps {
  /** The element the menu opens from. */
  anchor: HTMLElement;
  placement?: MenuPlacement;
  onClose: () => void;
  label: string;
  children: JSX.Element;
}

/**
 * Apple's contextual menu (report §8): a glass panel, 185px minimum, 13px
 * items, hairline separators, red for destructive items. Closes on Escape, a
 * click outside, or a scroll of the page under it.
 */
export function Menu(props: MenuProps) {
  const [position, setPosition] = createSignal<JSX.CSSProperties>({
    visibility: 'hidden',
  });
  let panelRef!: HTMLDivElement;

  const updatePosition = () => {
    const rect = props.anchor.getBoundingClientRect();
    const gap = 6;
    if ((props.placement ?? 'below-end') === 'above-start') {
      setPosition({
        left: `${Math.max(8, rect.left)}px`,
        bottom: `${window.innerHeight - rect.top + gap}px`,
        'max-height': `${rect.top - 2 * gap}px`,
        visibility: 'visible',
      });
    } else {
      setPosition({
        right: `${Math.max(8, window.innerWidth - rect.right)}px`,
        top: `${rect.bottom + gap}px`,
        'max-height': `${window.innerHeight - rect.bottom - 2 * gap}px`,
        visibility: 'visible',
      });
    }
  };

  onMount(() => {
    updatePosition();
  });

  createEffect(() => {
    panelRef?.querySelector<HTMLElement>('[role^="menuitem"]')?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        props.onClose();
        props.anchor.focus();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const items = [
          ...(panelRef?.querySelectorAll<HTMLElement>('[role^="menuitem"]:not(:disabled)') ?? []),
        ];
        const index = items.indexOf(document.activeElement as HTMLElement);
        const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
        items[(next + items.length) % items.length]?.focus();
      }
    };
    const onScroll = (event: Event) => {
      if (!panelRef?.contains(event.target as Node)) props.onClose();
    };
    const onResize = () => props.onClose();
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    onCleanup(() => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    });
  });

  return (
    <Portal>
      <div class="fixed inset-0 z-[calc(var(--z-contextual-menus)-1)]" onPointerDown={() => props.onClose()} aria-hidden="true" />
      <div
        ref={panelRef}
        class="fixed z-(--z-contextual-menus) max-w-[320px] min-w-[195px] animate-menu-in overflow-y-auto rounded-[16px] bg-black/50 backdrop-blur-[32px] backdrop-saturate-[2] border border-white/18 p-1.5 shadow-[0_36px_90px_rgba(0,0,0,0.9),inset_0_1px_0_rgba(255,255,255,0.55),inset_0_0_0_1px_rgba(255,255,255,0.1)]"
        style={position()}
        role="menu"
        aria-label={props.label}
      >
        {props.children}
      </div>
    </Portal>
  );
}

interface MenuItemProps {
  onSelect: () => void;
  icon?: JSX.Element;
  /** Shows a checkmark (a radio-style choice); null leaves the space empty. */
  checked?: boolean | null;
  destructive?: boolean;
  disabled?: boolean;
  /** Extra text at the trailing edge. */
  trailing?: JSX.Element;
  children: JSX.Element;
}

export function MenuItem(props: MenuItemProps) {
  return (
    <button
      class="flex min-h-8 w-full items-center gap-2.5 rounded-[8px] px-2.5 py-1.5 text-start type-body text-primary enabled:hover:bg-white/[0.12] enabled:hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.2)] focus-visible:bg-white/[0.12] transition-all duration-150 disabled:text-tertiary data-destructive:text-destructive"
      role={props.checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={props.checked === undefined ? undefined : !!props.checked}
      data-destructive={props.destructive || undefined}
      disabled={props.disabled}
      onClick={() => props.onSelect()}
    >
      {props.checked !== undefined && (
        <span class="inline-grid w-3.5 flex-none place-items-center text-key">
          {props.checked && <Check size={14} strokeWidth={2.6} />}
        </span>
      )}
      {props.icon && <span class="inline-grid w-5 flex-none place-items-center text-secondary">{props.icon}</span>}
      <span class="min-w-0 flex-1 truncate">{props.children}</span>
      {props.trailing && <span class="flex-none text-secondary">{props.trailing}</span>}
    </button>
  );
}

export function MenuSeparator() {
  return <div class="mx-2 my-[5px] border-t-[0.5px] border-t-vibrant-divider" role="separator" />;
}

/** A non-interactive heading inside a menu. */
export function MenuHeader(props: { children: JSX.Element }) {
  return <div class="px-2 pt-1.5 pb-1 type-subhead-emphasized text-secondary">{props.children}</div>;
}
