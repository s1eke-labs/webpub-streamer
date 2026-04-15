/// <reference lib="webworker" />

import { DEFAULT_DB_NAME, DEFAULT_SCOPE } from '../core/constants.js';
import { normalizeScope } from '../mount/runtimeUrls.js';
import { createPublicationServiceWorkerHandler } from '../service-worker/createPublicationServiceWorkerHandler.js';

declare const self: ServiceWorkerGlobalScope;

const scriptUrl = new URL(self.location.href);
const dbName = scriptUrl.searchParams.get('dbName') ?? DEFAULT_DB_NAME;
const scope = normalizeScope(
  self.registration.scope ? new URL(self.registration.scope).pathname : DEFAULT_SCOPE,
);
const handler = createPublicationServiceWorkerHandler({
  dbName,
  scope,
  mode: 'standalone',
});

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (!handler.matches(event.request)) {
    return;
  }

  event.respondWith(handler.respond(event.request));
});
