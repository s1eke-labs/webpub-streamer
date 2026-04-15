import { DEFAULT_DB_NAME } from '../../core/constants.js';
import type {
  LeaseRecord,
  PersistedPublicationPayload,
  PublicationRecord,
  ResourceRecord,
  RuntimeStore,
} from '../../core/types.js';
import { openRuntimeDatabase, resourceId } from './schema.js';

export interface CreateIndexedDbRuntimeStoreOptions {
  dbName?: string;
  ownerId?: string;
}

function now(): number {
  return Date.now();
}

function createOwnerId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `owner-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export async function createIndexedDbRuntimeStore(
  options: CreateIndexedDbRuntimeStoreOptions = {},
): Promise<RuntimeStore> {
  const dbName = options.dbName ?? DEFAULT_DB_NAME;
  const ownerId = options.ownerId ?? createOwnerId();
  const database = await openRuntimeDatabase(dbName);

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

  async function gc(timestamp = now()): Promise<void> {
    const allLeases = await database.getAll('leases');
    const expiredPublicationIds = new Set<string>();

    const leaseTransaction = database.transaction('leases', 'readwrite');
    for (const lease of allLeases) {
      if (lease.expiresAt <= timestamp) {
        expiredPublicationIds.add(lease.publicationId);
        await leaseTransaction.store.delete(lease.leaseId);
      }
    }
    await leaseTransaction.done;

    const publications = await database.getAll('publications');
    for (const publication of publications) {
      const activeCount = await countActiveLeases(publication.publicationId, timestamp);
      if (activeCount === 0 && (publication.destroyedAt || publication.ephemeral)) {
        await prunePublication(publication.publicationId);
        continue;
      }

      if (expiredPublicationIds.has(publication.publicationId)) {
        await database.put('publications', {
          ...publication,
          refCount: activeCount,
        });
      }
    }
  }

  return {
    kind: 'idb',
    dbName,
    ownerId,
    async getPublication(publicationId: string): Promise<PublicationRecord | null> {
      await gc();
      return (await database.get('publications', publicationId)) ?? null;
    },
    async persistPublication(payload: PersistedPublicationPayload): Promise<void> {
      const transaction = database.transaction(['publications', 'resources'], 'readwrite');

      await transaction.objectStore('publications').put(payload.publication);
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
    async getResource(publicationId: string, path: string): Promise<ResourceRecord | null> {
      return (await database.getFromIndex('resources', 'byPublicationIdAndPath', [publicationId, path])) ?? null;
    },
    async listResources(publicationId: string): Promise<ResourceRecord[]> {
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

      await database.put('leases', lease);

      const publication = await database.get('publications', publicationId);
      if (publication) {
        const activeCount = await countActiveLeases(publicationId, createdAt);
        await database.put('publications', {
          ...publication,
          refCount: activeCount,
          lastAccessAt: createdAt,
        });
      }

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

      const activeCount = await countActiveLeases(lease.publicationId);
      if (activeCount === 0 && publication.ephemeral) {
        await prunePublication(lease.publicationId);
        return;
      }

      await database.put('publications', {
        ...publication,
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

      const activeCount = await countActiveLeases(publicationId, timestamp);
      if (activeCount === 0) {
        await prunePublication(publicationId);
        return;
      }

      await database.put('publications', {
        ...publication,
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
