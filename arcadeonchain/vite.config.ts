import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Pinned so the preview always finds it: vite otherwise walks to the next free
  // port, and a launch.json naming one port while the server sits on another is
  // a blank pane with no error.
  server: { port: 5185, strictPort: true },
  build: {
    outDir: 'dist',
    target: 'es2022',
    // ROMs must stay separate files. Inlining a 512 KB cartridge as a data URI
    // would push it into the JS bundle, where it is parsed rather than fetched.
    assetsInlineLimit: 2048,
    rollupOptions: {
      output: {
        // Stable filenames, no content hashes — the bundle is already
        // content-addressed by its CID, and hashed chunk names break a lazily
        // loaded import for anyone still holding the previous entry.
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
