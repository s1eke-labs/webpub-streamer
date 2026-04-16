import { describe, expect, it } from 'vitest';

import type {
  PersistedPublicationPayload,
  PublicationRecord,
} from '../../src/core/types.js';
import { PublicationNotFoundError } from '../../src/core/errors.js';
import { inspectIndexedDbRuntimeStore } from '../../src/debug/inspectIndexedDbRuntimeStore.js';
import { createIndexedDbRuntimeStore } from '../../src/store/idb/createIndexedDbRuntimeStore.js';
import { openRuntimeDatabase, resourceId } from '../../src/store/idb/schema.js';

function createManifest(publicationId: string) {
  return {
    '@context': 'https://readium.org/webpub-manifest/context.jsonld',
    metadata: {
      '@type': 'http://schema.org/Book' as const,
      title: publicationId,
    },
    links: [{
      rel: 'self',
      href: `https://example.com/${publicationId}/manifest.json`,
      type: 'application/webpub+json',
    }],
    readingOrder: [{
      href: 'spine/chapter-001.xhtml',
      type: 'application/xhtml+xml',
      title: 'Start',
    }],
  };
}

function createPositions() {
  return {
    total: 1,
    positions: [{
      href: 'spine/chapter-001.xhtml',
      type: 'application/xhtml+xml',
      title: 'Start',
      locations: {
        position: 1,
        progression: 0,
        totalProgression: 0,
      },
    }],
  };
}

function createPersistedPayload(params: {
  publicationId: string;
  createdAt: number;
  lastAccessAt: number;
  ephemeral?: boolean;
  destroyedAt?: number;
  resourceSizes: number[];
}): PersistedPublicationPayload {
  const totalSourceBytes = params.resourceSizes.reduce((total, size) => total + size, 0);
  return {
    publication: {
      publicationId: params.publicationId,
      sourceFingerprint: `fingerprint-${params.publicationId}`,
      parserVersion: '1.0.0',
      createdAt: params.createdAt,
      lastAccessAt: params.lastAccessAt,
      profileHint: 'epub',
      manifestPath: 'manifest.json',
      positionsPath: 'positions.json',
      manifest: createManifest(params.publicationId),
      positions: createPositions(),
      warnings: [],
      refCount: 0,
      ephemeral: params.ephemeral ?? false,
      destroyedAt: params.destroyedAt,
      sourceName: `${params.publicationId}.txt`,
      sourceMediaType: 'text/plain',
      sourceFormat: 'txt',
      sourceByteLength: totalSourceBytes,
      txtChapterDiagnostics: [{
        title: 'Start',
        lineNumber: 1,
        source: 'fallback',
      }],
    },
    resources: params.resourceSizes.map((size, index) => ({
      id: `${params.publicationId}:resource-${index}`,
      publicationId: params.publicationId,
      path: index === 0 ? 'spine/chapter-001.xhtml' : `assets/resource-${index}.bin`,
      mediaType: index === 0 ? 'application/xhtml+xml' : 'application/octet-stream',
      body: new Blob([new Uint8Array(size)]),
      byteLength: size,
    })),
  };
}

describe('IndexedDB runtime store GC', () => {
  it('evicts inactive publications by TTL but keeps active leases alive', async () => {
    const baseTimestamp = Date.now();
    const store = await createIndexedDbRuntimeStore({
      dbName: `gc-ttl-${crypto.randomUUID()}`,
      gcPolicy: {
        inactiveTtlMs: 50,
        maxTotalBytes: 1024,
      },
    });

    await store.persistPublication(createPersistedPayload({
      publicationId: 'inactive-publication',
      createdAt: baseTimestamp,
      lastAccessAt: baseTimestamp,
      resourceSizes: [8],
    }));
    await store.persistPublication(createPersistedPayload({
      publicationId: 'active-publication',
      createdAt: baseTimestamp,
      lastAccessAt: baseTimestamp,
      resourceSizes: [8],
    }));

    const lease = await store.createLease('active-publication', 1_000);
    await store.gc({
      timestamp: baseTimestamp + 100,
    });

    expect(await store.getPublication('inactive-publication')).toBeNull();
    expect(await store.getPublication('active-publication')).not.toBeNull();

    await store.releaseLease(lease.leaseId);
  });

  it('uses LRU eviction when inactive bytes exceed the configured budget', async () => {
    const baseTimestamp = Date.now();
    const store = await createIndexedDbRuntimeStore({
      dbName: `gc-lru-${crypto.randomUUID()}`,
      gcPolicy: {
        inactiveTtlMs: 10_000,
        maxTotalBytes: 10,
      },
    });

    await store.persistPublication(createPersistedPayload({
      publicationId: 'older-publication',
      createdAt: baseTimestamp,
      lastAccessAt: baseTimestamp + 10,
      resourceSizes: [8],
    }));
    await store.persistPublication(createPersistedPayload({
      publicationId: 'newer-publication',
      createdAt: baseTimestamp,
      lastAccessAt: baseTimestamp + 20,
      resourceSizes: [6],
    }));

    await store.gc({
      timestamp: baseTimestamp + 30,
    });

    expect(await store.getPublication('older-publication')).toBeNull();
    expect(await store.getPublication('newer-publication')).not.toBeNull();
  });

  it('drops ephemeral publications immediately after the final lease releases', async () => {
    const baseTimestamp = Date.now();
    const store = await createIndexedDbRuntimeStore({
      dbName: `gc-ephemeral-${crypto.randomUUID()}`,
      gcPolicy: {
        inactiveTtlMs: 10_000,
        maxTotalBytes: 1024,
      },
    });

    await store.persistPublication(createPersistedPayload({
      publicationId: 'ephemeral-publication',
      createdAt: baseTimestamp,
      lastAccessAt: baseTimestamp,
      ephemeral: true,
      resourceSizes: [4],
    }));

    const lease = await store.createLease('ephemeral-publication', 1_000);
    await store.releaseLease(lease.leaseId);

    expect(await store.getPublication('ephemeral-publication')).toBeNull();
  });

  it('rejects lease creation when the publication no longer exists', async () => {
    const store = await createIndexedDbRuntimeStore({
      dbName: `gc-missing-lease-${crypto.randomUUID()}`,
    });

    await expect(store.createLease('missing-publication', 1_000)).rejects.toBeInstanceOf(PublicationNotFoundError);
    expect(await store.countActiveLeases('missing-publication')).toBe(0);
  });

  it('backfills missing resource metrics for legacy publication records', async () => {
    const dbName = `gc-legacy-${crypto.randomUUID()}`;
    const baseTimestamp = Date.now();
    const store = await createIndexedDbRuntimeStore({
      dbName,
    });
    const database = await openRuntimeDatabase(dbName);

    const legacyPublication: PublicationRecord = {
      publicationId: 'legacy-publication',
      sourceFingerprint: 'legacy-fingerprint',
      parserVersion: '1.0.0',
      createdAt: baseTimestamp,
      lastAccessAt: baseTimestamp,
      profileHint: 'epub',
      manifestPath: 'manifest.json',
      positionsPath: 'positions.json',
      manifest: createManifest('legacy-publication'),
      positions: createPositions(),
      warnings: [],
      refCount: 0,
      ephemeral: false,
    };

    await database.put('publications', legacyPublication);
    await database.put('resources', {
      id: resourceId('legacy-publication', 'spine/chapter-001.xhtml'),
      publicationId: 'legacy-publication',
      path: 'spine/chapter-001.xhtml',
      mediaType: 'application/xhtml+xml',
      body: new Blob([new Uint8Array(5)]),
      byteLength: 5,
    });
    await database.put('resources', {
      id: resourceId('legacy-publication', 'assets/cover.png'),
      publicationId: 'legacy-publication',
      path: 'assets/cover.png',
      mediaType: 'image/png',
      body: new Blob([new Uint8Array(7)]),
      byteLength: 7,
    });

    const publication = await store.getPublication('legacy-publication');
    expect(publication?.resourceCount).toBe(2);
    expect(publication?.resourceBytes).toBe(12);

    const snapshot = await inspectIndexedDbRuntimeStore({
      dbName,
      timestamp: baseTimestamp,
    });
    expect(snapshot.totalResourceBytes).toBe(12);
    expect(snapshot.publications[0]?.resourceCount).toBe(2);
    expect(snapshot.publications[0]?.resourceBytes).toBe(12);
  });
});
