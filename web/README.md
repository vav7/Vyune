# VYUNE web client

The client is built with SolidJS, TypeScript, Bun's native bundler, Tailwind CSS,
TanStack Solid Query, and GSAP. The root Bun workspace owns dependency installation and runs the client
development server or production build:

```sh
bun install
bun run dev:web
bun run build
```

The Bun dev server runs on port 5173, proxies `/api` requests to the Hono server on
port 3000, and reloads the browser when source files change. Run `bun run dev` in
another terminal for the API server. Production assets are written to the root
`dist/` directory and served by Hono.
