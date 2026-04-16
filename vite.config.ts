/// <reference types="vitest/config" />

import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const rootDir = __dirname;

export default defineConfig({
  plugins: [
    react(),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
    emptyOutDir: true,
    lib: {
      entry: {
        index: resolve(rootDir, 'src/index.ts'),
        sw: resolve(rootDir, 'src/sw.ts'),
        debug: resolve(rootDir, 'src/debug.ts'),
        testing: resolve(rootDir, 'src/testing.ts'),
        'runtime-sw': resolve(rootDir, 'src/workers/runtime-sw.ts'),
        'parser-worker': resolve(rootDir, 'src/workers/parser.worker.ts'),
      },
      formats: ['es'],
    },
    rollupOptions: {
      external: [
        '@edrlab/thorium-web',
        '@edrlab/thorium-web/misc',
        '@edrlab/thorium-web/misc/styles',
        '@edrlab/thorium-web/reader',
        '@edrlab/thorium-web/reader/styles',
        'react',
        'react-dom',
        'react/jsx-runtime',
      ],
      output: {
        entryFileNames: (chunkInfo) => `${chunkInfo.name}.js`,
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['tests/unit/setup.ts'],
    coverage: {
      reporter: ['text', 'lcov'],
    },
  },
});
