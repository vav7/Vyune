import type { JSX } from 'solid-js';

/** A page-sized message, centred. */
export const stateStyles = {
  state: 'mx-auto my-20 flex max-w-[420px] flex-col items-center gap-2 px-(--body-gutter) text-center',
  title: 'type-title-2-emphasized',
  detail: 'type-body-tall text-secondary',
  button: 'mt-3 inline-flex h-8 items-center rounded-pill bg-key-bg px-4 type-body-emphasized text-white',
};

export function LoadError(props: { error: unknown; onRetry: () => void }) {
  return (
    <div class={stateStyles.state}>
      <p class={stateStyles.title}>Couldn’t load this page</p>
      <p class={stateStyles.detail}>{props.error instanceof Error ? props.error.message : String(props.error)}</p>
      <button class={stateStyles.button} onClick={props.onRetry}>
        Try Again
      </button>
    </div>
  );
}

export function EmptyState(props: { title: string; detail?: string; children?: JSX.Element }) {
  return (
    <div class={stateStyles.state}>
      <p class={stateStyles.title}>{props.title}</p>
      {props.detail && <p class={stateStyles.detail}>{props.detail}</p>}
      {props.children}
    </div>
  );
}

/** A later page of a long list failed: what's loaded stays, with a way to try again. */
export function LoadMoreError(props: { onRetry: () => void }) {
  return (
    <div class="flex items-center justify-center gap-2.5 px-(--body-gutter) pt-6 pb-10 type-callout text-secondary">
      <span>Couldn’t load more.</span>
      <button class="type-callout-emphasized text-key" onClick={props.onRetry}>
        Try Again
      </button>
    </div>
  );
}
