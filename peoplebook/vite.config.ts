import { defineConfig } from 'vite';

// Stable filenames, no content hashes — the bundle is content-addressed by its
// Bulletin CID, and hashed chunk names break a lazily loaded import for anyone
// still holding the previous entry.
export default defineConfig({
  base: './',
  server: { port: 5186, strictPort: true },
  build: {
    outDir: 'dist',
    target: 'es2022',
    rollupOptions: {
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
