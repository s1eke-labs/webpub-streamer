import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

import { DEFAULT_DB_NAME } from '../../core/constants.js';
import type {
  LeaseRecord,
  PublicationRecord,
  ResourceRecord,
} from '../../core/types.js';

export const RUNTIME_DB_VERSION = 1;

export interface RuntimeDatabaseSchema extends DBSchema {
  publications: {
    key: string;
    value: PublicationRecord;
  };
  resources: {
    key: string;
    value: ResourceRecord;
    indexes: {
      byPublicationId: string;
      byPublicationIdAndPath: [string, string];
    };
  };
  leases: {
    key: string;
    value: LeaseRecord;
    indexes: {
      byPublicationId: string;
      byExpiresAt: number;
    };
  };
}

export function resourceId(publicationId: string, resourcePath: string): string {
  return `${publicationId}:${resourcePath}`;
}

export async function openRuntimeDatabase(
  dbName = DEFAULT_DB_NAME,
): Promise<IDBPDatabase<RuntimeDatabaseSchema>> {
  return openDB<RuntimeDatabaseSchema>(dbName, RUNTIME_DB_VERSION, {
    upgrade(database) {
      if (!database.objectStoreNames.contains('publications')) {
        database.createObjectStore('publications', {
          keyPath: 'publicationId',
        });
      }

      if (!database.objectStoreNames.contains('resources')) {
        const resources = database.createObjectStore('resources', {
          keyPath: 'id',
        });
        resources.createIndex('byPublicationId', 'publicationId', {
          unique: false,
        });
        resources.createIndex('byPublicationIdAndPath', ['publicationId', 'path'], {
          unique: true,
        });
      }

      if (!database.objectStoreNames.contains('leases')) {
        const leases = database.createObjectStore('leases', {
          keyPath: 'leaseId',
        });
        leases.createIndex('byPublicationId', 'publicationId', {
          unique: false,
        });
        leases.createIndex('byExpiresAt', 'expiresAt', {
          unique: false,
        });
      }
    },
  });
}
