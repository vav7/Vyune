# Changelog

## 2.0 — boot, lyrics engine and design system rewrite

**Load**
- No more black screen: the HTML carries an app-shaped skeleton; the home hero has a placeholder instead of rendering nothing on a pure-black page.
- Removed both render-blocking Google Fonts stylesheets; Indic faces load lazily with the lyrics panel.
- Replaced the bundled SF Pro files (`font-display: block`) with system San Francisco + self-hosted Inter Variable (`swap`).
- All entry files are content-hashed; only hashed files are `immutable` (previously `main.js` and `index.css` were cached for a year under fixed names).
- One `GET /api/home` replaces four cold requests; cached stale-while-revalidate and persisted.
- Server starts listening immediately; cache snapshots are one file per cache, size-capped, loaded in the background.
- Service worker: stale-while-revalidate shell, cache-first hashed assets, per-build cache name.

**Lyrics**
- `server/lyrics.js` (2,100 lines) → `server/lyrics/` (small modules, one job each). Wire format unchanged.
- New: ISRC-first identification shared by all providers, duration-checked KuGou route, Better Lyrics TTML route, per-lookup request de-duplication, multi-stamp and enhanced LRC parsing.
- Title cleaning now keeps version words (remix, live, acoustic…).
- Removed dead code paths: Saavn/YouTube-caption lyric stubs, KPoe mirror converter, 15-provider legacy chain.

**Design**
- New palette, one radius scale, one squircle rule, one button family (`.vy-btn`), one glass recipe.

**Deleted**
- `CompactPlayer`, `GoPage`, `ArtworkTintWash`, `meshPalette`, `platform`, `ttml.ts` (unreferenced).
- Server routes and modules with no caller: `/api/mv-loop`, `/api/cover-art`, `/api/feeds/home`, `/api/tidal/track`, `/api/spotify/*`, `/api/track-meta`, `/api/global-charts`, `/api/home/curated`; `mvloop.js`, `coverart.js`, `tidal.js`.
- `CHANGES.md` (step log), `SOLID_MIGRATION.md`, stale build output, SF Pro font files.
