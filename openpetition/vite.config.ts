import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Inline every emitted stylesheet into index.html.
 *
 * The dev-dot gateway has served external stylesheets as text/html 404s more
 * than once (see thebutton/README.md). A stylesheet that does not exist as a
 * file cannot go missing.
 */
function inlineCss(): Plugin {
  return {
    name: 'petitions:inline-css',
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
  // Served from a .dot gateway, not an origin root: all URLs must be relative.
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
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
