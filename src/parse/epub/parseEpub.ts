import { DOMParser } from '@xmldom/xmldom';
import { unzipSync } from 'fflate';

import { EncryptedPublicationError, InvalidPublicationError } from '../../core/errors.js';
import { resolveRelativePath } from '../../core/path-utils.js';
import type {
  CanonicalPublicationGraph,
  CanonicalResource,
  CanonicalSpineItem,
  OpenPublicationOptions,
  StreamerWarning,
  TocItem,
} from '../../core/types.js';
import { resolveMediaType } from '../../materialize/mediaType.js';
import { collectRuntimePaths } from './collectAssets.js';
import { readContainerXml } from './readContainerXml.js';
import { readNav } from './readNav.js';
import { type EpubManifestItem, readOpf } from './readOpf.js';
import { sanitizeCss, sanitizeXhtml } from './sanitizeMarkup.js';

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();

interface EncryptionDescriptor {
  algorithm: string;
  uri: string;
}

function decodeUtf8(bytes: Uint8Array | undefined, errorMessage: string): string {
  if (!bytes) {
    throw new InvalidPublicationError(errorMessage);
  }

  return textDecoder.decode(bytes);
}

function parseZip(sourceBytes: Uint8Array): Map<string, Uint8Array> {
  const unzipped = unzipSync(sourceBytes);
  return new Map(
    Object.entries(unzipped).map(([path, bytes]) => [path.replace(/^\/+/, ''), bytes]),
  );
}

function readEncryptionDescriptors(zipEntries: Map<string, Uint8Array>): EncryptionDescriptor[] {
  const encryptionBytes = zipEntries.get('META-INF/encryption.xml');
  if (!encryptionBytes) {
    return [];
  }

  const document = new DOMParser().parseFromString(textDecoder.decode(encryptionBytes), 'application/xml');
  const encryptedData = Array.from(document.getElementsByTagName('EncryptedData'));

  return encryptedData
    .map((node) => {
      const method = node.getElementsByTagName('EncryptionMethod')[0];
      const reference = node.getElementsByTagName('CipherReference')[0];
      return {
        algorithm: method?.getAttribute('Algorithm') ?? '',
        uri: reference?.getAttribute('URI')?.replace(/^\/+/, '') ?? '',
      };
    })
    .filter((item) => Boolean(item.algorithm && item.uri));
}

function handleEncryption(
  descriptors: EncryptionDescriptor[],
  manifestByHref: Map<string, EpubManifestItem>,
  options: Required<OpenPublicationOptions>,
): {
    droppedPaths: Set<string>;
    warnings: StreamerWarning[];
  } {
  if (descriptors.length === 0) {
    return {
      droppedPaths: new Set<string>(),
      warnings: [],
    };
  }

  const obfuscationAlgorithms = new Set([
    'http://www.idpf.org/2008/embedding',
    'http://ns.adobe.com/pdf/enc#RC',
  ]);

  const warnings: StreamerWarning[] = [];
  const droppedPaths = new Set<string>();

  for (const descriptor of descriptors) {
    const manifestItem = manifestByHref.get(descriptor.uri);
    if (!manifestItem) {
      throw new EncryptedPublicationError();
    }

    const isFont = manifestItem.mediaType.startsWith('font/') || /\.(woff2?|ttf)$/i.test(manifestItem.href);
    const isObfuscation = obfuscationAlgorithms.has(descriptor.algorithm);
    if (!isFont || !isObfuscation) {
      throw new EncryptedPublicationError();
    }

    if (options.epub.unsupportedFontPolicy === 'fail') {
      throw new EncryptedPublicationError();
    }

    droppedPaths.add(descriptor.uri);
    warnings.push({
      code: 'OBFUSCATED_FONT_DROPPED',
      message: `Dropped unsupported obfuscated font resource: ${descriptor.uri}`,
    });
  }

  return {
    droppedPaths,
    warnings,
  };
}

function resolveManifestHref(opfPath: string, href: string): string {
  return resolveRelativePath(opfPath, href);
}

function buildCoverResource(
  manifestItems: EpubManifestItem[],
  coverId: string | undefined,
  runtimePaths: Map<string, string>,
  zipEntries: Map<string, Uint8Array>,
): CanonicalResource | undefined {
  const candidate = manifestItems.find((item) => item.id === coverId || item.properties.includes('cover-image'));
  if (!candidate) {
    return undefined;
  }

  const originalPath = candidate.href;
  const runtimePath = runtimePaths.get(originalPath);
  const bytes = zipEntries.get(originalPath);
  if (!runtimePath || !bytes) {
    return undefined;
  }

  return {
    id: candidate.id,
    href: runtimePath,
    path: runtimePath,
    mediaType: resolveMediaType(candidate.href, candidate.mediaType),
    content: bytes,
  };
}

function rewriteToc(
  toc: TocItem[],
  sourcePath: string,
  runtimePaths: Map<string, string>,
): TocItem[] {
  const items: TocItem[] = [];

  for (const item of toc) {
    const [rawPath, anchor = ''] = item.href.split('#');
    if (!rawPath) {
      items.push({
        ...item,
        href: anchor ? `#${anchor}` : item.href,
        children: item.children ? rewriteToc(item.children, sourcePath, runtimePaths) : undefined,
      });
      continue;
    }

    const resolvedPath = resolveRelativePath(sourcePath, rawPath);
    const runtimePath = runtimePaths.get(resolvedPath);
    if (!runtimePath) {
      continue;
    }

    items.push({
      ...item,
      href: anchor ? `${runtimePath}#${anchor}` : runtimePath,
      children: item.children ? rewriteToc(item.children, sourcePath, runtimePaths) : undefined,
    });
  }

  return items;
}

export async function parseEpub(
  sourceBytes: Uint8Array,
  options: Required<OpenPublicationOptions>,
): Promise<CanonicalPublicationGraph> {
  const zipEntries = parseZip(sourceBytes);
  const containerXml = decodeUtf8(zipEntries.get('META-INF/container.xml'), 'Missing META-INF/container.xml');
  const opfPath = readContainerXml(containerXml);
  const opfXml = decodeUtf8(zipEntries.get(opfPath), 'Missing OPF package document');
  const parsedOpf = readOpf(opfXml);
  const manifestByHref = new Map<string, EpubManifestItem>();
  const manifestById = new Map<string, EpubManifestItem>();

  for (const item of parsedOpf.manifest) {
    const resolvedHref = resolveManifestHref(opfPath, item.href);
    const resolvedItem = {
      ...item,
      href: resolvedHref,
    };
    manifestByHref.set(resolvedHref, resolvedItem);
    manifestById.set(item.id, resolvedItem);
  }

  const encryption = handleEncryption(
    readEncryptionDescriptors(zipEntries),
    manifestByHref,
    options,
  );

  const spineIds = new Set(parsedOpf.spine);
  const runtimePaths = collectRuntimePaths([...manifestById.values()], spineIds);
  const readingOrder: CanonicalSpineItem[] = [];
  const resources: CanonicalResource[] = [];
  const warnings = [...encryption.warnings];

  let toc: TocItem[] = [];

  for (const spineId of parsedOpf.spine) {
    const spineItem = manifestById.get(spineId);
    if (!spineItem) {
      throw new InvalidPublicationError(`Missing spine item: ${spineId}`);
    }

    if (resolveMediaType(spineItem.href, spineItem.mediaType) !== 'application/xhtml+xml') {
      throw new InvalidPublicationError(`Spine item is not XHTML: ${spineItem.href}`);
    }

    const originalPath = spineItem.href;
    const runtimePath = runtimePaths.get(originalPath);
    const bytes = zipEntries.get(originalPath);
    if (!runtimePath || !bytes) {
      throw new InvalidPublicationError(`Missing spine resource bytes for ${originalPath}`);
    }

    const sanitized = sanitizeXhtml({
      xhtml: decodeUtf8(bytes, `Unable to decode ${originalPath}`),
      currentOriginalPath: originalPath,
      currentRuntimePath: runtimePath,
      pathMapping: runtimePaths,
    });

    readingOrder.push({
      id: spineItem.id,
      href: runtimePath,
      path: runtimePath,
      mediaType: 'application/xhtml+xml',
      content: textEncoder.encode(sanitized.xhtml),
      textContent: sanitized.textContent,
      title: `Chapter ${readingOrder.length + 1}`,
    });
  }

  const navItem = [...manifestById.values()].find((item) => item.properties.includes('nav'));
  if (navItem) {
    const navBytes = zipEntries.get(navItem.href);
    if (navBytes) {
      toc = rewriteToc(readNav(decodeUtf8(navBytes, 'Unable to decode NAV document')), navItem.href, runtimePaths);
    }
  }

  for (const manifestItem of manifestById.values()) {
    if (spineIds.has(manifestItem.id) || encryption.droppedPaths.has(manifestItem.href)) {
      continue;
    }

    const runtimePath = runtimePaths.get(manifestItem.href);
    const bytes = zipEntries.get(manifestItem.href);
    if (!runtimePath || !bytes) {
      continue;
    }

    const mediaType = resolveMediaType(manifestItem.href, manifestItem.mediaType);
    if (mediaType === 'text/css') {
      const cssText = decodeUtf8(bytes, `Unable to decode stylesheet ${manifestItem.href}`);
      const sanitizedCss = sanitizeCss({
        cssText,
        currentOriginalPath: manifestItem.href,
        currentRuntimePath: runtimePath,
        pathMapping: runtimePaths,
      });
      resources.push({
        id: manifestItem.id,
        href: runtimePath,
        path: runtimePath,
        mediaType,
        content: textEncoder.encode(sanitizedCss),
        textContent: sanitizedCss,
        properties: manifestItem.properties.length > 0
          ? {
            properties: manifestItem.properties,
          }
          : undefined,
      });
      continue;
    }

    if (mediaType === 'application/xhtml+xml') {
      const sanitized = sanitizeXhtml({
        xhtml: decodeUtf8(bytes, `Unable to decode XHTML resource ${manifestItem.href}`),
        currentOriginalPath: manifestItem.href,
        currentRuntimePath: runtimePath,
        pathMapping: runtimePaths,
      });
      resources.push({
        id: manifestItem.id,
        href: runtimePath,
        path: runtimePath,
        mediaType,
        content: textEncoder.encode(sanitized.xhtml),
        textContent: sanitized.textContent,
      });
      continue;
    }

    resources.push({
      id: manifestItem.id,
      href: runtimePath,
      path: runtimePath,
      mediaType,
      content: bytes,
    });
  }

  const titleByHref = new Map<string, string>(toc.map((item) => [item.href.split('#')[0], item.title]));
  for (const item of readingOrder) {
    item.title = titleByHref.get(item.href) ?? item.title;
  }

  const cover = buildCoverResource(
    [...manifestById.values()],
    parsedOpf.coverId,
    runtimePaths,
    zipEntries,
  );

  return {
    metadata: parsedOpf.metadata,
    readingOrder,
    resources,
    toc,
    cover,
    warnings,
  };
}
