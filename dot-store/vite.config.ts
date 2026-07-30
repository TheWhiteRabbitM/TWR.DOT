import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Inline emitted CSS into index.html — the .dot gateway has served external
 *  stylesheets as text/html before; an inlined stylesheet can't go missing. */
function inlineCss(): Plugin {
  return {
    name: 'tr:inline-css',
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
  base: './',
  build: {
    outDir: 'dist',
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 4096,
    rolldownOptions: {
      output: {
        /*
         * STABLE FILENAMES, NO CONTENT HASHES. This is not a style preference —
         * hashed names are actively harmful here.
         *
         * The store lazily imports its signing stack when someone posts a
         * review. Inside the Polkadot app that import failed outright:
         *
         *   Failed to fetch dynamically imported module:
         *   polkadot://dot-store.dot/assets/write-CWblSXmL.js
         *
         * The chunk was not missing from the bundle — it had been RENAMED. The
         * shell was still running an entry chunk from an earlier publish, and
         * that entry hard-codes the names of the chunks it will fetch later.
         * Republishing changed every hash, so the name it had memorised no
         * longer existed, and the feature broke for anyone holding the old
         * entry — silently, until they clicked the one button that needs it.
         *
         * Content hashes exist to bust HTTP caches. Here the ENTIRE bundle is
         * already content-addressed: a new build is a new CID, and the
         * contenthash record is what points at it. So per-file hashes buy
         * nothing, while costing this: a stale entry that asks for a file that
         * has ceased to exist. With stable names the same stale entry finds a
         * real file at the path it expects and keeps working.
         *
         * Not a total guarantee, and worth stating: several dependencies share
         * a basename, so the bundler disambiguates them with numeric suffixes
         * (dist.js, dist2.js, …). Those numbers depend on module order, so a
         * dependency change can still shuffle them. What matters is that the
         * chunks WE name — write.js above all — come from our own file names
         * and are genuinely stable.
         */
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
