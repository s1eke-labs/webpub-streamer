# @s1eke/webpub-streamer

[English README](./README.en.md)

`@s1eke/webpub-streamer` 是一个浏览器优先的 ESM 库，用来把本地 `epub` 和 `txt` 输入转换成同源可访问的 publication runtime，底层依赖 Service Worker 和 IndexedDB。

它的目标场景是 Thorium 一类的 Web Publication 消费端：在浏览器中打开本地文件，生成 Readium Web Publication Manifest 和 positions 列表，并把资源挂载到同源运行时 URL，例如 `/__webpub_streamer__/pub/{publicationId}/manifest.json`。

## 功能概览

- 支持打开本地 `File`、`Blob`、`ArrayBuffer` 或带名字的字节源
- 支持 `epub` 和 `txt`
- 生成 RWPM manifest 和 Readium positions
- 使用 IndexedDB 持久化 publication 资源，并通过 lease 管理生命周期
- 通过 Service Worker 在固定 scope 下提供 publication 资源
- 支持 root SW 合并 handler 模式，以及无 SW 宿主下的 standalone fallback
- 提供 parser worker pool、结构化 debug 事件，以及可检查的运行时 store snapshot
- 提供 manifest / positions / runtime 可达性的测试辅助工具

## 安装

如果你准备把这个包发布后接入应用，或者在本地 workspace / link 环境中使用：

```bash
npm install @s1eke/webpub-streamer
```

`@edrlab/thorium-web`、`react`、`react-dom` 这些 peer dependency 主要用于本地 harness 或 Thorium 集成测试，不是核心运行时的硬依赖。

## 推荐接入方式：合并到已有 Root Service Worker

如果宿主应用已经有 root Service Worker，这就是推荐且受支持的接入方式。

在 root Service Worker 中：

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

在页面侧：

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
  gcPolicy: {
    inactiveTtlMs: 7 * 24 * 60 * 60 * 1000,
    maxTotalBytes: 256 * 1024 * 1024,
  },
});

const streamer = await createWebPubStreamer({
  mount,
  store,
  parserWorkerPoolSize: 2,
  debugSink: (event) => {
    console.debug(event.type, event.detail);
  },
});

const runtime = await streamer.open(file, {
  format: 'auto',
  targetProfile: 'epub',
  cachePolicy: 'reuse',
});

console.log(runtime.manifestUrl);
```

## 无现有 SW 宿主时的 Standalone Fallback

如果宿主页面当前没有被 root Service Worker 控制，可以使用包内置的 standalone runtime worker：

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

如果页面已经被另一个 root Service Worker 控制，`ensureServiceWorkerMount()` 会直接失败，并明确提示你改用 merged handler 模式。

## 打开 Publication

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

`PublicationRuntime` 主要提供：

- `manifestUrl`
- `positionsUrl`
- `baseUrl`
- `profileHint`
- `suggestedLocalDataKey`
- `release()`
- `destroy()`
- `debug.events`
- `debug.source`
- `debug.txtChapterDiagnostics`

读者组件用完一个 runtime 后应调用 `release()`；如果你希望显式删除缓存并销毁 publication，则调用 `destroy()`。

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

### `@s1eke/webpub-streamer/debug`

- `inspectIndexedDbRuntimeStore({ dbName, timestamp? })`
- `StreamerDebugEvent`
- `RuntimeStoreDebugSnapshot`

## 当前能力边界

- 仅支持浏览器环境，要求有 Service Worker、IndexedDB、Web Crypto 和 `TextDecoder`
- 输入格式只支持 `epub` 和 `txt`
- 当前只支持 `targetProfile: "epub"`；传 `webPub` 会抛出 `UnsupportedTargetProfileError`
- 推荐的 SW 拓扑是把 publication handler 合并进已有的 root Service Worker
- standalone worker 只适用于没有 root Service Worker controller 的宿主
- 不支持两个独立 Service Worker 协同拦截 publication 资源
- 加密或 DRM 保护的 EPUB 会被拒绝
- 当前里程碑下，EPUB 远程资源会被拒绝
- EPUB 中的 JavaScript 会在物化时被剥离
- 混淆字体当前仍然采用 `warn-and-drop` / `fail` 策略，font deobfuscation 已明确延期到后续里程碑
- TXT 章节识别支持 `auto`、`none`、`regex`

## 开发命令

```bash
npm run build
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration
```

## License

本项目采用 [MIT License](./LICENSE)。
