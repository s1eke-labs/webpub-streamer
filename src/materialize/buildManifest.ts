import {
  EPUB_PROFILE_URL,
  MANIFEST_CONTEXT_URL,
  MANIFEST_FILENAME,
  MANIFEST_MEDIA_TYPE,
  POSITIONS_FILENAME,
  POSITIONS_MEDIA_TYPE,
  POSITIONS_REL,
} from '../core/constants.js';
import type {
  CanonicalPublicationGraph,
  ReadiumManifest,
} from '../core/types.js';

export function buildManifest(
  graph: CanonicalPublicationGraph,
  manifestBaseUrl: string,
): ReadiumManifest {
  const manifest: ReadiumManifest = {
    '@context': MANIFEST_CONTEXT_URL,
    metadata: {
      '@type': 'http://schema.org/Book',
      title: graph.metadata.title,
      identifier: graph.metadata.identifier,
      language: graph.metadata.language,
      author: graph.metadata.author,
      modified: graph.metadata.modified,
      published: graph.metadata.published,
      direction: graph.metadata.direction,
      layout: 'reflowable',
    },
    conformsTo: [EPUB_PROFILE_URL],
    links: [
      {
        rel: 'self',
        href: new URL(MANIFEST_FILENAME, manifestBaseUrl).toString(),
        type: MANIFEST_MEDIA_TYPE,
      },
      {
        rel: POSITIONS_REL,
        href: POSITIONS_FILENAME,
        type: POSITIONS_MEDIA_TYPE,
      },
    ],
    readingOrder: graph.readingOrder.map((item) => ({
      href: item.href,
      type: item.mediaType,
      title: item.title,
      properties: item.properties,
    })),
    resources: graph.resources.map((item) => ({
      href: item.href,
      type: item.mediaType,
      title: item.title,
      properties: item.properties,
      rel: item.rel,
    })),
    toc: graph.toc,
  };

  if (graph.cover) {
    manifest.links.push({
      rel: 'cover',
      href: graph.cover.href,
      type: graph.cover.mediaType,
    });
  }

  return manifest;
}
