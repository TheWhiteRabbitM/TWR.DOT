import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Inline every emitted stylesheet into index.html.
 *
 * The dev-dot gateway has twice served the bundle's CSS with a text/html MIME
 * type (a missing-chunk 404 page), which strict MIME checking rejects — the app
 * then renders unstyled. Inlining removes the external CSS request entirely:
 * one less file that can go missing between Bulletin chunks and the gateway.
 */
function inlineCss(): Plugin {
  return {
    name: 'thebutton:inline-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset' || typeof html.source !== 'string') return;

      for (const [name, output] of Object.entries(bundle)) {
        if (!name.endsWith('.css') || output.type !== 'asset') continue;

        const css =
          typeof output.source === 'string'
            ? output.source
            : new TextDecoder().decode(output.source);
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const link = new RegExp(`<link[^>]*href="\\./${escaped}"[^>]*>`);

        if (link.test(html.source)) {
          html.source = html.source.replace(link, () => `<style>${css}</style>`);
          delete bundle[name];
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), inlineCss()],
  // The bundle is uploaded to Bulletin and served from a .dot gateway, not from
  // a known origin root, so every emitted asset URL has to be relative.
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    // One stylesheet, so the inline plugin covers everything.
    cssCodeSplit: false,
    assetsInlineLimit: 4096,
    rolldownOptions: {
      output: {
        /*
         * Stable filenames, no content hashes — deliberately.
         *
         * A lazily imported chunk is fetched by the name the ENTRY chunk
         * memorised at build time. When the shell is still running an entry
         * from an earlier publish and the bundle has since been republished,
         * every hash has changed and that name no longer exists, so the import
         * fails at the moment the reader uses the feature:
         *
         *   Failed to fetch dynamically imported module:
         *   polkadot://<name>.dot/assets/write-CWblSXmL.js
         *
         * Content hashes exist to bust HTTP caches; here the whole bundle is
         * already content-addressed by its CID, so they buy nothing and cost
         * exactly this. With stable names a stale entry still finds a real file
         * at the path it expects. Diagnosed on dot-store, applied everywhere
         * that lazily imports anything.
         */
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
