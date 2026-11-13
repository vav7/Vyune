import { createStore } from 'solid-js/store';

const KEY = 'mc_album_video';
const read = () => {
  try {
    return localStorage.getItem(KEY) === 'on';
  } catch {
    return false;
  }
};
const write = (on: boolean) => {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    // storage can be unavailable
  }
};

export interface AlbumVideoState {
  on: boolean;
  toggle: () => void;
}

/** Whether album and playlist pages play their songs' music videos behind the page. Tap the poster to flip it. */
export const [albumVideoStore, setAlbumVideoStore] = createStore<AlbumVideoState>({
  on: read(),
  toggle: () => {
    const on = !albumVideoStore.on;
    write(on);
    setAlbumVideoStore({ on });
  },
});
