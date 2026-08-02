import { defineConfig } from 'vite';

// Content-hashed filenames. The bundle is served through the .dot name, so every
// publish reuses the SAME urls — with stable names a phone happily keeps serving
// the previous assets/index.js from cache and the fix never lands. Hashing the
// names makes each build a new url, so a fresh index.html can never pull a stale
// script.
export default defineConfig({
  base: './',
  // Stamped into the footer so anyone (us included) can tell at a glance which
  // build a phone is actually running — the difference between "the fix is broken"
  // and "you're on a cached bundle".
  define: { __BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + 'Z') },
  server: { port: 5187, strictPort: true },
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
