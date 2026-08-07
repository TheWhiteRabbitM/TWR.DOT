import { fileURLToPath } from 'node:url';
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
  return {
    name: 'dotparcel:inline-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_o, bundle) {
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset' || typeof html.source !== 'string') return;
      for (const [name, out] of Object.entries(bundle)) {
        if (!name.endsWith('.css') || out.type !== 'asset') continue;
        const css = typeof out.source === 'string' ? out.source : new TextDecoder().decode(out.source);
        html.source = (html.source as string)
          .replace(new RegExp(`<link[^>]+href="[^"]*${name.split('/').pop()}"[^>]*>`), `<style>${css}</style>`);
        delete bundle[name];
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
