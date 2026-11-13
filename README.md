# VYUNE — Feel Every Frequency

**Premium music player with a vinyl-inspired identity.** Streaming via **YouTube.js (InnerTube)**
with a **JioSaavn** fallback, a multi-provider lyrics engine with word-, line- and plain-text
fallbacks, and a UI inspired by Apple Music's clean fluid design.

Modern stack, zero bloat: **SolidJS + TypeScript + Bun's native bundler + Tailwind CSS v4 +
TanStack Solid Query**, served by **Hono on Bun**. The frontend is code-split
and the build is served from the same process as the API. No third-party requests on page load.

---

## Quick start

```bash
bun install          # root workspaces: server deps + web/
bun run build        # builds web → dist/ (served by Hono)
bun start            # http://localhost:3000
bun run test        # unit + contract tests (no network, no browser)
bun run test:e2e    # Playwright E2E against real upstream APIs
```

Optional env: `PORT`, `YT_PO_TOKEN_PROVIDER_URL` (a private BgUtils-compatible service for
fresh, video-bound tokens), `YT_PO_TOKEN` or a client-specific `YT_PO_TOKEN_<CLIENT>` and
`YT_COOKIE` (YouTube may require a current, matching token/cookie on server hosts),
and `LYRICS_DEBUG=1`. Put local values in an ignored `.env` file or set them in the host's
environment; never commit real token or cookie values. The app's media URLs use the
same-origin range proxy so playback requests follow the server's stream resolution.

For a local BgUtils-compatible provider, set `YT_PO_TOKEN_PROVIDER_URL` to its base URL
(for example, `http://127.0.0.1:4416`); VYUNE calls its `/get_pot` endpoint with the
video ID as the content binding. Keep that unauthenticated service private. Tokens can
help with playback refusals, but do not guarantee that a YouTube IP-level bot check will
be cleared.

---

## Documentation

- **[docs/SYSTEM_DESIGN.md](docs/SYSTEM_DESIGN.md)** — how the site fetches everything: first load, data layer, stream cascade, lyrics engine, caching, failure model, design system.
- [CHANGELOG.md](CHANGELOG.md)

## Layout

```
server/      Hono API + Bun runtime (see the module table in SYSTEM_DESIGN §2)
  lyrics/    the lyrics engine: parsers, providers, engine
web/         SolidJS + Tailwind v4 frontend, built by web/build.ts into dist/
  src/styles/system.css   radii, squircles, glass, buttons
tests/       unit + contract tests, and the Playwright suite
docs/        system design
```

## Credits

Design measurements and the lyrics/identity pipelines are inspired by modern Apple Music web standards.
Lyric rendering uses [am-lyrics](https://github.com/uimaxbai/am-lyrics) (MPL-2.0). Inter by Rasmus Andersson (OFL).

## License

See [LICENSE](LICENSE).
