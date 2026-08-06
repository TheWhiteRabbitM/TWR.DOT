import { defineConfig, type Plugin } from 'vite';

/**
 * Inline every emitted stylesheet into index.html.
 *
 * The dev-dot gateway has served external stylesheets as text/html — it is
 * written down in thebutton's README and italiarovente, dotmail and ethonchain
 * all carry this plugin because of it. peoplebook did not, so the redesign
 * shipped as a `<link rel="stylesheet">` and arrived with no styling at all:
 * the page was correct and looked broken.
 *
 * A stylesheet that is not a separate file cannot be served with the wrong type.
 */
function inlineCss(): Plugin {
  return {
    name: 'pb:inline-css',
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

// Content-hashed filenames. The bundle is served through the .dot name, so every
// publish reuses the SAME urls — with stable names a phone happily keeps serving
// the previous assets/index.js from cache and the fix never lands. Hashing the
// names makes each build a new url, so a fresh index.html can never pull a stale
// script.
export default defineConfig({
  base: './',
  plugins: [inlineCss()],
  // Stamped into the footer so anyone (us included) can tell at a glance which
  // build a phone is actually running — the difference between "the fix is broken"
  // and "you're on a cached bundle".
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z') },
  server: { port: 5186, strictPort: true },
  build: {
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].[hash].js',
        chunkFileNames: 'assets/[name].[hash].js',
        assetFileNames: 'assets/[name].[hash][extname]',
      },
    },
  },
});
