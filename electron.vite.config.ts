import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { copyFileSync } from 'fs';
import { resolve } from 'path';
import type { Plugin } from 'vite';

/**
 * tiny-secp256k1 loads its WASM binary relative to the bundled main module.
 * Vite inlines the loader but not the .wasm asset, so copy it into out/main
 * for both dev builds and packaged releases.
 */
function copyTinySecpWasm(): Plugin {
  return {
    name: 'copy-tiny-secp256k1-wasm',
    closeBundle() {
      copyFileSync(
        resolve(__dirname, 'node_modules/tiny-secp256k1/lib/secp256k1.wasm'),
        resolve(__dirname, 'out/main/secp256k1.wasm'),
      );
    },
  };
}

export default defineConfig({
  main: {
    plugins: [copyTinySecpWasm()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    build: {
      outDir: 'out/main',
      lib: {
        entry: resolve(__dirname, 'electron/main.ts'),
        formats: ['cjs'],
        fileName: () => 'index.js',
      },
    },
  },

  preload: {
    build: {
      outDir: 'out/preload',
      lib: {
        entry: resolve(__dirname, 'electron/preload.ts'),
        formats: ['cjs'],
        fileName: () => 'index.js',
      },
    },
  },

  renderer: {
    root: '.',
    // Keep the wallet off 5173 so a landing-page or other Vite dev server
    // cannot be mistaken for the wallet renderer.
    server: {
      port: 5180,
      strictPort: true,
    },
    plugins: [react()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@shared': resolve(__dirname, 'src/types'),
      },
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html'),
        },
      },
    },
  },
});
