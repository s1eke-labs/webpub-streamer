import { describe, expect, it } from 'vitest';

import type { StreamerDebugEvent } from '../../src/core/types.js';
import { createWebPubStreamer } from '../../src/core/createWebPubStreamer.js';
import { inspectIndexedDbRuntimeStore } from '../../src/debug/inspectIndexedDbRuntimeStore.js';
import { createIndexedDbRuntimeStore } from '../../src/store/idb/createIndexedDbRuntimeStore.js';
import { createEnglishTxt } from '../helpers/createTextFixtures.js';

const encoder = new TextEncoder();

function createServiceWorkerRegistrationStub(): ServiceWorkerRegistration {
  return Object.create(null);
}

function createMountStub(dbName: string) {
  const registrationStub = createServiceWorkerRegistrationStub();
  return {
    mode: 'merged' as const,
    scope: '/__webpub_streamer__/',
    scriptUrl: '/runtime-sw.js',
    dbName,
    healthUrl: '/__webpub_streamer__/__health',
    ready: Promise.resolve(registrationStub),
    ensureReady: async () => registrationStub,
  };
}

describe('runtime debug exports', () => {
  it('captures structured debug events, source metadata, and TXT diagnostics', async () => {
    const store = await createIndexedDbRuntimeStore({
      dbName: `debug-runtime-${crypto.randomUUID()}`,
    });
    const sinkEvents: StreamerDebugEvent[] = [];
    const streamer = await createWebPubStreamer({
      mount: createMountStub(store.dbName),
      store,
      debugSink: (event) => {
        sinkEvents.push(event);
      },
    });

    const firstRuntime = await streamer.open({
      name: 'debug-fixture.txt',
      mediaType: 'text/plain',
      data: encoder.encode(createEnglishTxt()).buffer,
    }, {
      format: 'txt',
    });

    expect(firstRuntime.debug?.source).toEqual({
      name: 'debug-fixture.txt',
      mediaType: 'text/plain',
      format: 'txt',
      byteLength: encoder.encode(createEnglishTxt()).byteLength,
    });
    expect(firstRuntime.debug?.txtChapterDiagnostics?.length).toBeGreaterThan(0);
    expect(firstRuntime.debug?.events.some((event) => event.type === 'parse')).toBe(true);
    expect(firstRuntime.debug?.events.some((event) => event.type === 'persist')).toBe(true);
    expect(sinkEvents.some((event) => event.type === 'lease')).toBe(true);

    const secondRuntime = await streamer.open({
      name: 'debug-fixture.txt',
      mediaType: 'text/plain',
      data: encoder.encode(createEnglishTxt()).buffer,
    }, {
      format: 'txt',
    });

    expect(secondRuntime.debug?.events.some((event) => event.type === 'cache-hit')).toBe(true);
    expect(secondRuntime.debug?.events.some((event) => event.type === 'parse')).toBe(false);

    const snapshot = await inspectIndexedDbRuntimeStore({
      dbName: store.dbName,
    });
    expect(snapshot.publicationCount).toBe(1);
    expect(snapshot.totalResourceBytes).toBeGreaterThan(0);
    expect(snapshot.publications[0]?.source?.format).toBe('txt');
    expect(snapshot.publications[0]?.txtChapterDiagnostics?.length).toBeGreaterThan(0);

    await firstRuntime.release();
    await secondRuntime.release();
  });
});
