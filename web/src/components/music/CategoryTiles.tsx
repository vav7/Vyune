import { ArrowRight, Sparkles } from 'lucide-solid';
import { createSignal, For, Show } from 'solid-js';
import { useQuery } from '@tanstack/solid-query';
import { PrefetchLink } from '@/components/PrefetchLink';
import { hashStr } from '@/lib/format';
import { api } from '@/lib/api';
import { cardItem } from '@/components/music/types';
import { SquareLockup } from '@/components/music/Lockups';
import { ShelfScroller } from '@/components/music/ShelfView';
import type { Card, GenreCategory } from '@/lib/types';

type CategoryGroup = { title: string; detail: string; items: GenreCategory[] };

const MOODS_SET = new Set([
  'chill', 'commute', 'energize', 'feel good', 'focus', 'gaming', 'party',
  'romance', 'sad', 'sleep', 'workout', 'celebration', 'relax', 'travel',
]);
const SOUTH_ASIAN = /^(afghani|assamese|bengali|bhojpuri|carnatic classical|desi hip-hop|devotional|diwali|ghazal\s*\/\s*sufi|gujarati|haryanvi|hindi|hindustani classical|indian indie|indian pop|kannada|malayalam|marathi|odia|punjabi|tamil|telugu|urdu)$/i;
const GLOBAL_ORDER = [
  'pop', 'hip-hop', 'r&b & soul', 'rock', 'dance & electronic', 'indie & alternative',
  'latin', 'country & americana', 'jazz', 'classical', 'metal', 'reggae & caribbean',
  'k-pop', 'j-pop', 'african', 'arabic', 'folk & acoustic', 'decades', 'family',
];
const SOUTH_ASIAN_ORDER = [
  'hindi', 'punjabi', 'tamil', 'telugu', 'bengali', 'marathi', 'malayalam', 'kannada',
  'gujarati', 'bhojpuri', 'haryanvi', 'indian pop', 'indian indie', 'desi hip-hop',
  'ghazal/sufi', 'hindustani classical', 'carnatic classical', 'devotional', 'diwali',
];

function ordered(items: GenreCategory[], preferred: string[]) {
  const rank = new Map(preferred.map((label, i) => [label.toLowerCase(), i]));
  return [...items].sort((a, b) => {
    const ar = rank.get(a.label.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    const br = rank.get(b.label.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
    return ar - br || a.label.localeCompare(b.label);
  });
}

function categoryGroups(categories: GenreCategory[]): CategoryGroup[] {
  const moods: GenreCategory[] = [];
  const global: GenreCategory[] = [];
  const southAsian: GenreCategory[] = [];
  for (const category of categories) {
    const label = category.label.trim();
    if (MOODS_SET.has(label.toLowerCase())) moods.push(category);
    else if (SOUTH_ASIAN.test(label)) southAsian.push(category);
    else global.push(category);
  }
  return [
    { title: 'Moods & moments', detail: 'Find a sound for right now', items: moods },
    { title: 'Genres around the world', detail: 'From pop and jazz to Latin, K-pop and beyond', items: ordered(global, GLOBAL_ORDER) },
    { title: 'South Asian sounds', detail: 'Explore languages, traditions and new scenes', items: ordered(southAsian, SOUTH_ASIAN_ORDER) },
  ].filter((group) => group.items.length);
}

const ART_PALETTES = [
  ['#ff627c', '#4d1b58'], ['#ffb24b', '#793737'], ['#69d9c2', '#153f57'],
  ['#a994ff', '#342766'], ['#73baff', '#243c74'], ['#ff8e55', '#6a274d'],
  ['#f2d372', '#684153'], ['#5fe0a3', '#154e50'],
];

/** Fast, lightweight, GPU-composited sleeve with smooth gradients (no heavy repeating radials). */
function CategoryArtwork({ label }: { label: string }) {
  const seed = hashStr(label);
  const [accent, deep] = ART_PALETTES[Math.abs(seed) % ART_PALETTES.length]!;
  return (
    <span
      class="absolute inset-0"
      aria-hidden="true"
      style={{
        background: `linear-gradient(135deg, ${accent}cc 0%, ${deep} 65%, #0d0f18 100%)`,
      }}
    />
  );
}

export interface PopGenre {
  id: string;
  title: string;
  stars: string;
  cover: string;
  q: string;
  color: string;
}

export const POP_GENRES: PopGenre[] = [
  {
    id: 'pop',
    title: 'Pop Worldwide',
    stars: 'Taylor Swift · Dua Lipa · The Weeknd',
    cover: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=600&auto=format&fit=crop&q=80',
    q: 'Top pop hits playlist',
    color: '#ff2d55',
  },
  {
    id: 'hiphop',
    title: 'Hip-Hop & Rap',
    stars: 'Drake · Kendrick Lamar · Travis Scott',
    cover: 'https://images.unsplash.com/photo-1508700115892-45ecd05ae2ad?w=600&auto=format&fit=crop&q=80',
    q: 'Top hip-hop rap hits playlist',
    color: '#ff9500',
  },
  {
    id: 'punjabi',
    title: 'Punjabi Wave',
    stars: 'Diljit Dosanjh · Karan Aujla · AP Dhillon',
    cover: 'https://images.unsplash.com/photo-1516450360452-9312f5e86fc7?w=600&auto=format&fit=crop&q=80',
    q: 'Punjabi top hits playlist',
    color: '#af52de',
  },
  {
    id: 'bollywood',
    title: 'Bollywood Hits',
    stars: 'Arijit Singh · Shreya Ghoshal · Pritam',
    cover: 'https://images.unsplash.com/photo-1465847899084-d164df4dedc6?w=600&auto=format&fit=crop&q=80',
    q: 'Bollywood top romantic hindi hits playlist',
    color: '#ff3b30',
  },
  {
    id: 'rnb',
    title: 'R&B / Soul',
    stars: 'SZA · Frank Ocean · Beyoncé',
    cover: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=80',
    color: '#5856d6',
    q: 'R&B Soul chill hits playlist',
  },
  {
    id: 'edm',
    title: 'Dance & EDM',
    stars: 'Calvin Harris · Avicii · David Guetta',
    cover: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=600&auto=format&fit=crop&q=80',
    color: '#007aff',
    q: 'EDM Dance festival hits playlist',
  },
  {
    id: 'kpop',
    title: 'K-Pop Fever',
    stars: 'BTS · BLACKPINK · NewJeans',
    cover: 'https://images.unsplash.com/photo-1501386761578-eac5c94b800a?w=600&auto=format&fit=crop&q=80',
    color: '#ff2d55',
    q: 'K-Pop top global hits playlist',
  },
  {
    id: 'latin',
    title: 'Latin & Reggaeton',
    stars: 'Bad Bunny · J Balvin · Rosalía',
    cover: 'https://images.unsplash.com/photo-1533174072545-7a4b6ad7a6c3?w=600&auto=format&fit=crop&q=80',
    color: '#ff9500',
    q: 'Latin reggaeton hits playlist',
  },
  {
    id: 'rock',
    title: 'Rock & Alt',
    stars: 'Coldplay · Linkin Park · Imagine Dragons',
    cover: 'https://images.unsplash.com/photo-1498038432885-c6f3f1b912ee?w=600&auto=format&fit=crop&q=80',
    color: '#34c759',
    q: 'Rock and alternative hits playlist',
  },
  {
    id: 'afrobeats',
    title: 'Afrobeats',
    stars: 'Burna Boy · Wizkid · Rema',
    cover: 'https://images.unsplash.com/photo-1506157786151-b8491531f063?w=600&auto=format&fit=crop&q=80',
    color: '#ffcc00',
    q: 'Afrobeats global hits playlist',
  },
  {
    id: 'chill',
    title: 'Chill & Acoustic',
    stars: 'Ed Sheeran · Billie Eilish · Gracie Abrams',
    cover: 'https://images.unsplash.com/photo-1510915361894-db8b60106cb1?w=600&auto=format&fit=crop&q=80',
    color: '#5ac8fa',
    q: 'Acoustic chill relaxing songs playlist',
  },
  {
    id: 'workout',
    title: 'Workout & Gym',
    stars: 'Eminem · 50 Cent · Metro Boomin',
    cover: 'https://images.unsplash.com/photo-1534438327276-14e5300c3a48?w=600&auto=format&fit=crop&q=80',
    color: '#ff3b30',
    q: 'Workout gym motivation hype playlist',
  },
];

const COUNTRIES = [
  { id: 'global', name: 'Worldwide / Global', flag: '🌍', q: 'global hits' },
  { id: 'in', name: 'India', flag: '🇮🇳', q: 'india top hits' },
  { id: 'us', name: 'United States', flag: '🇺🇸', q: 'billboard hot 100' },
  { id: 'gb', name: 'United Kingdom', flag: '🇬🇧', q: 'uk top 40 hits' },
  { id: 'ca', name: 'Canada', flag: '🇨🇦', q: 'canada top hits' },
  { id: 'au', name: 'Australia', flag: '🇦🇺', q: 'australia aria top hits' },
  { id: 'kr', name: 'South Korea', flag: '🇰🇷', q: 'korean top hits k-pop' },
  { id: 'jp', name: 'Japan', flag: '🇯🇵', q: 'japan top hits j-pop' },
  { id: 'ng', name: 'Nigeria', flag: '🇳🇬', q: 'nigeria afrobeats hits' },
  { id: 'br', name: 'Brazil', flag: '🇧🇷', q: 'brazil top hits funk' },
  { id: 'de', name: 'Germany', flag: '🇩🇪', q: 'germany top hits' },
  { id: 'fr', name: 'France', flag: '🇫🇷', q: 'france top hits' },
  { id: 'mx', name: 'Mexico', flag: '🇲🇽', q: 'mexico top hits' },
];

const CURATOR_MOODS = [
  { id: 'top', label: 'Top Hits & Charts 🔥', q: 'playlist' },
  { id: 'chill', label: 'Chill & Relax ☕', q: 'chill relaxing acoustic playlist' },
  { id: 'party', label: 'Party & Dance 🪩', q: 'party dance club hits playlist' },
  { id: 'workout', label: 'Workout & Gym 💪', q: 'workout gym hype motivation playlist' },
  { id: 'focus', label: 'Focus & Study 🎧', q: 'focus study deep work lofi playlist' },
  { id: 'romance', label: 'Romance & Love ❤️', q: 'romantic love songs playlist' },
  { id: 'drive', label: 'Late Night Drive 🌙', q: 'late night drive mood playlist' },
  { id: 'hiphop', label: 'Hip-Hop & Rap 🎤', q: 'hip hop rap bangers playlist' },
  { id: 'retro', label: '90s & 2000s Throwback 📼', q: '90s 2000s throwback classics playlist' },
];

/** Live country & vibe customization that pulls tailored YouTube Music playlists. */
export function CustomCurator() {
  const [country, setCountry] = createSignal(
    typeof localStorage !== 'undefined' ? localStorage.getItem('vyune-curate-country') || 'global' : 'global',
  );
  const [mood, setMood] = createSignal(
    typeof localStorage !== 'undefined' ? localStorage.getItem('vyune-curate-mood') || 'top' : 'top',
  );

  const selectedCountry = () => COUNTRIES.find((c) => c.id === country()) ?? COUNTRIES[0]!;
  const selectedMood = () => CURATOR_MOODS.find((m) => m.id === mood()) ?? CURATOR_MOODS[0]!;

  const queryKey = () => ['custom-curated', selectedCountry().id, selectedMood().id];
  const query = useQuery(() => ({
    queryKey: queryKey(),
    queryFn: async () => {
      const q = `${selectedCountry().q} ${selectedMood().q}`;
      const res = await api.search(q, 'playlists');
      return (res?.results || []) as Card[];
    },
    staleTime: 30 * 60_000,
  }));

  const onCountryChange = (c: string) => {
    setCountry(c);
    try {
      localStorage.setItem('vyune-curate-country', c);
    } catch {}
  };

  const onMoodChange = (m: string) => {
    setMood(m);
    try {
      localStorage.setItem('vyune-curate-mood', m);
    } catch {}
  };

  const items = () => query.data || [];

  return (
    <section class="mx-(--body-gutter) mt-6 mb-8 overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.04] p-5 [backdrop-filter:blur(36px)] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.7)]" aria-label="Custom Curator">
      <div class="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-white/8">
        <div>
          <div class="flex items-center gap-2">
            <span class="grid size-7 place-items-center rounded-lg bg-white/10 text-white"><Sparkles size={16} /></span>
            <h2 class="type-title-3-emphasized text-white">Custom Curator</h2>
          </div>
          <p class="mt-1 type-caption-1 text-secondary">
            Live YouTube playlists tailored to your country and music interest
          </p>
        </div>

        {/* Dropdowns */}
        <div class="flex flex-wrap items-center gap-2.5">
          {/* Country selector */}
          <div class="relative">
            <select
              value={country()}
              onChange={(e) => onCountryChange(e.currentTarget.value)}
              class="appearance-none cursor-pointer rounded-full border border-white/15 bg-white/10 px-4 py-2 pr-8 text-[13px] font-semibold text-white shadow-[inset_0_1px_0_#ffffff30] outline-none transition hover:bg-white/16 focus:border-white/40"
              aria-label="Select Country"
            >
              <For each={COUNTRIES}>
                {(c) => (
                  <option value={c.id} class="bg-[#161722] text-white">
                    {c.flag} {c.name}
                  </option>
                )}
              </For>
            </select>
            <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/50 text-[10px]">▼</span>
          </div>

          {/* Mood / Interest selector */}
          <div class="relative">
            <select
              value={mood()}
              onChange={(e) => onMoodChange(e.currentTarget.value)}
              class="appearance-none cursor-pointer rounded-full border border-white/15 bg-white/10 px-4 py-2 pr-8 text-[13px] font-semibold text-white shadow-[inset_0_1px_0_#ffffff30] outline-none transition hover:bg-white/16 focus:border-white/40"
              aria-label="Select Vibe or Interest"
            >
              <For each={CURATOR_MOODS}>
                {(m) => (
                  <option value={m.id} class="bg-[#161722] text-white">
                    {m.label}
                  </option>
                )}
              </For>
            </select>
            <span class="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-white/50 text-[10px]">▼</span>
          </div>
        </div>
      </div>

      {/* Playlist results scroller */}
      <div class="mt-5">
        <Show when={query.isPending}>
          <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5" aria-busy="true">
            <For each={[1, 2, 3, 4, 5, 6]}>
              {() => (
                <div class="flex flex-col gap-2">
                  <div class="aspect-square w-full rounded-[14px] bg-white/5 animate-pulse" />
                  <div class="h-3.5 w-3/4 rounded bg-white/5 animate-pulse" />
                  <div class="h-3 w-1/2 rounded bg-white/5 animate-pulse" />
                </div>
              )}
            </For>
          </div>
        </Show>

        <Show when={!query.isPending && items().length > 0}>
          <ShelfScroller kind="square">
            <For each={items()}>
              {(card) => (
                <li>
                  <SquareLockup item={cardItem(card)} />
                </li>
              )}
            </For>
          </ShelfScroller>
        </Show>

        <Show when={!query.isPending && items().length === 0}>
          <p class="py-6 text-center type-callout text-secondary">
            No playlists found for this combination. Try choosing another country or vibe.
          </p>
        </Show>
      </div>
    </section>
  );
}

/** Featured Pop Genres with big star names and hardware-accelerated backdrops. */
export function PopGenres(props: { categories?: GenreCategory[] }) {
  const getHref = (genre: PopGenre) => {
    const cats = props.categories || [];
    const match = cats.find((c) => {
      const l = c.label.toLowerCase();
      if (genre.id === 'pop') return l === 'pop';
      if (genre.id === 'hiphop') return l.includes('hip-hop') || l.includes('rap');
      if (genre.id === 'punjabi') return l === 'punjabi';
      if (genre.id === 'bollywood') return l === 'hindi' || l === 'indian pop';
      if (genre.id === 'rnb') return l.includes('r&b') || l.includes('soul');
      if (genre.id === 'edm') return l.includes('dance') || l.includes('electronic');
      if (genre.id === 'kpop') return l.includes('k-pop');
      if (genre.id === 'latin') return l === 'latin';
      if (genre.id === 'rock') return l === 'rock';
      if (genre.id === 'chill') return l === 'chill';
      if (genre.id === 'workout') return l === 'workout';
      return false;
    });
    if (match) {
      return `/genre/${encodeURIComponent(match.params)}/${encodeURIComponent(match.label)}`;
    }
    return `/search?q=${encodeURIComponent(genre.q)}&filter=playlists`;
  };

  return (
    <section class="mt-8 mb-6" aria-label="Pop Icons & Genres">
      <div class="mx-(--body-gutter) mb-3.5">
        <h3 class="type-title-2-emphasized text-white">Pop Icons & Genres</h3>
        <p class="mt-0.5 type-caption-1 text-secondary">Curated sounds and biggest pop stars across every global rhythm</p>
      </div>
      <ul class="mx-(--body-gutter) grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5 [contain:paint]">
        <For each={POP_GENRES}>
          {(genre) => (
            <li class="[content-visibility:auto] [contain-intrinsic-size:auto_140px]">
              <PrefetchLink
                to={getHref(genre)}
                class="group relative flex aspect-[1.38] flex-col justify-end overflow-hidden rounded-[18px] border border-white/10 bg-[#12131d] p-3 text-white shadow-[0_10px_28px_rgba(0,0,0,0.4)] transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-1 hover:border-white/30 hover:shadow-[0_16px_36px_rgba(0,0,0,0.6)] focus-visible:outline-2 focus-visible:outline-white [contain:paint]"
              >
                {/* Image backdrop */}
                <img
                  src={genre.cover}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  class="absolute inset-0 size-full object-cover transition-transform duration-700 ease-out group-hover:scale-105 opacity-60"
                />
                {/* Gradient veil */}
                <span
                  class="absolute inset-0 bg-gradient-to-t from-[#0a0a10]/95 via-[#0a0a10]/45 to-transparent"
                  aria-hidden="true"
                />
                {/* Crisp hardware-accelerated radial tint on hover (no heavy blur) */}
                <span
                  class="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  style={{ background: `radial-gradient(circle at 80% 80%, ${genre.color}40 0%, transparent 70%)` }}
                  aria-hidden="true"
                />
                <div class="relative z-1 min-w-0">
                  <span class="block truncate text-[10px] font-semibold uppercase tracking-wider text-white/70">
                    {genre.stars}
                  </span>
                  <span class="mt-0.5 block truncate text-[14px] font-bold text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]">
                    {genre.title}
                  </span>
                </div>
              </PrefetchLink>
            </li>
          )}
        </For>
      </ul>
    </section>
  );
}

function CategoryTile({ category }: { category: GenreCategory }) {
  return (
    <li class="[content-visibility:auto] [contain-intrinsic-size:auto_96px]">
      <PrefetchLink
        to={`/genre/${encodeURIComponent(category.params)}/${encodeURIComponent(category.label)}`}
        class="genre-tile group relative flex aspect-[1.75] items-end overflow-hidden rounded-[20px] [corner-shape:squircle] border border-white/10 bg-[#161722] p-4 text-white shadow-[0_12px_30px_#0002] transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-1 hover:border-white/25 hover:shadow-[0_20px_44px_#0004] focus-visible:outline-2 focus-visible:outline-white [contain:paint]"
      >
        <CategoryArtwork label={category.label} />
        <span class="absolute inset-0 bg-gradient-to-t from-[#090a12]/85 via-[#090a12]/20 to-transparent transition-opacity duration-300 group-hover:from-[#090a12]/70" />
        <span class="relative z-[1] max-w-[85%] type-title-2-emphasized tracking-[-.02em] drop-shadow-[0_2px_10px_#0009]">{category.label}</span>
        <span class="absolute right-3 bottom-3 z-[1] grid size-8 translate-y-1 place-items-center rounded-full border border-white/20 bg-white/10 text-white opacity-0 backdrop-blur-md transition-[opacity,transform] duration-300 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100" aria-hidden="true">
          <ArrowRight size={15} />
        </span>
      </PrefetchLink>
    </li>
  );
}

export function CategoryTiles(props: {
  categories: GenreCategory[];
  title?: string;
  compact?: boolean;
}) {
  const groups = () => categoryGroups(props.categories);
  const visibleGroups = () =>
    props.compact
      ? groups()
          .filter((group) => group.title !== 'South Asian sounds')
          .map((group) => ({ ...group, items: group.items.slice(0, 6) }))
      : groups();

  return (
    <div class="pt-4 pb-2" aria-label={props.title || 'Browse Categories'}>
      {/* 1. Custom Country & Mood Curator: shown on full Browse view */}
      {!props.compact && <CustomCurator />}

      {/* 2. Pop Icons & Genres */}
      <PopGenres categories={props.categories} />

      {/* 3. Official YouTube Music Moods & Categories */}
      {props.title && <h2 class="mx-(--body-gutter) mt-8 mb-2 type-title-2-emphasized">{props.title}</h2>}
      <For each={visibleGroups()}>
        {(group) => (
          <div class="mt-6 first:mt-0">
            <div class="mx-(--body-gutter) mb-3 flex items-end justify-between gap-4">
              <div>
                <h3 class="type-title-3-emphasized">{group.title}</h3>
                <p class="mt-0.5 type-caption-1 text-secondary">{group.detail}</p>
              </div>
              {props.compact && (
                <PrefetchLink to="/browse" class="mb-0.5 inline-flex items-center gap-1 type-callout-emphasized text-secondary transition-colors hover:text-primary">
                  Explore all <ArrowRight size={14} />
                </PrefetchLink>
              )}
            </div>
            <ul class="mx-(--body-gutter) grid grid-cols-4 gap-4 max-lg:grid-cols-3 max-[607px]:grid-cols-2 max-[607px]:gap-2.5 [contain:paint]">
              <For each={group.items}>
                {(category) => <CategoryTile category={category} />}
              </For>
            </ul>
          </div>
        )}
      </For>
    </div>
  );
}
