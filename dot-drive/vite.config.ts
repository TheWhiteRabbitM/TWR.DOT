import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Chain metadata this app can never ask for.
 *
 * The first build was 1.5 MB and most of it was descriptor blobs at ~850 kB
 * each, for chains dotmail does not talk to. In a browser they cost little,
 * because the SDK reaches them through import() and an unused one is never
 * fetched. Through the dot.li gateway they cost everything: the whole published
 * archive is pulled before the first line runs. See src/no-such-chain.ts.
 */
const UNREACHABLE_CHAINS = [
  'polkadot-asset-hub', 'kusama-asset-hub',
  'paseo-asset-hub', 'paseo-bulletin', 'paseo-individuality',
];
const stub = fileURLToPath(new URL('./src/no-such-chain.ts', import.meta.url));

/** Inline the stylesheet, as every app here does: the dev-dot gateway has
 *  served external stylesheets as text/html, and a file that does not exist
 *  cannot be served with the wrong type. */
function inlineCss(): Plugin {
  let dropped: string[] = [];
  let survivor: string | null = null;
  return {
    name: 'dot-drive:inline-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_o, bundle) {
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset' || typeof html.source !== 'string') return;

      const gone: string[] = [];
      for (const [name, out] of Object.entries(bundle)) {
        if (!name.endsWith('.css') || out.type !== 'asset') continue;
        const css = typeof out.source === 'string' ? out.source : new TextDecoder().decode(out.source);
        html.source = (html.source as string)
          .replace(new RegExp(`<link[^>]+href="[^"]*${name.split('/').pop()}"[^>]*>`), `<style>${css}</style>`);
        delete bundle[name];
        gone.push(name.split('/').pop()!);
      }
      dropped = gone;
      survivor = Object.keys(bundle).find((n) => n.endsWith('.js'))?.split('/').pop() ?? null;
    },

    /*
     * AND THE HALF THAT WAS MISSING.
     *
     * Deleting the asset is not enough. Rollup has already written that
     * filename into `__vite__mapDeps`, the array `__vitePreload` walks before
     * every dynamic import. The file is gone, the preload throws "Unable to
     * preload CSS for ./index.<hash>.css", and the import it was guarding
     * never happens.
     *
     * It surfaced as "the host would not come up", because the import it
     * killed was the SDK's, three frames down, and the message that reached
     * the screen was about a stylesheet.
     *
     * The entry cannot simply be REMOVED: `mapDeps` addresses that array by
     * index, so every later dependency would shift by one. It is replaced by a
     * chunk that really exists. `__vitePreload` keeps a `seen` set, so a
     * duplicate is skipped outright and an unseen one preloads a module that
     * was going to be fetched anyway.
     *
     * On DISK, in `writeBundle`, and not in `generateBundle`: two attempts
     * were made there first, and both were undone, because Vite writes those
     * dep arrays after a `post` plugin has had its turn. Verified by grepping
     * the built files rather than by reading the hook order.
     *
     * `build.modulePreload.resolveDependencies` looks like the first-class way
     * to do this. It was tried. It does not reach these entries either.
     */
    writeBundle(options) {
      if (!dropped.length || !survivor) return;
      const dir = options.dir ?? 'dist';
      const walk = (d: string): string[] =>
        readdirSync(d, { withFileTypes: true }).flatMap((e) =>
          e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.js') ? [join(d, e.name)] : []);
      for (const f of walk(dir)) {
        const before = readFileSync(f, 'utf8');
        let after = before;
        for (const css of dropped) after = after.split(`"./${css}"`).join(`"./${survivor}"`);
        if (after !== before) writeFileSync(f, after);
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [inlineCss()],
  resolve: {
    alias: UNREACHABLE_CHAINS.map((c) => ({
      find: `@parity/product-sdk-descriptors/${c}`,
      replacement: stub,
    })),
  },
  build: {
    assetsInlineLimit: 8192,

    // Content-hashed names. The bundle is served through a .dot name, so every
    // publish reuses the same urls; with stable names a phone keeps serving the
    // previous script from cache and the fix never lands.
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
      },
    },
  },
});
