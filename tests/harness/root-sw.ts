import { createPublicationServiceWorkerHandler } from '@s1eke/webpub-streamer/sw';

declare const self: ServiceWorkerGlobalScope;

const handler = createPublicationServiceWorkerHandler({
  scope: '/__webpub_streamer__/',
  dbName: 'webpub-streamer-harness',
  mode: 'merged',
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
