import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createWebPubStreamer } from '../../src/core/createWebPubStreamer.js';
import { processPublicationRequest } from '../../src/core/processPublication.js';
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

type WorkerBehavior = 'success' | 'error';

class FakeParserWorker {
  static activeCount = 0;
  static maxActiveCount = 0;
  static constructorCount = 0;
  static behaviorBySourceName = new Map<string, WorkerBehavior>();

  private readonly listeners = new Map<string, Array<(event: any) => void>>();
  private terminated = false;

  constructor(url: URL, options: WorkerOptions) {
    if (!(url instanceof URL)) {
      throw new TypeError('Expected parser worker URL');
    }
    if (options.type !== 'module') {
      throw new TypeError('Expected module worker options');
    }
    FakeParserWorker.constructorCount += 1;
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  postMessage(message: {
    id: string;
    payload: {
      sourceName: string;
      sourceBytes: ArrayBuffer;
    };
  }): void {
    FakeParserWorker.activeCount += 1;
    FakeParserWorker.maxActiveCount = Math.max(
      FakeParserWorker.maxActiveCount,
      FakeParserWorker.activeCount,
    );

    queueMicrotask(async () => {
      if (this.terminated) {
        FakeParserWorker.activeCount -= 1;
        return;
      }

      const behavior = FakeParserWorker.behaviorBySourceName.get(message.payload.sourceName) ?? 'success';
      if (behavior === 'error') {
        FakeParserWorker.activeCount -= 1;
        this.emit('error', {
          message: `Synthetic parser crash for ${message.payload.sourceName}`,
        });
        return;
      }

      try {
        await new Promise((resolve) => {
          setTimeout(resolve, 10);
        });
        const request: Parameters<typeof processPublicationRequest>[0] = {
          ...message.payload,
          sourceBytes: new Uint8Array(message.payload.sourceBytes),
        };
        const publication = await processPublicationRequest(request);
        FakeParserWorker.activeCount -= 1;
        this.emit('message', {
          data: {
            id: message.id,
            response: {
              ok: true,
              publication,
            },
          },
        });
      } catch (error) {
        const normalizedError = error instanceof Error ? error : new Error(String(error));
        FakeParserWorker.activeCount -= 1;
        this.emit('message', {
          data: {
            id: message.id,
            response: {
              ok: false,
              error: {
                name: normalizedError.name,
                message: normalizedError.message,
              },
            },
          },
        });
      }
    });
  }

  terminate(): void {
    this.terminated = true;
  }

  private emit(type: string, event: any): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

function resetFakeWorkerState(): void {
  FakeParserWorker.activeCount = 0;
  FakeParserWorker.maxActiveCount = 0;
  FakeParserWorker.constructorCount = 0;
  FakeParserWorker.behaviorBySourceName.clear();
}

describe('parser worker pool', () => {
  const originalWorker = globalThis.Worker;

  beforeEach(() => {
    resetFakeWorkerState();
    Object.assign(globalThis, {
      Worker: FakeParserWorker,
    });
  });

  afterEach(() => {
    if (originalWorker) {
      Object.assign(globalThis, {
        Worker: originalWorker,
      });
      return;
    }

    Reflect.deleteProperty(globalThis, 'Worker');
  });

  it('limits concurrent parser work to the configured pool size', async () => {
    const store = await createIndexedDbRuntimeStore({
      dbName: `worker-pool-${crypto.randomUUID()}`,
    });
    const streamer = await createWebPubStreamer({
      mount: createMountStub(store.dbName),
      store,
      parserWorkerPoolSize: 2,
    });

    const runtimes = await Promise.all([
      streamer.open({
        name: 'one.txt',
        mediaType: 'text/plain',
        data: encoder.encode(`${createEnglishTxt()}\n\nOne`).buffer,
      }, {
        format: 'txt',
      }),
      streamer.open({
        name: 'two.txt',
        mediaType: 'text/plain',
        data: encoder.encode(`${createEnglishTxt()}\n\nTwo`).buffer,
      }, {
        format: 'txt',
      }),
      streamer.open({
        name: 'three.txt',
        mediaType: 'text/plain',
        data: encoder.encode(`${createEnglishTxt()}\n\nThree`).buffer,
      }, {
        format: 'txt',
      }),
    ]);

    expect(FakeParserWorker.maxActiveCount).toBe(2);
    expect(runtimes.every((runtime) => runtime.debug?.events.some((event) => event.type === 'dispatch'))).toBe(true);

    await Promise.all(runtimes.map((runtime) => runtime.release()));
  });

  it('rejects only the crashing task and recreates workers for later tasks', async () => {
    FakeParserWorker.behaviorBySourceName.set('broken.txt', 'error');

    const store = await createIndexedDbRuntimeStore({
      dbName: `worker-crash-${crypto.randomUUID()}`,
    });
    const streamer = await createWebPubStreamer({
      mount: createMountStub(store.dbName),
      store,
      parserWorkerPoolSize: 1,
    });

    await expect(streamer.open({
      name: 'broken.txt',
      mediaType: 'text/plain',
      data: encoder.encode(createEnglishTxt()).buffer,
    }, {
      format: 'txt',
    })).rejects.toThrow(/Synthetic parser crash/);

    const workersAfterCrash = FakeParserWorker.constructorCount;
    const runtime = await streamer.open({
      name: 'healthy.txt',
      mediaType: 'text/plain',
      data: encoder.encode(`${createEnglishTxt()}\n\nRecovered`).buffer,
    }, {
      format: 'txt',
    });

    expect(FakeParserWorker.constructorCount).toBeGreaterThan(workersAfterCrash);
    expect(runtime.debug?.events.some((event) => event.type === 'parse')).toBe(true);

    await runtime.release();
  });
});
