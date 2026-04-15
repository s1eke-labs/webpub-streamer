import type { PublicationRuntime, ReadiumManifest } from '../core/types.js';
import { assertManifestConforms } from './assertManifestConforms.js';
import { assertPositionsValid } from './assertPositionsValid.js';

export async function assertRuntimeFetchable(
  runtime: PublicationRuntime,
): Promise<ReadiumManifest> {
  const manifestResponse = await fetch(runtime.manifestUrl, {
    cache: 'no-store',
  });
  if (!manifestResponse.ok) {
    throw new Error(`Unable to fetch manifest: ${manifestResponse.status}`);
  }

  const manifest = (await manifestResponse.json()) as ReadiumManifest;
  assertManifestConforms(manifest, runtime.profileHint);

  const positionsResponse = await fetch(runtime.positionsUrl, {
    cache: 'no-store',
  });
  if (!positionsResponse.ok) {
    throw new Error(`Unable to fetch positions: ${positionsResponse.status}`);
  }

  const positions = await positionsResponse.json();
  assertPositionsValid(positions);

  const fetchTargets = [
    ...manifest.readingOrder.map((link) => link.href),
    ...(manifest.resources ?? []).map((link) => link.href),
  ];

  for (const target of fetchTargets) {
    const url = new URL(target, runtime.baseUrl).toString();
    const response = await fetch(url, {
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`Unable to fetch runtime resource ${url}: ${response.status}`);
    }
  }

  return manifest;
}
