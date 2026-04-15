import { startTransition, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

import { StatefulLoader } from '@edrlab/thorium-web/misc';
import {
  makeStore,
  StatefulPreferencesProvider,
  StatefulReaderWrapper,
  ThI18nProvider,
  ThStoreProvider,
  usePublication,
} from '@edrlab/thorium-web/reader';
import '@edrlab/thorium-web/misc/styles';
import '@edrlab/thorium-web/reader/styles';

import {
  connectServiceWorkerMount,
  createIndexedDbRuntimeStore,
  createWebPubStreamer,
  ensureServiceWorkerMount,
  type PublicationRuntime,
  type ReadiumManifest,
  type ServiceWorkerMount,
  type WebPubStreamer,
} from '@s1eke/webpub-streamer';

declare global {
  interface Window {
    __webpubHarness?: {
      openBuffer: (buffer: number[], name: string, type: string) => Promise<{
        publicationId: string;
        manifestUrl: string;
      }>;
      clear: () => Promise<void>;
      getLastRuntime: () => {
        publicationId: string | null;
        manifestUrl: string | null;
      };
    };
  }
}

const DB_NAME = 'webpub-streamer-harness';
const SCOPE = '/__webpub_streamer__/';
const thoriumStore = makeStore('webpub-streamer-harness');
const ROOT_SW_SCRIPT_URL = '/root-sw.ts';
const ROOT_SW_RELOAD_KEY = 'webpub-streamer-harness-root-sw-reload';

type HarnessMountMode = 'merged' | 'standalone';

function resolveHarnessMountMode(): HarnessMountMode {
  const params = new URLSearchParams(window.location.search);
  return params.get('mountMode') === 'standalone' ? 'standalone' : 'merged';
}

async function ensureHarnessRootServiceWorkerController(): Promise<boolean> {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service workers are not supported in this environment');
  }

  const { serviceWorker } = navigator;
  const { controller } = serviceWorker;
  if (controller?.scriptURL.includes(ROOT_SW_SCRIPT_URL)) {
    return true;
  }

  await serviceWorker.register(ROOT_SW_SCRIPT_URL, {
    scope: '/',
    type: 'module',
    updateViaCache: 'none',
  });
  await serviceWorker.ready;

  if (serviceWorker.controller?.scriptURL.includes(ROOT_SW_SCRIPT_URL)) {
    window.sessionStorage.removeItem(ROOT_SW_RELOAD_KEY);
    return true;
  }

  if (!window.sessionStorage.getItem(ROOT_SW_RELOAD_KEY)) {
    window.sessionStorage.setItem(ROOT_SW_RELOAD_KEY, '1');
    window.location.reload();
    return false;
  }

  throw new Error('Merged root service worker did not take control of the harness page');
}

function Harness() {
  const requestedMountMode = resolveHarnessMountMode();
  const [streamer, setStreamer] = useState<WebPubStreamer | null>(null);
  const [runtime, setRuntime] = useState<PublicationRuntime | null>(null);
  const [manifest, setManifest] = useState<ReadiumManifest | null>(null);
  const [bootError, setBootError] = useState<Error | null>(null);
  const [openError, setOpenError] = useState<Error | null>(null);
  const [phase, setPhase] = useState('booting');
  const [mountMode, setMountMode] = useState<HarnessMountMode | null>(null);
  const runtimeRef = useRef<PublicationRuntime | null>(null);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setPhase(`mount:${requestedMountMode}:start`);
        let mount: ServiceWorkerMount;
        if (requestedMountMode === 'merged') {
          const hasController = await ensureHarnessRootServiceWorkerController();
          if (!hasController || cancelled) {
            return;
          }

          setPhase('mount:merged:connect');
          mount = await connectServiceWorkerMount({
            scope: SCOPE,
            dbName: DB_NAME,
          });
        } else {
          setPhase('mount:standalone:register');
          mount = await ensureServiceWorkerMount({
            scope: SCOPE,
            dbName: DB_NAME,
            scriptUrl: '/runtime-sw.js',
          });
        }

        const store = await createIndexedDbRuntimeStore({
          dbName: DB_NAME,
        });
        const nextStreamer = await createWebPubStreamer({
          mount,
          store,
          parserMode: 'inline',
          parserWorkerScriptUrl: '/parser-worker.js',
          debugReporter: (nextPhase) => {
            setPhase(`open:${nextPhase}`);
          },
        });

        if (cancelled) {
          return;
        }

        setPhase('ready');
        setMountMode(mount.mode);
        setStreamer(nextStreamer);
        window.__webpubHarness = {
          async openBuffer(buffer, name, type) {
            try {
              setOpenError(null);
              setPhase('open:file');
              const file = new File([new Uint8Array(buffer)], name, {
                type,
              });
              setPhase('open:streamer');
              const nextRuntime = await nextStreamer.open(file, {
                format: 'auto',
              });
              const nextManifest = nextRuntime.debug?.manifest ?? null;

              runtimeRef.current = nextRuntime;
              setPhase('open:done');
              startTransition(() => {
                setRuntime(nextRuntime);
                setManifest(nextManifest);
              });

              return {
                publicationId: nextRuntime.publicationId,
                manifestUrl: nextRuntime.manifestUrl,
              };
            } catch (error) {
              const normalizedError = error instanceof Error ? error : new Error(String(error));
              setOpenError(normalizedError);
              setPhase(`open:error:${normalizedError.message}`);
              throw normalizedError;
            }
          },
          async clear() {
            const activeRuntime = runtimeRef.current;
            runtimeRef.current = null;
            if (activeRuntime) {
              await activeRuntime.destroy();
            }
            await nextStreamer.clear();
            setPhase('cleared');
            startTransition(() => {
              setRuntime(null);
              setManifest(null);
            });
          },
          getLastRuntime() {
            return {
              publicationId: runtimeRef.current?.publicationId ?? null,
              manifestUrl: runtimeRef.current?.manifestUrl ?? null,
            };
          },
        };
      } catch (error) {
        if (!cancelled) {
          setBootError(error instanceof Error ? error : new Error(String(error)));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const manifestUrl = runtime?.manifestUrl ?? '';
  const { publication, profile, localDataKey, error, isLoading } = usePublication({
    url: manifestUrl,
  });

  const tocTitles = useMemo(
    () => manifest?.toc?.map((item) => item.title).join(' | ') ?? '',
    [manifest],
  );

  if (bootError) {
    return <pre data-testid="boot-error">{ bootError.message }</pre>;
  }

  return (
    <div>
      <div data-testid="status">{ streamer ? 'ready' : 'booting' }</div>
      <div data-testid="mount-mode">{ mountMode ?? '' }</div>
      <div data-testid="phase">{ phase }</div>
      <div data-testid="manifest-url">{ manifestUrl }</div>
      <div data-testid="publication-title">{ manifest?.metadata.title ?? '' }</div>
      <div data-testid="toc-titles">{ tocTitles }</div>
      <div data-testid="profile">{ profile ?? '' }</div>
      <div data-testid="local-data-key">{ localDataKey ?? '' }</div>
      <div data-testid="publication-loaded">{ publication ? 'yes' : 'no' }</div>
      { openError && <pre data-testid="open-error">{ openError.message }</pre> }
      { error && <pre data-testid="reader-error">{ String(error) }</pre> }
      <StatefulLoader isLoading={Boolean(runtime) && isLoading}>
        { publication && runtime && (
          <div data-testid="reader-mounted">
            <StatefulReaderWrapper
              profile={profile}
              publication={publication}
              localDataKey={localDataKey}
            />
          </div>
        ) }
      </StatefulLoader>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <ThStoreProvider store={thoriumStore}>
    <StatefulPreferencesProvider>
      <ThI18nProvider>
        <Harness />
      </ThI18nProvider>
    </StatefulPreferencesProvider>
  </ThStoreProvider>,
);
