import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const rootDir = resolve(__dirname, '../..');

export default defineConfig({
  root: __dirname,
  publicDir: resolve(rootDir, 'dist'),
  plugins: [react()],
  resolve: {
    alias: [
      {
        find: '@s1eke/webpub-streamer/sw',
        replacement: resolve(rootDir, 'dist/sw.js'),
      },
      {
        find: '@s1eke/webpub-streamer/testing',
        replacement: resolve(rootDir, 'dist/testing.js'),
      },
      {
        find: '@s1eke/webpub-streamer',
        replacement: resolve(rootDir, 'dist/index.js'),
      },
    ],
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
    headers: {
      'Service-Worker-Allowed': '/',
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    headers: {
      'Service-Worker-Allowed': '/',
    },
  },
});
