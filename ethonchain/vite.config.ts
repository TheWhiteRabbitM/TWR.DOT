import { defineConfig, type Plugin } from 'vite';

/**
 * Inline every emitted stylesheet into index.html.
 *
 * Same reason as italiarovente and thebutton: the dev-dot gateway has served
 * external stylesheets as text/html, and a stylesheet that is not a separate
 * file cannot be served with the wrong type. It also removes one request from a
 * page whose whole argument is how few requests it needs.
 */
function inlineCss(): Plugin {
  return {
    name: 'eoc:inline-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset' || typeof html.source !== 'string') return;
      for (const [name, output] of Object.entries(bundle)) {
        if (!name.endsWith('.css') || output.type !== 'asset') continue;
        const css = typeof output.source === 'string' ? output.source : new TextDecoder().decode(output.source);
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
  build: { assetsInlineLimit: 8192 },
});
