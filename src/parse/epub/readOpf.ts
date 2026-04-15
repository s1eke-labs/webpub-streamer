import { InvalidPublicationError } from '../../core/errors.js';
import type { CanonicalMetadata } from '../../core/types.js';
import { asArray, textValue, xmlParser } from './xml.js';

export interface EpubManifestItem {
  id: string;
  href: string;
  mediaType: string;
  properties: string[];
}

export interface ParsedOpf {
  metadata: CanonicalMetadata;
  manifest: EpubManifestItem[];
  spine: string[];
  coverId?: string;
}

function parseCreators(metadata: Record<string, unknown>): Array<{ name: string }> | undefined {
  const creators = asArray(metadata['dc:creator'])
    .map((item) => textValue(item))
    .filter((value): value is string => Boolean(value));

  if (creators.length === 0) {
    return undefined;
  }

  return creators.map((name) => ({ name }));
}

export function readOpf(opfXml: string): ParsedOpf {
  const parsed = xmlParser.parse(opfXml);
  const packageNode = parsed?.package;
  if (!packageNode) {
    throw new InvalidPublicationError('Invalid OPF package document');
  }

  const metadataNode = (packageNode.metadata ?? {}) as Record<string, unknown>;
  const manifestNode = packageNode.manifest;
  const spineNode = packageNode.spine;

  const title = textValue(metadataNode['dc:title']) ?? 'Untitled EPUB';
  const language = textValue(metadataNode['dc:language']) ?? 'en';
  const identifier = textValue(metadataNode['dc:identifier']);
  const modified = textValue(metadataNode.meta);
  const manifest = asArray(manifestNode?.item).map((item: Record<string, unknown>) => ({
    id: String(item.id),
    href: String(item.href),
    mediaType: String(item['media-type']),
    properties: typeof item.properties === 'string'
      ? item.properties.split(/\s+/).filter(Boolean)
      : [],
  }));

  if (manifest.length === 0) {
    throw new InvalidPublicationError('EPUB manifest is empty');
  }

  const spine = asArray(spineNode?.itemref)
    .map((item: Record<string, unknown>) => String(item.idref))
    .filter(Boolean);

  if (spine.length === 0) {
    throw new InvalidPublicationError('EPUB spine is empty');
  }

  const metaEntries = asArray(
    metadataNode.meta as Record<string, unknown> | Array<Record<string, unknown>> | undefined,
  );
  const coverMeta = metaEntries.find((item) => item.name === 'cover');
  const coverId = typeof coverMeta?.content === 'string' ? coverMeta.content : undefined;

  return {
    metadata: {
      title,
      identifier,
      language,
      author: parseCreators(metadataNode),
      modified,
    },
    manifest,
    spine,
    coverId,
  };
}
