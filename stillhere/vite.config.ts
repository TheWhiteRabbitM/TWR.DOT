import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Inline every emitted stylesheet into index.html. The dev-dot gateway has
 * served external stylesheets as text/html before (see thebutton/README.md); a
 * stylesheet that isn't a separate file can't go missing.
 */
function inlineCss(): Plugin {
  return {
    name: 'ra:inline-css',
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
  /**
   * When this bundle was built — which is within minutes of when it was
   * published, because the workflow does both in one job.
   *
   * The page needs it to report its own age. Bulletin retention is a window of
   * roughly fourteen days and renewal means republishing, so a bundle that has
   * not been rebuilt in a fortnight is a bundle about to fall off the network.
   * The visitor cannot be warned AFTER that happens — an expired page cannot
   * serve a warning — so the only useful moment is while it is still merely
   * overdue, and age is the one fact the bundle can know about itself for
   * certain without asking anything.
   */
  define: {
    __BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    cssCodeSplit: false,
    assetsInlineLimit: 4096,
    rolldownOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
