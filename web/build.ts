import path from 'node:path';
import { cp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { transformAsync } from '@babel/core';
import solidPreset from 'babel-preset-solid';
import typescriptPreset from '@babel/preset-typescript';
import type { BunPlugin } from 'bun';

const ROOT = path.resolve(import.meta.dir, '..');
const WEB = import.meta.dir;
const DIST = path.join(ROOT, 'dist');
const ASSETS = path.join(DIST, 'assets');

async function runTailwind(watch = false) {
  const child = Bun.spawn(
    [
      process.execPath,
      'x',
      '@tailwindcss/cli',
      '-i',
      path.join(WEB, 'src/index.css'),
      '-o',
      path.join(ASSETS, 'index.css'),
      ...(watch ? ['--watch'] : []),
    ],
    { cwd: ROOT, stdout: 'inherit', stderr: 'inherit' },
  );
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new Error(`Tailwind CLI exited with status ${exitCode}`);

  const cssPath = path.join(ASSETS, 'index.css');
  const css = await readFile(cssPath, 'utf8');
  await writeFile(cssPath, css.replaceAll('./assets/fonts/', '/assets/fonts/'));
}

const solidPlugin: BunPlugin = {
  name: 'solid-jsx',
  setup(build) {
    build.onLoad({ filter: /\.tsx$/ }, async ({ path: filename }) => {
      const source = await readFile(filename, 'utf8');
      const result = await transformAsync(source, {
        filename,
        babelrc: false,
        configFile: false,
        sourceMaps: false,
        presets: [
          [solidPreset, { generate: 'dom', hydratable: false }],
          [typescriptPreset, { allExtensions: true, isTSX: true }],
        ],
      });
      if (!result?.code) throw new Error(`Solid JSX transform returned no output for ${filename}`);
      return { contents: result.code, loader: 'js' };
    });
  },
};

/** Short content hash, URL-safe. */
const hashOf = (data: string | Uint8Array) => new Bun.CryptoHasher('sha1').update(data).digest('hex').slice(0, 10);

/** Chunks an entry loads statically, transitively: what the browser must fetch before the app can start. */
async function staticImports(entryFile: string): Promise<string[]> {
  const seen = new Set<string>();
  const visit = async (name: string) => {
    if (seen.has(name)) return;
    seen.add(name);
    let text = '';
    try {
      text = await readFile(path.join(ASSETS, name), 'utf8');
    } catch {
      return;
    }
    for (const m of text.matchAll(/(?:\bfrom|\bimport)\s*"\/assets\/([^"]+\.js)"/g)) await visit(m[1]);
  };
  await visit(entryFile);
  seen.delete(entryFile);
  return [...seen];
}

/**
 * The production page is described by its filenames: every file the document loads carries its own content
 * hash, so a cached copy can never be stale (the server marks /assets/* immutable) and a new build can never
 * be served half-old. index.html and sw.js are the only unhashed files and are always revalidated.
 */
export async function buildFrontend({ clean = true, css = true, production = true }: { clean?: boolean; css?: boolean; production?: boolean } = {}) {
  if (clean) await rm(DIST, { recursive: true, force: true });
  await mkdir(ASSETS, { recursive: true });
  if (!clean) {
    for (const name of await readdir(ASSETS)) if (name.endsWith('.js')) await rm(path.join(ASSETS, name), { force: true });
  }
  if (css) await runTailwind();

  const result = await Bun.build({
    entrypoints: [path.join(WEB, 'src/main.tsx')],
    outdir: ASSETS,
    target: 'browser',
    format: 'esm',
    splitting: true,
    minify: true,
    naming: {
      entry: production ? '[name]-[hash].[ext]' : '[name].[ext]',
      chunk: '[name]-[hash].[ext]',
      asset: '[name]-[hash].[ext]',
    },
    publicPath: '/assets/',
    define: { 'process.env.NODE_ENV': JSON.stringify(production ? 'production' : 'development') },
    tsconfig: path.join(WEB, 'tsconfig.json'),
    plugins: [solidPlugin],
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error('Bun frontend bundling failed');
  }
  const entry = path.basename(result.outputs.find((o) => o.kind === 'entry-point')!.path);

  // Stylesheet: content-hashed in production.
  let cssFile = 'index.css';
  if (production) {
    const bytes = await readFile(path.join(ASSETS, 'index.css'));
    cssFile = `app-${hashOf(bytes)}.css`;
    await rename(path.join(ASSETS, 'index.css'), path.join(ASSETS, cssFile));
  }

  await cp(path.join(WEB, 'public'), DIST, { recursive: true });
  await cp(path.join(WEB, 'src/assets/fonts'), path.join(ASSETS, 'fonts'), { recursive: true });

  // The document: direct stylesheet, the entry, and the chunks it needs, fetched in parallel.
  const preload = production ? await staticImports(entry) : [];
  const assets = [
    `<link rel="stylesheet" href="/assets/${cssFile}" />`,
    ...preload.map((f) => `<link rel="modulepreload" href="/assets/${f}" />`),
    `<script type="module" src="/assets/${entry}"></script>`,
  ].join('\n    ');
  const html = (await readFile(path.join(WEB, 'index.html'), 'utf8')).replace('<!--VY_ASSETS-->', assets);
  await writeFile(path.join(DIST, 'index.html'), html);

  // The service worker learns which build it belongs to, so a new build replaces the old cache wholesale.
  const swPath = path.join(DIST, 'sw.js');
  await writeFile(swPath, (await readFile(swPath, 'utf8')).replaceAll('__BUILD_ID__', hashOf(entry + cssFile)));

  // Pre-compress text assets once (brotli, max quality): the server sends the .br file as-is,
  // so no request ever pays for compression and the first load is a fraction of the bytes.
  const { brotliCompressSync, constants } = await import('node:zlib');
  const walk = async (dir: string): Promise<string[]> =>
    (await Promise.all((await readdir(dir, { withFileTypes: true })).map(async (e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]))).flat();
  if (production) {
    for (const file of await walk(DIST)) {
      if (!/\.(js|css|html|svg|json|webmanifest|txt)$/.test(file)) continue;
      const bytes = await readFile(file);
      if (bytes.length < 1024) continue;
      const br = brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length } });
      if (br.length < bytes.length * 0.95) await writeFile(`${file}.br`, br);
    }
  }
  console.log(`Frontend built: ${result.outputs.length} files → ${DIST} (entry ${entry}, ${preload.length} preloaded chunks)`);
}

if (import.meta.main) await buildFrontend();
