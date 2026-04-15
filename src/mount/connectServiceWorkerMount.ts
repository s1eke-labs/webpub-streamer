import { DEFAULT_DB_NAME, DEFAULT_SCOPE } from '../core/constants.js';
import { UnsupportedServiceWorkerTopologyError } from '../core/errors.js';
import type {
  ConnectServiceWorkerMountOptions,
  ServiceWorkerMount,
} from '../core/types.js';
import { healthcheckUrl, normalizeScope } from './runtimeUrls.js';
import { readPublicationServiceWorkerHealthcheck } from './readPublicationServiceWorkerHealthcheck.js';

export async function connectServiceWorkerMount(
  options: ConnectServiceWorkerMountOptions = {},
): Promise<ServiceWorkerMount> {
  if (!('serviceWorker' in navigator)) {
    throw new UnsupportedServiceWorkerTopologyError(
      'Service workers are not supported in this environment',
    );
  }

  const { serviceWorker } = navigator;
  const { controller } = serviceWorker;
  if (!controller) {
    throw new UnsupportedServiceWorkerTopologyError(
      'connectServiceWorkerMount() requires the current page to already be controlled by a root service worker that has merged createPublicationServiceWorkerHandler().',
    );
  }

  const scope = normalizeScope(options.scope ?? DEFAULT_SCOPE);
  const dbName = options.dbName ?? DEFAULT_DB_NAME;
  const healthUrl = healthcheckUrl(scope);
  const { ready } = serviceWorker;

  await ready;
  await readPublicationServiceWorkerHealthcheck({
    healthUrl,
    expectedMode: 'merged',
    dbName,
    scope,
  });

  return {
    mode: 'merged',
    scope,
    scriptUrl: controller.scriptURL,
    dbName,
    healthUrl,
    ready,
    ensureReady() {
      return ready;
    },
  };
}
