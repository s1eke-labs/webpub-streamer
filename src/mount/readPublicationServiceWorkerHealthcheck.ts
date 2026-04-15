import { ServiceWorkerMountError } from '../core/errors.js';
import type { ServiceWorkerMountMode } from '../core/types.js';

interface PublicationServiceWorkerHealthcheck {
  ok: true;
  dbName: string;
  scope: string;
  mode: ServiceWorkerMountMode;
}

function isPublicationServiceWorkerHealthcheck(
  value: unknown,
): value is PublicationServiceWorkerHealthcheck {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return candidate.ok === true
    && typeof candidate.dbName === 'string'
    && typeof candidate.scope === 'string'
    && (candidate.mode === 'merged' || candidate.mode === 'standalone');
}

export async function readPublicationServiceWorkerHealthcheck(params: {
  healthUrl: string;
  expectedMode: ServiceWorkerMountMode;
  dbName: string;
  scope: string;
}): Promise<void> {
  const response = await fetch(params.healthUrl, {
    cache: 'no-store',
  });
  if (!response.ok) {
    throw new ServiceWorkerMountError(
      `Service worker healthcheck failed with status ${response.status}`,
    );
  }

  const payload = await response.json();
  if (!isPublicationServiceWorkerHealthcheck(payload)) {
    throw new ServiceWorkerMountError(
      'Service worker healthcheck returned an invalid publication runtime payload',
    );
  }

  if (payload.mode !== params.expectedMode) {
    throw new ServiceWorkerMountError(
      `Expected a ${params.expectedMode} publication service worker, received ${payload.mode}`,
      'SERVICE_WORKER_MODE_MISMATCH',
    );
  }

  if (payload.dbName !== params.dbName) {
    throw new ServiceWorkerMountError(
      `Expected publication runtime db "${params.dbName}", received "${payload.dbName}"`,
      'SERVICE_WORKER_DB_MISMATCH',
    );
  }

  if (payload.scope !== params.scope) {
    throw new ServiceWorkerMountError(
      `Expected publication runtime scope "${params.scope}", received "${payload.scope}"`,
      'SERVICE_WORKER_SCOPE_MISMATCH',
    );
  }
}
