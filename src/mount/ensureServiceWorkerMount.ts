import { DEFAULT_DB_NAME, DEFAULT_SCOPE } from '../core/constants.js';
import { UnsupportedServiceWorkerTopologyError } from '../core/errors.js';
import type {
  EnsureServiceWorkerMountOptions,
  ServiceWorkerMount,
} from '../core/types.js';
import { healthcheckUrl, normalizeScope } from './runtimeUrls.js';
import { readPublicationServiceWorkerHealthcheck } from './readPublicationServiceWorkerHealthcheck.js';

function waitForActivation(
  registration: ServiceWorkerRegistration,
): Promise<ServiceWorkerRegistration> {
  if (registration.active?.state === 'activated') {
    return Promise.resolve(registration);
  }

  const worker = registration.installing ?? registration.waiting ?? registration.active;
  if (!worker) {
    return Promise.resolve(registration);
  }

  return new Promise((resolve, reject) => {
    const onStateChange = (): void => {
      if (worker.state === 'activated') {
        worker.removeEventListener('statechange', onStateChange);
        resolve(registration);
        return;
      }

      if (worker.state === 'redundant') {
        worker.removeEventListener('statechange', onStateChange);
        reject(new Error('Service worker became redundant before activation'));
      }
    };

    worker.addEventListener('statechange', onStateChange);
    onStateChange();
  });
}

function resolveScriptUrl(scriptUrl: string, dbName: string): string {
  const url = new URL(scriptUrl, globalThis.location?.origin ?? 'http://localhost');
  url.searchParams.set('dbName', dbName);
  return url.toString();
}

export function defaultServiceWorkerScriptUrl(): string {
  return new URL(
    /* @vite-ignore */
    './runtime-sw.js',
    import.meta.url,
  ).toString();
}

export async function ensureServiceWorkerMount(
  options: EnsureServiceWorkerMountOptions = {},
): Promise<ServiceWorkerMount> {
  if (!('serviceWorker' in navigator)) {
    throw new UnsupportedServiceWorkerTopologyError(
      'Service workers are not supported in this environment',
    );
  }

  const scope = normalizeScope(options.scope ?? DEFAULT_SCOPE);
  const dbName = options.dbName ?? DEFAULT_DB_NAME;
  const healthUrl = healthcheckUrl(scope);
  const scriptUrl = resolveScriptUrl(options.scriptUrl ?? defaultServiceWorkerScriptUrl(), dbName);
  const { serviceWorker } = navigator;
  const { controller } = serviceWorker;

  if (controller && controller.scriptURL !== scriptUrl) {
    throw new UnsupportedServiceWorkerTopologyError(
      'ensureServiceWorkerMount() only supports pages without an existing root service worker controller. Merge createPublicationServiceWorkerHandler() into the existing root service worker and use connectServiceWorkerMount() instead.',
    );
  }

  const ready = (async (): Promise<ServiceWorkerRegistration> => {
    const registration = await serviceWorker.register(scriptUrl, {
      scope,
      type: options.type ?? 'module',
      updateViaCache: options.updateViaCache ?? 'none',
    });
    await waitForActivation(registration);
    await serviceWorker.ready;
    await readPublicationServiceWorkerHealthcheck({
      healthUrl,
      expectedMode: 'standalone',
      dbName,
      scope,
    });
    return registration;
  })();

  const mount: ServiceWorkerMount = {
    mode: 'standalone',
    scope,
    scriptUrl,
    dbName,
    healthUrl,
    ready,
    ensureReady() {
      return ready;
    },
  };

  await ready;
  return mount;
}
