# @s1eke/webpub-streamer

[简体中文 README](./README.md)

`@s1eke/webpub-streamer` is a browser-first ESM library that turns local `epub` and `txt` inputs into same-origin publication runtimes backed by Service Worker and IndexedDB.

It is designed for Thorium-style Web Publication consumers: open a local file in the browser, generate a Readium Web Publication Manifest and positions list, then serve the resulting resources under a same-origin runtime URL such as `/__webpub_streamer__/pub/{publicationId}/manifest.json`.

## Highlights

- Opens local `File`, `Blob`, `ArrayBuffer`, or named byte sources
- Supports `epub` and `txt` inputs
- Generates RWPM manifest and Readium positions
- Stores publication resources in IndexedDB with lease-based lifecycle management
- Serves publication resources from a Service Worker under a fixed runtime scope
- Supports both merged root Service Worker integration and standalone fallback
- Exposes testing helpers for manifest/positions/runtime validation

## Install

When publishing or linking this package into an app:

```bash
npm install @s1eke/webpub-streamer
```

Optional peer dependencies such as `@edrlab/thorium-web`, `react`, and `react-dom` are only needed for local harnesses or Thorium-based integration work.

## Recommended Integration: Merge Into an Existing Root Service Worker

If your app already has a root Service Worker, this is the supported integration path.

In the root Service Worker:

```ts
import { createPublicationServiceWorkerHandler } from '@s1eke/webpub-streamer/sw';

const publicationHandler = createPublicationServiceWorkerHandler({
  scope: '/__webpub_streamer__/',
  dbName: 's1eke-webpub-streamer',
  mode: 'merged',
});

self.addEventListener('fetch', (event) => {
  if (publicationHandler.matches(event.request)) {
    event.respondWith(publicationHandler.respond(event.request));
  }
});
```

On the page:

```ts
import {
  connectServiceWorkerMount,
  createIndexedDbRuntimeStore,
  createWebPubStreamer,
} from '@s1eke/webpub-streamer';

const mount = await connectServiceWorkerMount({
  scope: '/__webpub_streamer__/',
  dbName: 's1eke-webpub-streamer',
});

const store = await createIndexedDbRuntimeStore({
  dbName: mount.dbName,
});

const streamer = await createWebPubStreamer({
  mount,
  store,
});

const runtime = await streamer.open(file, {
  format: 'auto',
  targetProfile: 'epub',
  cachePolicy: 'reuse',
});

console.log(runtime.manifestUrl);
```

## Standalone Fallback for Hosts Without a Service Worker

If the host app does not already control the page with a root Service Worker, you can use the bundled standalone runtime worker instead:

```ts
import {
  ensureServiceWorkerMount,
  createIndexedDbRuntimeStore,
  createWebPubStreamer,
} from '@s1eke/webpub-streamer';

const mount = await ensureServiceWorkerMount({
  scope: '/__webpub_streamer__/',
  dbName: 's1eke-webpub-streamer',
});

const store = await createIndexedDbRuntimeStore({
  dbName: mount.dbName,
});

const streamer = await createWebPubStreamer({
  mount,
  store,
});
```

If the page is already controlled by a different root Service Worker, `ensureServiceWorkerMount()` will fail fast and tell you to switch to the merged handler approach.

## Opening a Publication

```ts
const runtime = await streamer.open(file, {
  format: 'auto',
  targetProfile: 'epub',
  cachePolicy: 'reuse',
  txt: {
    chapterDetection: 'auto',
    language: 'en',
  },
});

reader.load(runtime.manifestUrl);

await runtime.release();
```

`PublicationRuntime` exposes:

- `manifestUrl`
- `positionsUrl`
- `baseUrl`
- `profileHint`
- `suggestedLocalDataKey`
- `release()`
- `destroy()`

Use `release()` when the reader is done with the runtime. Use `destroy()` when you want to tombstone and remove the publication cache.

## Public API

### `@s1eke/webpub-streamer`

- `createWebPubStreamer(options)`
- `connectServiceWorkerMount(options)`
- `ensureServiceWorkerMount(options)`
- `createIndexedDbRuntimeStore(options)`

### `@s1eke/webpub-streamer/sw`

- `createPublicationServiceWorkerHandler(options)`
- `defaultServiceWorkerScriptUrl()`

### `@s1eke/webpub-streamer/testing`

- `assertManifestConforms(manifest)`
- `assertPositionsValid(positions)`
- `assertRuntimeFetchable(runtime, options)`
- `openInThoriumHarness(runtime, options)`

## Current Scope and Limitations

- Browser-only: requires Service Worker, IndexedDB, Web Crypto, and `TextDecoder`
- Input formats: `epub` and `txt`
- Target profile: only `epub` is supported right now; `webPub` throws `UnsupportedTargetProfileError`
- Recommended SW topology: merge the publication handler into the existing root Service Worker
- Standalone worker is only for hosts without a root Service Worker controller
- Two independent Service Workers are not supported as a cooperation model for publication resource interception
- Encrypted or DRM-protected EPUB files are rejected
- Remote EPUB resources are rejected in the current milestone
- EPUB JavaScript is stripped during materialization
- Unsupported or obfuscated fonts are dropped with warnings
- TXT chapter detection supports `auto`, `none`, and `regex`

## Development

```bash
npm run build
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
```

## License

Internal project for now. Add a formal license section before public distribution.
