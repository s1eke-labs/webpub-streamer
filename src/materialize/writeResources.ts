import type {
  CanonicalPublicationGraph,
  MaterializedResource,
} from '../core/types.js';

const textEncoder = new TextEncoder();

export function writeResources(
  graph: CanonicalPublicationGraph,
  manifest: unknown,
  positions: unknown,
): MaterializedResource[] {
  const resources: MaterializedResource[] = [
    {
      path: 'manifest.json',
      mediaType: 'application/webpub+json',
      body: textEncoder.encode(JSON.stringify(manifest, null, 2)),
      textContent: JSON.stringify(manifest, null, 2),
    },
    {
      path: 'positions.json',
      mediaType: 'application/vnd.readium.position-list+json',
      body: textEncoder.encode(JSON.stringify(positions, null, 2)),
      textContent: JSON.stringify(positions, null, 2),
    },
  ];

  for (const item of graph.readingOrder) {
    resources.push({
      path: item.path,
      mediaType: item.mediaType,
      body: item.content,
      textContent: item.textContent,
    });
  }

  for (const item of graph.resources) {
    resources.push({
      path: item.path,
      mediaType: item.mediaType,
      body: item.content,
      textContent: item.textContent,
    });
  }

  return resources;
}
