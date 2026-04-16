import {
  MANIFEST_FILENAME,
  POSITIONS_FILENAME,
} from '../core/constants.js';
import type {
  CanonicalPublicationGraph,
  MaterializedPublication,
} from '../core/types.js';
import { buildManifest } from './buildManifest.js';
import { buildPositions } from './buildPositions.js';
import { writeResources } from './writeResources.js';

export function materializePublication(params: {
  publicationId: string;
  sourceFingerprint: string;
  parserVersion: string;
  graph: CanonicalPublicationGraph;
  manifestBaseUrl: string;
}): Omit<MaterializedPublication, 'source' | 'txtChapterDiagnostics'> {
  const manifest = buildManifest(params.graph, params.manifestBaseUrl);
  const positions = buildPositions(params.graph.readingOrder);
  const resources = writeResources(params.graph, manifest, positions);

  return {
    publicationId: params.publicationId,
    sourceFingerprint: params.sourceFingerprint,
    parserVersion: params.parserVersion,
    profileHint: 'epub',
    manifestPath: MANIFEST_FILENAME,
    positionsPath: POSITIONS_FILENAME,
    manifest,
    positions,
    resources,
    warnings: params.graph.warnings,
  };
}
