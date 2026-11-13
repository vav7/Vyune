import path from 'node:path';
import { watch } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';
import { serveStatic } from '../server/static.js';
import { buildFrontend } from './build';

const ROOT = path.resolve(import.meta.dir, '..');
const WEB = import.meta.dir;
const DIST = path.join(ROOT, 'dist');
const encoder = new TextEncoder();
const clients = new Set<ReadableStreamDefaultController<Uint8Array>>();
let compiling = false;
let compileTimer: ReturnType<typeof setTimeout> | undefined;

function reloadBrowsers() {
  for (const client of clients) {
    try {
      client.enqueue(encoder.encode('data: reload\n\n'));
    } catch {
      clients.delete(client);
    }
  }
}

async function compile() {
  if (compiling) return;
  compiling = true;
  try {
    await buildFrontend({ clean: false, css: false, production: false });
    reloadBrowsers();
  } catch (error) {
    console.error('[web] build failed:', error);
  } finally {
    compiling = false;
  }
}

await buildFrontend({ clean: true, production: false });

const tailwind = Bun.spawn(
  [
    process.execPath,
    'x',
    '@tailwindcss/cli',
    '-i',
    path.join(WEB, 'src/index.css'),
    '-o',
    path.join(DIST, 'assets/index.css'),
    '--watch',
  ],
  { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' },
);

watch(path.join(WEB, 'src'), { recursive: true }, () => {
  clearTimeout(compileTimer);
  compileTimer = setTimeout(() => void compile(), 180);
});
watch(path.join(DIST, 'assets/index.css'), () => reloadBrowsers());

const app = new Hono();

app.all('/api/*', async (c) => {
  const target = new URL(c.req.url);
  target.hostname = 'localhost';
  target.port = '3000';
  const headers = new Headers(c.req.raw.headers);
  headers.set('host', 'localhost:3000');
  const init: RequestInit & { duplex?: 'half' } = {
    method: c.req.method,
    headers,
    redirect: 'manual',
  };
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    init.body = c.req.raw.body;
    init.duplex = 'half';
  }
  try {
    return await fetch(target, init);
  } catch {
    return c.json({ error: 'api_server_unavailable', detail: 'Start the Hono API with `bun run dev`.' }, 502);
  }
});

app.get('/__dev/events', () => {
  let client: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      client = controller;
      clients.add(controller);
      controller.enqueue(encoder.encode(': connected\n\n'));
    },
    cancel() {
      if (client) clients.delete(client);
    },
  });
  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
});

const withReload = async () => {
  const html = await readFile(path.join(DIST, 'index.html'), 'utf8');
  const hook = '<script>new EventSource("/__dev/events").onmessage=()=>location.reload()</script>';
  return new Response(html.replace('</body>', `${hook}</body>`), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
};

app.get('/', withReload);
app.use('*', serveStatic(DIST));
app.get('*', async () => {
  const html = await readFile(path.join(DIST, 'index.html'), 'utf8');
  const hook = '<script>new EventSource("/__dev/events").onmessage=()=>location.reload()</script>';
  return new Response(html.replace('</body>', `${hook}</body>`), {
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
  });
});

const server = Bun.serve({ port: 5173, fetch: app.fetch });
console.log(`\n  VYUNE web ▶ ${server.url}  (Bun bundler + Tailwind CLI)\n`);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    clearTimeout(compileTimer);
    void tailwind.kill();
    server.stop();
    process.exit(0);
  });
}
