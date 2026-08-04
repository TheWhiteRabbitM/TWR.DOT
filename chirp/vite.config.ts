import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

// Chain metadata chirp cannot reach, replaced with a stub that throws by name.
//
// 5.1 MB of a 6.8 MB bundle was descriptor blobs, and seven of the eight are for
// chains this app never talks to. Lazy imports make that free in a browser and
// ruinous through the gateway, which fetches the entire published archive from
// IPFS before running a line — so a reader on the web waited on Kusama's
// metadata to see a timeline on the devnet.
//
// chirp asks for `environment: 'devnet'` at its one call site and imports
// devnet-asset-hub directly elsewhere; the SDK's polkadot/kusama/paseo loader
// branches are unreachable from here. See src/no-such-chain.ts.
const UNREACHABLE_CHAINS = [
  'polkadot-asset-hub', 'kusama-asset-hub',
  'paseo-asset-hub', 'paseo-bulletin', 'paseo-individuality',
];
const stub = fileURLToPath(new URL('./src/no-such-chain.ts', import.meta.url));

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
  resolve: {
    alias: UNREACHABLE_CHAINS.map((c) => ({
      find: `@parity/product-sdk-descriptors/${c}`,
      replacement: stub,
    })),
  },
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
