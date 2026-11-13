import { createEffect, createSignal, onCleanup } from 'solid-js';
import { audio, playerStore } from '@/store/player';

/** A pointer event whose target is the element the handler is bound to. */
type PointerOn<T extends HTMLElement> = PointerEvent & { currentTarget: T };

export function clock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * A seek line drawn from the media clock every frame while playing, by writing
 * `--progress` on the bar and the times into their spans: no Solid state, so
 * nothing re-renders. Pressing or dragging on the scrubber seeks on release.
 * Shared by the LCD and the full-screen player.
 *
 * Returns ref objects and setter functions — callers wire them via callback
 * refs, e.g. `ref={(el) => setBarRef(el)}`.
 */
export function useScrubber() {
  const barRef = { current: null as HTMLDivElement | null };
  const elapsedRef = { current: null as HTMLSpanElement | null };
  const remainingRef = { current: null as HTMLSpanElement | null };
  const draggingRef = { current: null as number | null };
  const [dragging, setDragging] = createSignal(false);
  const barRectRef = { current: null as DOMRect | null };

  // The line is redrawn every frame while the song plays, and once for each
  // event that can move it while paused. Anything that could start motion
  // (play, a seek, a new track, a drag) kicks the loop; it stops itself when
  // nothing is moving, so a paused player costs nothing.
  let kick = () => {};
  createEffect(() => {
    const element = barRef.current;
    if (!element) return;
    let frame = 0;
    const draw = () => {
      frame = 0;
      const duration = audio.duration;
      const dragged = draggingRef.current;
      const time = dragged !== null && Number.isFinite(duration) ? dragged * duration : audio.currentTime;
      const fraction = duration > 0 ? time / duration : 0;
      element.style.setProperty('--progress', String(Math.min(1, Math.max(0, fraction))));
      if (elapsedRef.current) elapsedRef.current.textContent = clock(time);
      if (remainingRef.current) remainingRef.current.textContent = `-${clock((duration || 0) - time)}`;
      if (!audio.paused || draggingRef.current !== null) frame = requestAnimationFrame(draw);
    };
    const wake = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    kick = wake;
    draw();
    const events = ['play', 'playing', 'seeked', 'timeupdate', 'durationchange', 'loadedmetadata', 'emptied'] as const;
    for (const name of events) audio.addEventListener(name, wake);
    onCleanup(() => {
      cancelAnimationFrame(frame);
      kick = () => {};
      for (const name of events) audio.removeEventListener(name, wake);
    });
  });

  const fractionAt = (event: PointerOn<HTMLElement>) => {
    if (!barRectRef.current) barRectRef.current = event.currentTarget.getBoundingClientRect();
    const rect = barRectRef.current!;
    return Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  };

  const handlers = {
    onPointerDown: (e: PointerOn<HTMLElement>) => {
      if (!audio.src) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      barRectRef.current = e.currentTarget.getBoundingClientRect();
      draggingRef.current = fractionAt(e);
      setDragging(true);
      kick();
    },
    onPointerMove: (e: PointerOn<HTMLElement>) => {
      if (draggingRef.current !== null) draggingRef.current = fractionAt(e);
    },
    onPointerUp: (e: PointerOn<HTMLElement>) => {
      if (draggingRef.current === null) return;
      if (Number.isFinite(audio.duration)) playerStore.seek(fractionAt(e) * audio.duration);
      draggingRef.current = null;
      setDragging(false);
      barRectRef.current = null;
    },
    onPointerCancel: () => {
      draggingRef.current = null;
      setDragging(false);
      barRectRef.current = null;
    },
  };

  return {
    setBarRef: (el: HTMLDivElement | null) => { barRef.current = el; },
    setElapsedRef: (el: HTMLSpanElement | null) => { elapsedRef.current = el; },
    setRemainingRef: (el: HTMLSpanElement | null) => { remainingRef.current = el; },
    dragging,
    handlers,
  };
}
