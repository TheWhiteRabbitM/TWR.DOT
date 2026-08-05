import { defineConfig, type Plugin } from 'vite';

/** Inline the stylesheet, as every app here does: the dev-dot gateway has
 *  served external stylesheets as text/html, and a file that does not exist
 *  cannot be served with the wrong type. */
function inlineCss(): Plugin {
  return {
    name: 'dotmail:inline-css',
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
  build: { assetsInlineLimit: 8192 },
});
