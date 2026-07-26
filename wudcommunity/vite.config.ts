import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Inline CSS into index.html — see thebutton/README.md on the gateway MIME issue. */
function inlineCss(): Plugin {
  return {
    name: 'wudcommunity:inline-css',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const html = bundle['index.html'];
      if (!html || html.type !== 'asset' || typeof html.source !== 'string') return;
      for (const [name, output] of Object.entries(bundle)) {
        if (!name.endsWith('.css') || output.type !== 'asset') continue;
        const css =
          typeof output.source === 'string' ? output.source : new TextDecoder().decode(output.source);
        const link = new RegExp(`<link[^>]*href="\\./${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>`);
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
  define: { 'process.env': {} },
  build: { outDir: 'dist', target: 'es2022', cssCodeSplit: false, assetsInlineLimit: 4096 },
});
