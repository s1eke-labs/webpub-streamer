import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWebPubStreamer } from '../../src/core/createWebPubStreamer.js';
import { ensureServiceWorkerMount } from '../../src/mount/ensureServiceWorkerMount.js';
import { healthcheckUrl } from '../../src/mount/runtimeUrls.js';
import { createPublicationServiceWorkerHandler } from '../../src/service-worker/createPublicationServiceWorkerHandler.js';
import { createIndexedDbRuntimeStore } from '../../src/store/idb/createIndexedDbRuntimeStore.js';
import { createEnglishTxt } from '../helpers/createTextFixtures.js';

const encoder = new TextEncoder();

function createServiceWorkerRegistrationStub(): ServiceWorkerRegistration {
  return Object.create(null);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('service worker mounts', () => {
  it('serves health, manifest, positions, and resources through the shared handler', async () => {
    const scope = '/__webpub_streamer__/';
    const dbName = `sw-handler-${crypto.randomUUID()}`;
    const store = await createIndexedDbRuntimeStore({
      dbName,
    });

    const streamer = await createWebPubStreamer({
      mount: {
        mode: 'merged',
        scope,
        scriptUrl: 'https://example.com/root-sw.js',
        dbName,
        healthUrl: healthcheckUrl(scope, 'https://example.com'),
        ready: Promise.resolve(createServiceWorkerRegistrationStub()),
        ensureReady: async () => createServiceWorkerRegistrationStub(),
      },
      store,
    });

    const runtime = await streamer.open(encoder.encode(createEnglishTxt()).buffer, {
      format: 'txt',
    });
    const resources = await store.listResources(runtime.publicationId);
    const contentResource = resources.find((resource) => resource.path !== 'manifest.json' && resource.path !== 'positions.json');

    expect(contentResource).toBeDefined();

    const handler = createPublicationServiceWorkerHandler({
      scope,
      dbName,
      mode: 'merged',
    });

    expect(handler.matches(runtime.manifestUrl)).toBe(true);
    expect(handler.matches('https://example.com/not-webpub/resource')).toBe(false);

    const healthResponse = await handler.respond(new Request(healthcheckUrl(scope, 'https://example.com')));
    expect(healthResponse.status).toBe(200);
    await expect(healthResponse.json()).resolves.toMatchObject({
      ok: true,
      dbName,
      mode: 'merged',
      scope,
    });

    const manifestResponse = await handler.respond(new Request(runtime.manifestUrl));
    expect(manifestResponse.headers.get('Content-Type')).toBe('application/webpub+json');
    const expectedTitle = runtime.debug?.manifest.metadata.title ?? 'publication';
    await expect(manifestResponse.json()).resolves.toMatchObject({
      metadata: {
        title: expectedTitle,
      },
    });

    const positionsResponse = await handler.respond(new Request(runtime.positionsUrl));
    expect(positionsResponse.headers.get('Content-Type')).toBe('application/vnd.readium.position-list+json');
    await expect(positionsResponse.json()).resolves.toMatchObject({
      total: expect.any(Number),
    });

    const resourceUrl = new URL(contentResource!.path, runtime.baseUrl).toString();
    const resourceResponse = await handler.respond(new Request(resourceUrl));
    expect(resourceResponse.status).toBe(200);
    expect(resourceResponse.headers.get('Content-Type')).toBe(contentResource!.mediaType);
  });

  it('fails fast when standalone mount is requested on a page already controlled by another service worker', async () => {
    const register = vi.fn();

    vi.stubGlobal('navigator', {
      serviceWorker: {
        controller: {
          scriptURL: 'http://localhost/root-sw.js',
        },
        ready: Promise.resolve(createServiceWorkerRegistrationStub()),
        register,
      },
    });

    await expect(ensureServiceWorkerMount({
      scope: '/__webpub_streamer__/',
      dbName: 'fixture-db',
      scriptUrl: '/runtime-sw.js',
    })).rejects.toThrow(/connectServiceWorkerMount/);

    expect(register).not.toHaveBeenCalled();
  });
});
