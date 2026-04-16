import { describe, expect, it } from 'vitest';

import type { RuntimeStore } from '../../src/core/types.js';
import { createWebPubStreamer } from '../../src/core/createWebPubStreamer.js';
import { processPublicationRequest } from '../../src/core/processPublication.js';
import { publicationManifestUrl } from '../../src/mount/runtimeUrls.js';
import { createIndexedDbRuntimeStore } from '../../src/store/idb/createIndexedDbRuntimeStore.js';
import { assertManifestConforms } from '../../src/testing/assertManifestConforms.js';
import { assertPositionsValid } from '../../src/testing/assertPositionsValid.js';
import { createEnglishTxt } from '../helpers/createTextFixtures.js';

const encoder = new TextEncoder();

function createServiceWorkerRegistrationStub(): ServiceWorkerRegistration {
  return Object.create(null);
}

describe('materialization and store lifecycle', () => {
  it('builds valid manifest and positions payloads', async () => {
    const publication = await processPublicationRequest({
      publicationId: 'fixture-publication',
      sourceBytes: encoder.encode(createEnglishTxt()),
      sourceName: 'fixture.txt',
      sourceMediaType: 'text/plain',
      sourceFingerprint: 'source-fingerprint',
      format: 'txt',
      parserVersion: '1.0.0',
      manifestBaseUrl: 'https://example.com/__webpub_streamer__/pub/fixture-publication/',
      options: {
        format: 'txt',
        targetProfile: 'epub',
        cachePolicy: 'reuse',
        validate: true,
        txt: {
          chapterDetection: 'auto',
          chapterPatterns: [],
          language: 'en',
          title: 'Fixture',
          encoding: undefined,
        },
        epub: {
          allowRemoteResources: 'reject',
          javascriptPolicy: 'strip',
          unsupportedFontPolicy: 'warn-and-drop',
        },
      },
    });

    assertManifestConforms(publication.manifest, 'epub');
    assertPositionsValid(publication.positions);
    expect(publication.resources.some((item) => item.path === 'manifest.json')).toBe(true);
  });

  it('opens a text runtime and manages leases', async () => {
    const store = await createIndexedDbRuntimeStore({
      dbName: `test-db-${crypto.randomUUID()}`,
    });
    const registrationStub = createServiceWorkerRegistrationStub();

    const streamer = await createWebPubStreamer({
      mount: {
        mode: 'merged',
        scope: '/__webpub_streamer__/',
        scriptUrl: '/runtime-sw.js',
        dbName: store.dbName,
        healthUrl: '/__webpub_streamer__/__health',
        ready: Promise.resolve(registrationStub),
        ensureReady: async () => registrationStub,
      },
      store,
    });

    const runtime = await streamer.open(encoder.encode(createEnglishTxt()).buffer, {
      format: 'txt',
    });

    expect(runtime.manifestUrl).toBe(publicationManifestUrl('/__webpub_streamer__/', runtime.publicationId));
    expect(await store.countActiveLeases(runtime.publicationId)).toBe(1);

    await runtime.release();
    expect(await store.countActiveLeases(runtime.publicationId)).toBe(0);

    await streamer.destroy(runtime.publicationId);
    expect(await store.getPublication(runtime.publicationId)).toBeNull();
  });

  it('rebuilds the runtime when a cached publication is pruned before lease creation', async () => {
    const backingStore = await createIndexedDbRuntimeStore({
      dbName: `stale-cache-db-${crypto.randomUUID()}`,
    });
    const registrationStub = createServiceWorkerRegistrationStub();
    let leaseCreationCount = 0;
    const store: RuntimeStore = {
      ...backingStore,
      async createLease(publicationId, ttlMs) {
        leaseCreationCount += 1;
        if (leaseCreationCount === 2) {
          await backingStore.destroyPublication(publicationId);
        }

        return backingStore.createLease(publicationId, ttlMs);
      },
    };

    const streamer = await createWebPubStreamer({
      mount: {
        mode: 'merged',
        scope: '/__webpub_streamer__/',
        scriptUrl: '/runtime-sw.js',
        dbName: backingStore.dbName,
        healthUrl: '/__webpub_streamer__/__health',
        ready: Promise.resolve(registrationStub),
        ensureReady: async () => registrationStub,
      },
      store,
    });

    const firstRuntime = await streamer.open(encoder.encode(createEnglishTxt()).buffer, {
      format: 'txt',
    });
    await firstRuntime.release();

    const rebuiltRuntime = await streamer.open(encoder.encode(createEnglishTxt()).buffer, {
      format: 'txt',
    });

    expect(rebuiltRuntime.publicationId).toBe(firstRuntime.publicationId);
    expect(rebuiltRuntime.debug?.events.some((event) => event.type === 'cache-hit')).toBe(true);
    expect(rebuiltRuntime.debug?.events.some((event) => event.type === 'parse')).toBe(true);
    expect(rebuiltRuntime.debug?.events.some((event) => event.type === 'lease' && event.detail?.status === 'stale-cache')).toBe(true);

    await rebuiltRuntime.release();
  });
});
