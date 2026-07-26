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
  },
});
