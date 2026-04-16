import {
  DEFAULT_DB_NAME,
  DEFAULT_GC_INACTIVE_TTL_MS,
  DEFAULT_GC_MAX_TOTAL_BYTES,
} from '../../core/constants.js';
import { PublicationNotFoundError } from '../../core/errors.js';
import type {
  LeaseRecord,
  PersistedPublicationPayload,
  PublicationRecord,
  RuntimeStore,
  RuntimeStoreGcOptions,
  StreamerDebugEvent,
} from '../../core/types.js';
import { openRuntimeDatabase, resourceId } from './schema.js';

export interface RuntimeStoreGcPolicy {
  inactiveTtlMs?: number;
  maxTotalBytes?: number;
}

export interface CreateIndexedDbRuntimeStoreOptions {
  dbName?: string;
  ownerId?: string;
  gcPolicy?: RuntimeStoreGcPolicy;
}

function now(): number {
  return Date.now();
}

function createOwnerId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `owner-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeGcOptions(input?: number | RuntimeStoreGcOptions): {
  timestamp: number;
  debugSink?: (event: StreamerDebugEvent) => void;
} {
  if (typeof input === 'number') {
    return {
      timestamp: input,
      debugSink: undefined,
    };
  }

  return {
    timestamp: input?.timestamp ?? now(),
    debugSink: input?.debugSink,
  };
}

function emitDebugEvent(
  debugSink: RuntimeStoreGcOptions['debugSink'],
  event: StreamerDebugEvent,
): void {
  debugSink?.(event);
}

export async function createIndexedDbRuntimeStore(
  options: CreateIndexedDbRuntimeStoreOptions = {},
): Promise<RuntimeStore> {
  const dbName = options.dbName ?? DEFAULT_DB_NAME;
  const ownerId = options.ownerId ?? createOwnerId();
  const database = await openRuntimeDatabase(dbName);
  const gcPolicy = {
    inactiveTtlMs: options.gcPolicy?.inactiveTtlMs ?? DEFAULT_GC_INACTIVE_TTL_MS,
    maxTotalBytes: options.gcPolicy?.maxTotalBytes ?? DEFAULT_GC_MAX_TOTAL_BYTES,
  };

  async function prunePublication(publicationId: string): Promise<void> {
    const transaction = database.transaction(['publications', 'resources', 'leases'], 'readwrite');
    const leaseIndex = transaction.objectStore('leases').index('byPublicationId');
    const resourceIndex = transaction.objectStore('resources').index('byPublicationId');

    for (
      let cursor = await leaseIndex.openCursor(publicationId);
      cursor;
      cursor = await cursor.continue()
    ) {
      await cursor.delete();
    }

    for (
      let cursor = await resourceIndex.openCursor(publicationId);
      cursor;
      cursor = await cursor.continue()
    ) {
      await cursor.delete();
    }

    await transaction.objectStore('publications').delete(publicationId);
    await transaction.done;
  }

  async function listLeases(publicationId: string): Promise<LeaseRecord[]> {
    return database.getAllFromIndex('leases', 'byPublicationId', publicationId);
  }

  async function countActiveLeases(publicationId: string, timestamp = now()): Promise<number> {
    const leases = await listLeases(publicationId);
    return leases.filter((lease) => lease.expiresAt > timestamp).length;
  }

  async function calculatePublicationMetrics(publicationId: string): Promise<{
    resourceBytes: number;
    resourceCount: number;
  }> {
    const resources = await database.getAllFromIndex('resources', 'byPublicationId', publicationId);
    return {
      resourceBytes: resources.reduce((total, resource) => total + resource.byteLength, 0),
      resourceCount: resources.length,
    };
  }

  async function ensurePublicationMetrics(publication: PublicationRecord): Promise<PublicationRecord> {
    if (typeof publication.resourceBytes === 'number' && typeof publication.resourceCount === 'number') {
      return publication;
    }

    const metrics = await calculatePublicationMetrics(publication.publicationId);
    const updated: PublicationRecord = {
      ...publication,
      resourceBytes: metrics.resourceBytes,
      resourceCount: metrics.resourceCount,
    };
    await database.put('publications', updated);
    return updated;
  }

  async function gc(input?: number | RuntimeStoreGcOptions): Promise<void> {
    const {
      timestamp,
      debugSink,
    } = normalizeGcOptions(input);

    emitDebugEvent(debugSink, {
      type: 'gc',
      timestamp,
      detail: {
        status: 'start',
      },
    });

    const allLeases = await database.getAll('leases');
    const activeLeaseCounts = new Map<string, number>();

    const leaseTransaction = database.transaction('leases', 'readwrite');
    for (const lease of allLeases) {
      if (lease.expiresAt <= timestamp) {
        await leaseTransaction.store.delete(lease.leaseId);
        continue;
      }

      activeLeaseCounts.set(
        lease.publicationId,
        (activeLeaseCounts.get(lease.publicationId) ?? 0) + 1,
      );
    }
    await leaseTransaction.done;

    const publications = await database.getAll('publications');
    const keptInactive: PublicationRecord[] = [];
    let totalInactiveBytes = 0;

    for (const publication of publications) {
      const activeCount = activeLeaseCounts.get(publication.publicationId) ?? 0;
      const hydrated = await ensurePublicationMetrics(publication);

      if (activeCount === 0 && (hydrated.destroyedAt || hydrated.ephemeral)) {
        await prunePublication(hydrated.publicationId);
        emitDebugEvent(debugSink, {
          type: 'gc-evict',
          timestamp,
          publicationId: hydrated.publicationId,
          detail: {
            reason: hydrated.destroyedAt ? 'destroyed' : 'ephemeral',
            resourceBytes: hydrated.resourceBytes ?? 0,
          },
        });
        continue;
      }

      if (activeCount === 0 && (timestamp - hydrated.lastAccessAt) >= gcPolicy.inactiveTtlMs) {
        await prunePublication(hydrated.publicationId);
        emitDebugEvent(debugSink, {
          type: 'gc-evict',
          timestamp,
          publicationId: hydrated.publicationId,
          detail: {
            reason: 'ttl',
            resourceBytes: hydrated.resourceBytes ?? 0,
            lastAccessAt: hydrated.lastAccessAt,
          },
        });
        continue;
      }

      const nextRecord: PublicationRecord = activeCount === hydrated.refCount
        ? hydrated
        : {
          ...hydrated,
          refCount: activeCount,
        };

      if (nextRecord !== hydrated) {
        await database.put('publications', nextRecord);
      }

      if (activeCount === 0) {
        keptInactive.push(nextRecord);
        totalInactiveBytes += nextRecord.resourceBytes ?? 0;
      }
    }

    keptInactive.sort((left, right) => left.lastAccessAt - right.lastAccessAt);
    for (const publication of keptInactive) {
      if (totalInactiveBytes <= gcPolicy.maxTotalBytes) {
        break;
      }

      await prunePublication(publication.publicationId);
      totalInactiveBytes -= publication.resourceBytes ?? 0;
      emitDebugEvent(debugSink, {
        type: 'gc-evict',
        timestamp,
        publicationId: publication.publicationId,
        detail: {
          reason: 'lru',
          resourceBytes: publication.resourceBytes ?? 0,
          lastAccessAt: publication.lastAccessAt,
          maxTotalBytes: gcPolicy.maxTotalBytes,
        },
      });
    }

    emitDebugEvent(debugSink, {
      type: 'gc',
      timestamp,
      detail: {
        status: 'done',
        inactiveBytes: totalInactiveBytes,
        maxTotalBytes: gcPolicy.maxTotalBytes,
      },
    });
  }

  return {
    kind: 'idb',
    dbName,
    ownerId,
    async getPublication(publicationId: string): Promise<PublicationRecord | null> {
      await gc();
      const publication = await database.get('publications', publicationId);
      if (!publication) {
        return null;
      }

      return ensurePublicationMetrics(publication);
    },
    async persistPublication(payload: PersistedPublicationPayload): Promise<void> {
      const transaction = database.transaction(['publications', 'resources'], 'readwrite');
      const resourceBytes = payload.resources.reduce((total, resource) => total + resource.byteLength, 0);
      const publication: PublicationRecord = {
        ...payload.publication,
        resourceBytes,
        resourceCount: payload.resources.length,
      };

      await transaction.objectStore('publications').put(publication);
      for (const resource of payload.resources) {
        await transaction.objectStore('resources').put({
          ...resource,
          id: resourceId(resource.publicationId, resource.path),
        });
      }

      await transaction.done;
    },
    async touchPublication(publicationId: string, timestamp = now()): Promise<void> {
      const publication = await database.get('publications', publicationId);
      if (!publication) {
        return;
      }

      await database.put('publications', {
        ...publication,
        lastAccessAt: timestamp,
      });
    },
    async getResource(publicationId: string, path: string) {
      return (await database.getFromIndex('resources', 'byPublicationIdAndPath', [publicationId, path])) ?? null;
    },
    async listResources(publicationId: string) {
      return database.getAllFromIndex('resources', 'byPublicationId', publicationId);
    },
    async createLease(publicationId: string, ttlMs: number): Promise<LeaseRecord> {
      const createdAt = now();
      const lease: LeaseRecord = {
        leaseId: globalThis.crypto?.randomUUID?.() ?? `lease-${createdAt}-${Math.random().toString(16).slice(2)}`,
        publicationId,
        owner: ownerId,
        createdAt,
        expiresAt: createdAt + ttlMs,
      };

      const transaction = database.transaction(['publications', 'leases'], 'readwrite');
      const publicationStore = transaction.objectStore('publications');
      const leaseStore = transaction.objectStore('leases');
      const publication = await publicationStore.get(publicationId);
      if (!publication) {
        throw new PublicationNotFoundError(publicationId);
      }

      await leaseStore.put(lease);

      let activeCount = 0;
      const leaseIndex = leaseStore.index('byPublicationId');
      for (
        let cursor = await leaseIndex.openCursor(publicationId);
        cursor;
        cursor = await cursor.continue()
      ) {
        if (cursor.value.expiresAt > createdAt) {
          activeCount += 1;
        }
      }

      await publicationStore.put({
        ...publication,
        refCount: activeCount,
        lastAccessAt: createdAt,
      });
      await transaction.done;

      return lease;
    },
    async refreshLease(leaseId: string, ttlMs: number): Promise<LeaseRecord | null> {
      const lease = await database.get('leases', leaseId);
      if (!lease) {
        return null;
      }

      const updated: LeaseRecord = {
        ...lease,
        expiresAt: now() + ttlMs,
      };
      await database.put('leases', updated);
      return updated;
    },
    async releaseLease(leaseId: string): Promise<void> {
      const lease = await database.get('leases', leaseId);
      if (!lease) {
        return;
      }

      await database.delete('leases', leaseId);

      const publication = await database.get('publications', lease.publicationId);
      if (!publication) {
        return;
      }

      const hydrated = await ensurePublicationMetrics(publication);
      const activeCount = await countActiveLeases(lease.publicationId);
      if (activeCount === 0 && hydrated.ephemeral) {
        await prunePublication(lease.publicationId);
        return;
      }

      await database.put('publications', {
        ...hydrated,
        refCount: activeCount,
        lastAccessAt: now(),
      });
    },
    countActiveLeases,
    listLeases,
    async destroyPublication(publicationId: string): Promise<void> {
      await prunePublication(publicationId);
    },
    async markPublicationDestroyed(publicationId: string, timestamp = now()): Promise<void> {
      const publication = await database.get('publications', publicationId);
      if (!publication) {
        return;
      }

      const hydrated = await ensurePublicationMetrics(publication);
      const activeCount = await countActiveLeases(publicationId, timestamp);
      if (activeCount === 0) {
        await prunePublication(publicationId);
        return;
      }

      await database.put('publications', {
        ...hydrated,
        destroyedAt: timestamp,
        refCount: activeCount,
      });
    },
    async clear(): Promise<void> {
      const transaction = database.transaction(['publications', 'resources', 'leases'], 'readwrite');
      await transaction.objectStore('publications').clear();
      await transaction.objectStore('resources').clear();
      await transaction.objectStore('leases').clear();
      await transaction.done;
    },
    gc,
  };
}
