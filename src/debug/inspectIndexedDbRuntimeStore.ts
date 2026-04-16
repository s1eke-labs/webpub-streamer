import type {
  PublicationRuntimeSource,
  RuntimeStoreDebugPublicationSnapshot,
  RuntimeStoreDebugSnapshot,
} from '../core/types.js';
import { openRuntimeDatabase } from '../store/idb/schema.js';

export interface InspectIndexedDbRuntimeStoreOptions {
  dbName: string;
  timestamp?: number;
}

function toSource(record: {
  sourceName?: string;
  sourceMediaType?: string;
  sourceFormat?: PublicationRuntimeSource['format'];
  sourceByteLength?: number;
}): PublicationRuntimeSource | undefined {
  if (!record.sourceName || !record.sourceFormat || typeof record.sourceByteLength !== 'number') {
    return undefined;
  }

  return {
    name: record.sourceName,
    mediaType: record.sourceMediaType,
    format: record.sourceFormat,
    byteLength: record.sourceByteLength,
  };
}

export async function inspectIndexedDbRuntimeStore(
  options: InspectIndexedDbRuntimeStoreOptions,
): Promise<RuntimeStoreDebugSnapshot> {
  const timestamp = options.timestamp ?? Date.now();
  const database = await openRuntimeDatabase(options.dbName);
  const [
    publications,
    resources,
    leases,
  ] = await Promise.all([
    database.getAll('publications'),
    database.getAll('resources'),
    database.getAll('leases'),
  ]);

  const resourceMetrics = new Map<string, {
    resourceBytes: number;
    resourceCount: number;
  }>();
  for (const resource of resources) {
    const current = resourceMetrics.get(resource.publicationId) ?? {
      resourceBytes: 0,
      resourceCount: 0,
    };
    current.resourceBytes += resource.byteLength;
    current.resourceCount += 1;
    resourceMetrics.set(resource.publicationId, current);
  }

  const activeLeaseCounts = new Map<string, number>();
  for (const lease of leases) {
    if (lease.expiresAt <= timestamp) {
      continue;
    }

    activeLeaseCounts.set(
      lease.publicationId,
      (activeLeaseCounts.get(lease.publicationId) ?? 0) + 1,
    );
  }

  const publicationSnapshots: RuntimeStoreDebugPublicationSnapshot[] = publications.map((publication) => {
    const metrics = resourceMetrics.get(publication.publicationId) ?? {
      resourceBytes: 0,
      resourceCount: 0,
    };
    return {
      publicationId: publication.publicationId,
      createdAt: publication.createdAt,
      lastAccessAt: publication.lastAccessAt,
      profileHint: publication.profileHint,
      refCount: publication.refCount,
      ephemeral: publication.ephemeral,
      destroyedAt: publication.destroyedAt,
      resourceBytes: publication.resourceBytes ?? metrics.resourceBytes,
      resourceCount: publication.resourceCount ?? metrics.resourceCount,
      activeLeaseCount: activeLeaseCounts.get(publication.publicationId) ?? 0,
      source: toSource(publication),
      txtChapterDiagnostics: publication.txtChapterDiagnostics,
    };
  }).sort((left, right) => left.publicationId.localeCompare(right.publicationId));

  return {
    dbName: options.dbName,
    publicationCount: publications.length,
    resourceCount: resources.length,
    leaseCount: leases.length,
    activeLeaseCount: Array.from(activeLeaseCounts.values()).reduce((total, count) => total + count, 0),
    totalResourceBytes: publicationSnapshots.reduce((total, publication) => total + publication.resourceBytes, 0),
    publications: publicationSnapshots,
    leases: leases.sort((left, right) => left.createdAt - right.createdAt),
  };
}
