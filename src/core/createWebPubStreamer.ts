import {
  DEFAULT_LEASE_TTL_MS,
  DEFAULT_PARSER_VERSION,
} from './constants.js';
import { PublicationNotFoundError } from './errors.js';
import { fingerprintPublication, fingerprintSource } from './fingerprints.js';
import type {
  CreateWebPubStreamerOptions,
  MaterializedPublication,
  OpenPublicationOptions,
  ParserRequestPayload,
  ParserResponse,
  PersistedPublicationPayload,
  PublicationRecord,
  PublicationRuntime,
  PublicationRuntimeSource,
  ResourceRecord,
  RuntimeStore,
  StreamerDebugEvent,
  WebPubStreamer,
} from './types.js';
import { processPublicationRequest } from './processPublication.js';
import { readInputSource } from '../ingest/readInput.js';
import {
  publicationBaseUrl,
  publicationManifestUrl,
  publicationPositionsUrl,
} from '../mount/runtimeUrls.js';

interface ParserWorkerRequest {
  id: string;
  payload: Omit<ParserRequestPayload, 'sourceBytes'> & {
    sourceBytes: ArrayBuffer;
  };
}

interface ParserWorkerResponse {
  id: string;
  response: ParserResponse;
}

interface DebugCollector {
  emit: (event: Omit<StreamerDebugEvent, 'operationId' | 'timestamp'> & {
    timestamp?: number;
  }) => void;
  phase: (phase: string, publicationId?: string, detail?: Record<string, unknown>) => void;
  events: StreamerDebugEvent[];
  operationId: string;
}

interface ParserQueueTask {
  id: string;
  payload: ParserRequestPayload;
  resolve: (value: MaterializedPublication) => void;
  reject: (reason?: unknown) => void;
  emitDebug: DebugCollector['emit'];
}

interface ParserWorkerSlot {
  id: number;
  worker: Worker | null;
  task: ParserQueueTask | null;
}

function defaultParserWorkerPoolSize(): number {
  const hardwareConcurrency = globalThis.navigator?.hardwareConcurrency ?? 4;
  return Math.min(4, Math.max(1, Math.floor(hardwareConcurrency / 2)));
}

function createDebugCollector(options: Pick<CreateWebPubStreamerOptions, 'debugReporter' | 'debugSink'>): DebugCollector {
  const events: StreamerDebugEvent[] = [];
  const operationId = globalThis.crypto?.randomUUID?.() ?? `debug-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const emit: DebugCollector['emit'] = (event) => {
    const normalized: StreamerDebugEvent = {
      ...event,
      timestamp: event.timestamp ?? Date.now(),
      operationId,
    };
    events.push(normalized);
    if (normalized.phase) {
      options.debugReporter?.(normalized.phase);
    }
    options.debugSink?.(normalized);
  };

  return {
    emit,
    phase(phase: string, publicationId?: string, detail?: Record<string, unknown>) {
      emit({
        type: 'phase',
        phase,
        publicationId,
        detail,
      });
    },
    events,
    operationId,
  };
}

function createRuntimeDebug(
  publication: Pick<MaterializedPublication, 'manifest' | 'positions' | 'warnings' | 'source' | 'txtChapterDiagnostics'>,
  events: StreamerDebugEvent[],
): PublicationRuntime['debug'] {
  return {
    manifest: publication.manifest,
    positions: publication.positions,
    warnings: publication.warnings,
    events,
    source: publication.source,
    txtChapterDiagnostics: publication.txtChapterDiagnostics,
  };
}

function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function toTransferableSourceBuffer(bytes: Uint8Array): ArrayBuffer {
  if (
    bytes.buffer instanceof ArrayBuffer
    && bytes.byteOffset === 0
    && bytes.byteLength === bytes.buffer.byteLength
  ) {
    return bytes.buffer;
  }

  return toOwnedArrayBuffer(bytes);
}

function inferStoredSourceFormat(publication: PublicationRecord): PublicationRuntimeSource['format'] {
  if (publication.sourceFormat) {
    return publication.sourceFormat;
  }

  return publication.warnings.some((warning) => warning.code === 'TXT_ENCODING_DETECTED')
    ? 'txt'
    : 'epub';
}

function publicationSourceFromRecord(publication: PublicationRecord): PublicationRuntimeSource {
  return {
    name: publication.sourceName ?? publication.publicationId,
    mediaType: publication.sourceMediaType,
    format: inferStoredSourceFormat(publication),
    byteLength: publication.sourceByteLength ?? publication.resourceBytes ?? 0,
  };
}

function publicationFromRecord(publication: PublicationRecord): MaterializedPublication {
  return {
    publicationId: publication.publicationId,
    sourceFingerprint: publication.sourceFingerprint,
    parserVersion: publication.parserVersion,
    profileHint: publication.profileHint,
    manifestPath: publication.manifestPath,
    positionsPath: publication.positionsPath,
    manifest: publication.manifest,
    positions: publication.positions,
    warnings: publication.warnings,
    resources: [],
    source: publicationSourceFromRecord(publication),
    txtChapterDiagnostics: publication.txtChapterDiagnostics,
  };
}

function isPublicationNotFoundError(error: unknown): error is PublicationNotFoundError {
  return error instanceof PublicationNotFoundError
    || (
      error instanceof Error
      && 'code' in error
      && error.code === 'PUBLICATION_NOT_FOUND'
    );
}

function normalizeOptions(
  options: OpenPublicationOptions | undefined,
  validateByDefault: boolean,
  defaultTargetProfile: OpenPublicationOptions['targetProfile'],
): Required<OpenPublicationOptions> {
  return {
    format: options?.format ?? 'auto',
    targetProfile: options?.targetProfile ?? defaultTargetProfile ?? 'epub',
    cachePolicy: options?.cachePolicy ?? 'reuse',
    validate: options?.validate ?? validateByDefault,
    txt: {
      encoding: options?.txt?.encoding,
      chapterDetection: options?.txt?.chapterDetection ?? 'auto',
      chapterPatterns: options?.txt?.chapterPatterns ?? [],
      language: options?.txt?.language,
      title: options?.txt?.title,
    },
    epub: {
      allowRemoteResources: options?.epub?.allowRemoteResources ?? 'reject',
      javascriptPolicy: options?.epub?.javascriptPolicy ?? 'strip',
      unsupportedFontPolicy: options?.epub?.unsupportedFontPolicy ?? 'warn-and-drop',
    },
  };
}

function materializedPublicationToStorePayload(
  publication: MaterializedPublication,
  ephemeral: boolean,
): PersistedPublicationPayload {
  const createdAt = Date.now();
  const resources: ResourceRecord[] = publication.resources.map((resource) => ({
    id: `${publication.publicationId}:${resource.path}`,
    publicationId: publication.publicationId,
    path: resource.path,
    mediaType: resource.mediaType,
    body: new Blob([toOwnedArrayBuffer(resource.body)], {
      type: resource.mediaType,
    }),
    byteLength: resource.body.byteLength,
    textContent: resource.textContent,
  }));

  return {
    publication: {
      publicationId: publication.publicationId,
      sourceFingerprint: publication.sourceFingerprint,
      parserVersion: publication.parserVersion,
      createdAt,
      lastAccessAt: createdAt,
      profileHint: publication.profileHint,
      manifestPath: publication.manifestPath,
      positionsPath: publication.positionsPath,
      manifest: publication.manifest,
      positions: publication.positions,
      warnings: publication.warnings,
      refCount: 0,
      ephemeral,
      sourceName: publication.source.name,
      sourceMediaType: publication.source.mediaType,
      sourceFormat: publication.source.format,
      sourceByteLength: publication.source.byteLength,
      txtChapterDiagnostics: publication.txtChapterDiagnostics,
    },
    resources,
  };
}

async function parseInline(payload: ParserRequestPayload): Promise<MaterializedPublication> {
  return processPublicationRequest(payload);
}

function createWorkerScriptUrl(): URL {
  return new URL(
    /* @vite-ignore */
    './parser-worker.js',
    import.meta.url,
  );
}

function toWorkerError(response: ParserResponse | Error): Error {
  if (response instanceof Error) {
    return response;
  }

  if (response.ok) {
    return new Error('Unexpected successful parser response');
  }

  const error = new Error(response.error.message);
  error.name = response.error.name;
  return error;
}

function createSharedParser(
  options: Pick<CreateWebPubStreamerOptions, 'parserMode' | 'parserWorkerScriptUrl' | 'parserWorkerPoolSize'>,
) {
  const poolSize = Math.max(1, options.parserWorkerPoolSize ?? defaultParserWorkerPoolSize());
  const queue: ParserQueueTask[] = [];
  const workerSlots: ParserWorkerSlot[] = [];

  const createWorker = (slot: ParserWorkerSlot): Worker => {
    const scriptUrl = options.parserWorkerScriptUrl
      ? new URL(options.parserWorkerScriptUrl, globalThis.location?.origin ?? 'http://localhost')
      : createWorkerScriptUrl();
    const worker = new Worker(scriptUrl, {
      type: 'module',
    });

    const resetSlot = (): void => {
      worker.terminate();
      if (slot.worker === worker) {
        slot.worker = null;
      }
      slot.task = null;
    };

    worker.addEventListener('message', (event: MessageEvent<ParserWorkerResponse>) => {
      if (slot.worker !== worker || !slot.task || slot.task.id !== event.data.id) {
        return;
      }

      const task = slot.task;
      slot.task = null;
      if (event.data.response.ok) {
        task.emitDebug({
          type: 'parse',
          publicationId: task.payload.publicationId,
          detail: {
            status: 'done',
            mode: 'worker',
            workerId: slot.id,
          },
        });
        task.resolve(event.data.response.publication);
      } else {
        task.emitDebug({
          type: 'parse',
          publicationId: task.payload.publicationId,
          detail: {
            status: 'error',
            mode: 'worker',
            workerId: slot.id,
            errorName: event.data.response.error.name,
          },
        });
        task.reject(toWorkerError(event.data.response));
      }

      dispatchQueue();
    });

    const handleWorkerFailure = (error: Error): void => {
      if (slot.worker !== worker) {
        return;
      }

      const task = slot.task;
      resetSlot();
      if (task) {
        task.emitDebug({
          type: 'parse',
          publicationId: task.payload.publicationId,
          detail: {
            status: 'error',
            mode: 'worker',
            workerId: slot.id,
            errorName: error.name,
          },
        });
        task.reject(error);
      }

      dispatchQueue();
    };

    worker.addEventListener('error', (event) => {
      handleWorkerFailure(new Error(event.message || 'Parser worker failed'));
    });
    worker.addEventListener('messageerror', () => {
      handleWorkerFailure(new Error('Parser worker produced an unreadable message'));
    });

    return worker;
  };

  const getAvailableSlot = (): ParserWorkerSlot | null => {
    const idleSlot = workerSlots.find((slot) => !slot.task);
    if (idleSlot) {
      return idleSlot;
    }

    if (workerSlots.length >= poolSize) {
      return null;
    }

    const slot: ParserWorkerSlot = {
      id: workerSlots.length + 1,
      worker: null,
      task: null,
    };
    workerSlots.push(slot);
    return slot;
  };

  const dispatchQueue = (): void => {
    while (queue.length > 0) {
      const slot = getAvailableSlot();
      if (!slot) {
        return;
      }

      if (!slot.worker) {
        slot.worker = createWorker(slot);
      }

      const task = queue.shift();
      if (!task) {
        return;
      }

      slot.task = task;
      task.emitDebug({
        type: 'dispatch',
        publicationId: task.payload.publicationId,
        detail: {
          workerId: slot.id,
          queueSize: queue.length,
          poolSize,
        },
      });
      task.emitDebug({
        type: 'parse',
        publicationId: task.payload.publicationId,
        detail: {
          status: 'start',
          mode: 'worker',
          workerId: slot.id,
        },
      });

      const request: ParserWorkerRequest = {
        id: task.id,
        payload: {
          ...task.payload,
          sourceBytes: toTransferableSourceBuffer(task.payload.sourceBytes),
        },
      };
      slot.worker.postMessage(request, [request.payload.sourceBytes]);
    }
  };

  return {
    async parse(payload: ParserRequestPayload, emitDebug: DebugCollector['emit']): Promise<MaterializedPublication> {
      if (options.parserMode === 'inline' || typeof Worker === 'undefined') {
        emitDebug({
          type: 'parse',
          publicationId: payload.publicationId,
          detail: {
            status: 'start',
            mode: 'inline',
          },
        });
        const publication = await parseInline(payload);
        emitDebug({
          type: 'parse',
          publicationId: payload.publicationId,
          detail: {
            status: 'done',
            mode: 'inline',
          },
        });
        return publication;
      }

      const requestId = crypto.randomUUID();
      emitDebug({
        type: 'queue',
        publicationId: payload.publicationId,
        detail: {
          queueSize: queue.length + 1,
          poolSize,
        },
      });
      const responsePromise = new Promise<MaterializedPublication>((resolve, reject) => {
        queue.push({
          id: requestId,
          payload,
          resolve,
          reject,
          emitDebug,
        });
      });

      dispatchQueue();
      return responsePromise;
    },
    async terminate(): Promise<void> {
      const error = new Error('Parser worker pool terminated');
      for (const slot of workerSlots) {
        slot.worker?.terminate();
        slot.worker = null;
        slot.task?.reject(error);
        slot.task = null;
      }

      while (queue.length > 0) {
        queue.shift()?.reject(error);
      }
    },
  };
}

function createRuntime(params: {
  publication: MaterializedPublication;
  store: RuntimeStore;
  leaseId: string;
  scope: string;
  debugEvents: StreamerDebugEvent[];
}): PublicationRuntime {
  const manifestUrl = publicationManifestUrl(params.scope, params.publication.publicationId);
  const positionsUrl = publicationPositionsUrl(params.scope, params.publication.publicationId);
  const baseUrl = publicationBaseUrl(params.scope, params.publication.publicationId);

  let leaseReleased = false;

  return {
    publicationId: params.publication.publicationId,
    manifestUrl,
    positionsUrl,
    baseUrl,
    profileHint: params.publication.profileHint,
    suggestedLocalDataKey: `webpub-streamer:${params.publication.publicationId}`,
    async release() {
      if (leaseReleased) {
        return;
      }

      leaseReleased = true;
      await params.store.releaseLease(params.leaseId);
      await params.store.gc();
    },
    async destroy() {
      const needsRelease = !leaseReleased;
      leaseReleased = true;
      if (needsRelease) {
        await params.store.releaseLease(params.leaseId);
      }
      await params.store.markPublicationDestroyed(params.publication.publicationId);
      await params.store.gc();
    },
    debug: createRuntimeDebug(params.publication, params.debugEvents),
  };
}

export async function createWebPubStreamer(
  options: CreateWebPubStreamerOptions,
): Promise<WebPubStreamer> {
  const parserVersion = options.parserVersion ?? DEFAULT_PARSER_VERSION;
  const leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const validateByDefault = options.validateByDefault ?? false;
  const parser = createSharedParser(options);

  async function openPublication(
    input: Parameters<WebPubStreamer['open']>[0],
    openOptions?: OpenPublicationOptions,
  ): Promise<PublicationRuntime> {
    const debug = createDebugCollector(options);
    debug.phase('mount-ready:start');
    await options.mount.ensureReady();
    debug.phase('mount-ready:done');
    debug.phase('gc:start');
    await options.store.gc({
      debugSink: debug.emit,
    });
    debug.phase('gc:done');

    const normalizedOptions = normalizeOptions(
      openOptions,
      validateByDefault,
      options.defaultTargetProfile,
    );
    debug.phase('read-input:start');
    const resolved = await readInputSource(input, normalizedOptions.format);
    debug.phase('read-input:done');
    debug.phase('fingerprint-source:start');
    const sourceFingerprint = await fingerprintSource(resolved.bytes);
    debug.phase('fingerprint-source:done');
    debug.phase('fingerprint-publication:start');
    const publicationId = await fingerprintPublication(
      resolved.bytes,
      parserVersion,
      normalizedOptions,
    );
    debug.phase('fingerprint-publication:done', publicationId);
    debug.phase('lookup:start', publicationId);
    const existingPublication = normalizedOptions.cachePolicy === 'reuse'
      ? await options.store.getPublication(publicationId)
      : null;
    debug.phase('lookup:done', publicationId);

    if (existingPublication) {
      debug.emit({
        type: 'cache-hit',
        publicationId,
        detail: {
          cachePolicy: normalizedOptions.cachePolicy,
        },
      });
      debug.phase('lease:create:start', publicationId);
      debug.emit({
        type: 'lease',
        publicationId,
        detail: {
          status: 'start',
        },
      });
      try {
        const lease = await options.store.createLease(publicationId, leaseTtlMs);
        debug.emit({
          type: 'lease',
          publicationId,
          detail: {
            status: 'done',
            leaseId: lease.leaseId,
          },
        });
        debug.phase('lease:create:done', publicationId);
        return createRuntime({
          publication: publicationFromRecord(existingPublication),
          store: options.store,
          leaseId: lease.leaseId,
          scope: options.mount.scope,
          debugEvents: [...debug.events],
        });
      } catch (error) {
        if (!isPublicationNotFoundError(error)) {
          throw error;
        }

        debug.emit({
          type: 'lease',
          publicationId,
          detail: {
            status: 'stale-cache',
          },
        });
        debug.phase('lease:create:stale-cache', publicationId);
      }
    }

    const publicationBase = publicationBaseUrl(options.mount.scope, publicationId);
    const payload: ParserRequestPayload = {
      publicationId,
      sourceBytes: resolved.bytes,
      sourceFingerprint,
      sourceName: resolved.fileName,
      sourceMediaType: resolved.mediaType,
      format: resolved.format,
      options: normalizedOptions,
      parserVersion,
      manifestBaseUrl: publicationBase,
    };

    debug.phase('parse:start', publicationId);
    const materialized = await parser.parse(payload, debug.emit);
    debug.phase('parse:done', publicationId);
    debug.phase('persist:start', publicationId);
    debug.emit({
      type: 'persist',
      publicationId,
      detail: {
        status: 'start',
      },
    });
    await options.store.persistPublication(
      materializedPublicationToStorePayload(
        materialized,
        normalizedOptions.cachePolicy === 'no-store',
      ),
    );
    debug.emit({
      type: 'persist',
      publicationId,
      detail: {
        status: 'done',
      },
    });
    debug.phase('persist:done', publicationId);

    debug.phase('lease:create:start', publicationId);
    debug.emit({
      type: 'lease',
      publicationId,
      detail: {
        status: 'start',
      },
    });
    const lease = await options.store.createLease(publicationId, leaseTtlMs);
    debug.emit({
      type: 'lease',
      publicationId,
      detail: {
        status: 'done',
          leaseId: lease.leaseId,
        },
      });
    debug.phase('lease:create:done', publicationId);

    debug.phase('gc:post-persist:start', publicationId);
    await options.store.gc({
      debugSink: debug.emit,
    });
    debug.phase('gc:post-persist:done', publicationId);

    return createRuntime({
      publication: materialized,
      store: options.store,
      leaseId: lease.leaseId,
      scope: options.mount.scope,
      debugEvents: [...debug.events],
    });
  }

  return {
    open: openPublication,
    async get(publicationId: string): Promise<PublicationRuntime | null> {
      await options.mount.ensureReady();
      const publication = await options.store.getPublication(publicationId);
      if (!publication) {
        return null;
      }

      let lease: Awaited<ReturnType<RuntimeStore['createLease']>>;
      try {
        lease = await options.store.createLease(publicationId, leaseTtlMs);
      } catch (error) {
        if (isPublicationNotFoundError(error)) {
          return null;
        }

        throw error;
      }

      return createRuntime({
        publication: publicationFromRecord(publication),
        store: options.store,
        leaseId: lease.leaseId,
        scope: options.mount.scope,
        debugEvents: [],
      });
    },
    async destroy(publicationId: string): Promise<void> {
      await options.store.markPublicationDestroyed(publicationId);
      await options.store.gc();
    },
    async clear(): Promise<void> {
      await options.store.clear();
      await parser.terminate();
    },
  };
}
