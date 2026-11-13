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
export function Menu({ anchor, placement = 'below-end', onClose, label, children }: MenuProps) {
  const [position, setPosition] = createSignal<JSX.CSSProperties>({
    visibility: 'hidden',
  });
  let panelRef!: HTMLDivElement;

  const updatePosition = () => {
    const rect = anchor.getBoundingClientRect();
    const gap = 6;
    if (placement === 'above-start') {
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
        onClose();
        anchor.focus();
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
      if (!panelRef?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onClose);
    onCleanup(() => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onClose);
    });
  });

  // Rendered at the top of the page, not where it was opened: inside the full-screen
  // player (or any layer that has its own stacking context) a menu's z-index only
  // competes with its neighbours, and a playing motion clip or video paints over it.
  return (
    <Portal>
      <div class="fixed inset-0 z-[calc(var(--z-contextual-menus)-1)]" onPointerDown={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        // Apple's amp-contextual-menu (report §8).
        class="fixed z-(--z-contextual-menus) max-w-[300px] min-w-[185px] animate-menu-in overflow-y-auto rounded-[10px] bg-thick-material p-[5px] shadow-[0_0_0_0.5px_var(--vibrantDivider),0_10px_40px_var(--glassMaterialShadowColor)] [backdrop-filter:saturate(2.2)_blur(32px)]"
        style={position()}
        role="menu"
        aria-label={label}
      >
        {children}
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

export function MenuItem({ onSelect, icon, checked, destructive, disabled, trailing, children }: MenuItemProps) {
  return (
    <button
      class="flex min-h-7 w-full items-center gap-2 rounded-[5px] px-2 py-1 text-start type-body text-primary enabled:hover:bg-quinary focus-visible:bg-quinary disabled:text-tertiary data-destructive:text-destructive"
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked === undefined ? undefined : !!checked}
      data-destructive={destructive || undefined}
      disabled={disabled}
      onClick={onSelect}
    >
      {checked !== undefined && (
        <span class="inline-grid w-3.5 flex-none place-items-center text-key">
          {checked && <Check size={14} strokeWidth={2.6} />}
        </span>
      )}
      {icon && <span class="inline-grid w-5 flex-none place-items-center text-secondary">{icon}</span>}
      <span class="min-w-0 flex-1 truncate">{children}</span>
      {trailing && <span class="flex-none text-secondary">{trailing}</span>}
    </button>
  );
}

export function MenuSeparator() {
  return <div class="mx-2 my-[5px] border-t-[0.5px] border-t-vibrant-divider" role="separator" />;
}

/** A non-interactive heading inside a menu. */
export function MenuHeader({ children }: { children: JSX.Element }) {
  return <div class="px-2 pt-1.5 pb-1 type-subhead-emphasized text-secondary">{children}</div>;
}
