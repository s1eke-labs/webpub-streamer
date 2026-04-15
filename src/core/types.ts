export type InputSource =
  | File
  | Blob
  | ArrayBuffer
  | {
    name: string;
    mediaType?: string;
    data: ArrayBuffer | Uint8Array;
  };

export type InputFormat = 'auto' | 'epub' | 'txt';
export type TargetProfile = 'epub' | 'webPub';
export type CachePolicy = 'reuse' | 'rebuild' | 'no-store';

export interface TxtParserOptions {
  encoding?: string;
  chapterDetection?: 'auto' | 'none' | 'regex';
  chapterPatterns?: RegExp[];
  language?: string;
  title?: string;
}

export interface EpubParserOptions {
  allowRemoteResources?: 'reject' | 'mirror' | 'keep';
  javascriptPolicy?: 'strip' | 'keep';
  unsupportedFontPolicy?: 'warn-and-drop' | 'fail';
}

export interface OpenPublicationOptions {
  format?: InputFormat;
  targetProfile?: TargetProfile;
  cachePolicy?: CachePolicy;
  txt?: TxtParserOptions;
  epub?: EpubParserOptions;
  validate?: boolean;
}

export interface StreamerWarning {
  code: string;
  message: string;
  detail?: unknown;
}

export interface ManifestMetadata {
  '@type': 'http://schema.org/Book';
  title: string;
  identifier?: string;
  language?: string | string[];
  author?: Array<{ name: string }>;
  modified?: string;
  published?: string;
  layout?: 'reflowable' | 'fixed';
  direction?: 'ltr' | 'rtl' | 'auto';
}

export interface LinkObject {
  href: string;
  type?: string;
  rel?: string | string[];
  title?: string;
  properties?: Record<string, unknown>;
  height?: number;
  width?: number;
}

export interface TocItem {
  href: string;
  title: string;
  children?: TocItem[];
}

export interface Locator {
  href: string;
  type: string;
  title?: string;
  locations: {
    position: number;
    progression: number;
    totalProgression: number;
  };
}

export interface PositionsList {
  total: number;
  positions: Locator[];
}

export interface ReadiumManifest {
  '@context': string;
  metadata: ManifestMetadata;
  links: LinkObject[];
  readingOrder: LinkObject[];
  resources?: LinkObject[];
  toc?: TocItem[];
  conformsTo?: string[];
}

export interface PublicationRuntime {
  publicationId: string;
  manifestUrl: string;
  positionsUrl: string;
  baseUrl: string;
  profileHint: 'epub' | 'webPub';
  suggestedLocalDataKey: string;
  release: () => Promise<void>;
  destroy: () => Promise<void>;
  debug?: {
    manifest: ReadiumManifest;
    positions: PositionsList;
    warnings: StreamerWarning[];
  };
}

export interface EnsureServiceWorkerMountOptions {
  scope?: string;
  scriptUrl?: string;
  dbName?: string;
  type?: RegistrationOptions['type'];
  updateViaCache?: RegistrationOptions['updateViaCache'];
}

export interface ConnectServiceWorkerMountOptions {
  scope?: string;
  dbName?: string;
}

export type ServiceWorkerMountMode = 'merged' | 'standalone';

export interface ServiceWorkerMount {
  mode: ServiceWorkerMountMode;
  scope: string;
  scriptUrl: string;
  dbName: string;
  healthUrl: string;
  ready: Promise<ServiceWorkerRegistration>;
  ensureReady: () => Promise<ServiceWorkerRegistration>;
}

export type PublicationServiceWorkerRequestInput = Request | URL | string;

export interface PublicationServiceWorkerHandlerOptions {
  scope?: string;
  dbName?: string;
  mode?: ServiceWorkerMountMode;
}

export interface PublicationServiceWorkerHandler {
  readonly scope: string;
  readonly dbName: string;
  readonly mode: ServiceWorkerMountMode;
  matches: (request: PublicationServiceWorkerRequestInput) => boolean;
  respond: (request: Request) => Promise<Response>;
}

export interface CreateWebPubStreamerOptions {
  mount: ServiceWorkerMount;
  store: RuntimeStore;
  defaultTargetProfile?: TargetProfile;
  parserVersion?: string;
  leaseTtlMs?: number;
  validateByDefault?: boolean;
  parserMode?: 'auto' | 'inline';
  parserWorkerScriptUrl?: string;
  debugReporter?: (phase: string) => void;
}

export interface WebPubStreamer {
  open: (input: InputSource, options?: OpenPublicationOptions) => Promise<PublicationRuntime>;
  get: (publicationId: string) => Promise<PublicationRuntime | null>;
  destroy: (publicationId: string) => Promise<void>;
  clear: () => Promise<void>;
}

export interface PublicationRecord {
  publicationId: string;
  sourceFingerprint: string;
  parserVersion: string;
  createdAt: number;
  lastAccessAt: number;
  profileHint: 'epub' | 'webPub';
  manifestPath: string;
  positionsPath: string;
  manifest: ReadiumManifest;
  positions: PositionsList;
  warnings: StreamerWarning[];
  refCount: number;
  ephemeral: boolean;
  destroyedAt?: number;
}

export interface ResourceRecord {
  id: string;
  publicationId: string;
  path: string;
  mediaType: string;
  body: Blob;
  byteLength: number;
  textContent?: string;
}

export interface LeaseRecord {
  leaseId: string;
  publicationId: string;
  owner: string;
  createdAt: number;
  expiresAt: number;
}

export interface PersistedPublicationPayload {
  publication: PublicationRecord;
  resources: ResourceRecord[];
}

export interface RuntimeStore {
  readonly kind: 'idb';
  readonly dbName: string;
  readonly ownerId: string;
  getPublication: (publicationId: string) => Promise<PublicationRecord | null>;
  persistPublication: (payload: PersistedPublicationPayload) => Promise<void>;
  touchPublication: (publicationId: string, timestamp?: number) => Promise<void>;
  getResource: (publicationId: string, path: string) => Promise<ResourceRecord | null>;
  listResources: (publicationId: string) => Promise<ResourceRecord[]>;
  createLease: (publicationId: string, ttlMs: number) => Promise<LeaseRecord>;
  refreshLease: (leaseId: string, ttlMs: number) => Promise<LeaseRecord | null>;
  releaseLease: (leaseId: string) => Promise<void>;
  countActiveLeases: (publicationId: string, timestamp?: number) => Promise<number>;
  listLeases: (publicationId: string) => Promise<LeaseRecord[]>;
  destroyPublication: (publicationId: string) => Promise<void>;
  markPublicationDestroyed: (publicationId: string, timestamp?: number) => Promise<void>;
  clear: () => Promise<void>;
  gc: (timestamp?: number) => Promise<void>;
}

export interface MaterializedResource {
  path: string;
  mediaType: string;
  body: Uint8Array;
  textContent?: string;
}

export interface MaterializedPublication {
  publicationId: string;
  sourceFingerprint: string;
  parserVersion: string;
  profileHint: 'epub' | 'webPub';
  manifestPath: string;
  positionsPath: string;
  manifest: ReadiumManifest;
  positions: PositionsList;
  resources: MaterializedResource[];
  warnings: StreamerWarning[];
}

export interface CanonicalResource {
  id: string;
  path: string;
  href: string;
  mediaType: string;
  content: Uint8Array;
  textContent?: string;
  title?: string;
  rel?: string[];
  properties?: Record<string, unknown>;
}

export interface CanonicalSpineItem extends CanonicalResource {
  title: string;
}

export interface CanonicalMetadata {
  title: string;
  identifier?: string;
  language?: string;
  author?: Array<{ name: string }>;
  modified?: string;
  published?: string;
  direction?: 'ltr' | 'rtl' | 'auto';
}

export interface CanonicalPublicationGraph {
  metadata: CanonicalMetadata;
  readingOrder: CanonicalSpineItem[];
  resources: CanonicalResource[];
  toc: TocItem[];
  cover?: CanonicalResource;
  warnings: StreamerWarning[];
}

export interface ParserRequestPayload {
  publicationId: string;
  sourceBytes: Uint8Array;
  sourceName: string;
  sourceMediaType?: string;
  sourceFingerprint: string;
  format: Exclude<InputFormat, 'auto'>;
  options: Required<OpenPublicationOptions>;
  parserVersion: string;
  manifestBaseUrl: string;
}

export interface ParserResponseSuccess {
  ok: true;
  publication: MaterializedPublication;
}

export interface ParserResponseFailure {
  ok: false;
  error: {
    name: string;
    message: string;
    stack?: string;
    code?: string;
  };
}

export type ParserResponse = ParserResponseSuccess | ParserResponseFailure;
