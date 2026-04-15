import {
  DEFAULT_LEASE_TTL_MS,
  DEFAULT_PARSER_VERSION,
} from './constants.js';
import { fingerprintPublication, fingerprintSource } from './fingerprints.js';
import type {
  CreateWebPubStreamerOptions,
  MaterializedPublication,
  OpenPublicationOptions,
  ParserResponse,
  ParserRequestPayload,
  PersistedPublicationPayload,
  PublicationRuntime,
  ResourceRecord,
  RuntimeStore,
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
  payload: ParserRequestPayload;
}

interface ParserWorkerResponse {
  id: string;
  response: ParserResponse;
}

function createRuntimeDebug(publication: MaterializedPublication): PublicationRuntime['debug'] {
  return {
    manifest: publication.manifest,
    positions: publication.positions,
    warnings: publication.warnings,
  };
}

function toOwnedArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return Uint8Array.from(bytes).buffer;
}

function normalizeOptions(
  options: OpenPublicationOptions | undefined,
  validateByDefault: boolean,
): Required<OpenPublicationOptions> {
  return {
    format: options?.format ?? 'auto',
    targetProfile: options?.targetProfile ?? 'epub',
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

function createSharedParser(options: Pick<CreateWebPubStreamerOptions, 'parserMode' | 'parserWorkerScriptUrl'>) {
  let worker: Worker | null = null;
  let pending = new Map<string, {
    resolve: (value: MaterializedPublication) => void;
    reject: (reason?: unknown) => void;
  }>();

  const rejectPending = (error: Error): void => {
    for (const entry of pending.values()) {
      entry.reject(error);
    }
    pending = new Map();
  };

  const ensureWorker = (): Worker => {
    if (!worker) {
      const scriptUrl = options.parserWorkerScriptUrl
        ? new URL(options.parserWorkerScriptUrl, globalThis.location?.origin ?? 'http://localhost')
        : createWorkerScriptUrl();
      worker = new Worker(scriptUrl, {
        type: 'module',
      });
      worker.addEventListener('message', (event: MessageEvent<ParserWorkerResponse>) => {
        const entry = pending.get(event.data.id);
        if (!entry) {
          return;
        }

        pending.delete(event.data.id);
        if (event.data.response.ok) {
          entry.resolve(event.data.response.publication);
          return;
        }

        const error = new Error(event.data.response.error.message);
        error.name = event.data.response.error.name;
        entry.reject(error);
      });
      worker.addEventListener('error', (event) => {
        const error = new Error(event.message || 'Parser worker failed');
        rejectPending(error);
        worker?.terminate();
        worker = null;
      });
      worker.addEventListener('messageerror', () => {
        const error = new Error('Parser worker produced an unreadable message');
        rejectPending(error);
        worker?.terminate();
        worker = null;
      });
    }

    return worker;
  };

  return {
    async parse(payload: ParserRequestPayload): Promise<MaterializedPublication> {
      if (options.parserMode === 'inline' || typeof Worker === 'undefined' || typeof window === 'undefined') {
        return parseInline(payload);
      }

      const activeWorker = ensureWorker();
      const requestId = crypto.randomUUID();
      const responsePromise = new Promise<MaterializedPublication>((resolve, reject) => {
        pending.set(requestId, {
          resolve,
          reject,
        });
      });

      const request: ParserWorkerRequest = {
        id: requestId,
        payload,
      };
      activeWorker.postMessage(request);
      return responsePromise;
    },
    async terminate(): Promise<void> {
      worker?.terminate();
      worker = null;
      pending = new Map();
    },
  };
}

function createRuntime(params: {
  publication: MaterializedPublication;
  store: RuntimeStore;
  leaseId: string;
  scope: string;
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
    debug: createRuntimeDebug(params.publication),
  };
}

export async function createWebPubStreamer(
  options: CreateWebPubStreamerOptions,
): Promise<WebPubStreamer> {
  const parserVersion = options.parserVersion ?? DEFAULT_PARSER_VERSION;
  const leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const validateByDefault = options.validateByDefault ?? false;
  const parser = createSharedParser(options);
  const reportPhase = (phase: string): void => {
    options.debugReporter?.(phase);
  };

  async function openPublication(
    input: Parameters<WebPubStreamer['open']>[0],
    openOptions?: OpenPublicationOptions,
  ): Promise<PublicationRuntime> {
    reportPhase('mount-ready:start');
    await options.mount.ensureReady();
    reportPhase('mount-ready:done');
    reportPhase('gc:start');
    await options.store.gc();
    reportPhase('gc:done');

    const normalizedOptions = normalizeOptions(openOptions, validateByDefault);
    reportPhase('read-input:start');
    const resolved = await readInputSource(input, normalizedOptions.format);
    reportPhase('read-input:done');
    reportPhase('fingerprint-source:start');
    const sourceFingerprint = await fingerprintSource(resolved.bytes);
    reportPhase('fingerprint-source:done');
    reportPhase('fingerprint-publication:start');
    const publicationId = await fingerprintPublication(
      resolved.bytes,
      parserVersion,
      normalizedOptions,
    );
    reportPhase('fingerprint-publication:done');
    reportPhase('lookup:start');
    const existingPublication = normalizedOptions.cachePolicy === 'reuse'
      ? await options.store.getPublication(publicationId)
      : null;
    reportPhase('lookup:done');

    if (existingPublication) {
      reportPhase('lease:create:start');
      const lease = await options.store.createLease(publicationId, leaseTtlMs);
      reportPhase('lease:create:done');
      return createRuntime({
        publication: {
          publicationId,
          sourceFingerprint: existingPublication.sourceFingerprint,
          parserVersion: existingPublication.parserVersion,
          profileHint: existingPublication.profileHint,
          manifestPath: existingPublication.manifestPath,
          positionsPath: existingPublication.positionsPath,
          manifest: existingPublication.manifest,
          positions: existingPublication.positions,
          warnings: existingPublication.warnings,
          resources: [],
        },
        store: options.store,
        leaseId: lease.leaseId,
        scope: options.mount.scope,
      });
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

    reportPhase('parse:start');
    const materialized = await parser.parse(payload);
    reportPhase('parse:done');
    reportPhase('persist:start');
    await options.store.persistPublication(
      materializedPublicationToStorePayload(
        materialized,
        normalizedOptions.cachePolicy === 'no-store',
      ),
    );
    reportPhase('persist:done');

    reportPhase('lease:create:start');
    const lease = await options.store.createLease(publicationId, leaseTtlMs);
    reportPhase('lease:create:done');
    return createRuntime({
      publication: materialized,
      store: options.store,
      leaseId: lease.leaseId,
      scope: options.mount.scope,
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

      const lease = await options.store.createLease(publicationId, leaseTtlMs);
      return createRuntime({
        publication: {
          publicationId,
          sourceFingerprint: publication.sourceFingerprint,
          parserVersion: publication.parserVersion,
          profileHint: publication.profileHint,
          manifestPath: publication.manifestPath,
          positionsPath: publication.positionsPath,
          manifest: publication.manifest,
          positions: publication.positions,
          warnings: publication.warnings,
          resources: [],
        },
        store: options.store,
        leaseId: lease.leaseId,
        scope: options.mount.scope,
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
