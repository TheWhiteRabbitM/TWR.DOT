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
  },
});
