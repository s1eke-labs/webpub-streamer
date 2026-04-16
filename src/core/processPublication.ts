import { UnsupportedTargetProfileError } from './errors.js';
import type {
  MaterializedPublication,
  ParserRequestPayload,
} from './types.js';
import { materializePublication } from '../materialize/materializePublication.js';
import { buildCanonicalGraph } from '../normalize/buildCanonicalGraph.js';
import { parseEpub } from '../parse/epub/parseEpub.js';
import { parseTxt } from '../parse/txt/parseTxt.js';

export async function processPublicationRequest(
  payload: ParserRequestPayload,
): Promise<MaterializedPublication> {
  if (payload.options.targetProfile !== 'epub') {
    throw new UnsupportedTargetProfileError(payload.options.targetProfile);
  }

  const parsedGraph = payload.format === 'epub'
    ? await parseEpub(payload.sourceBytes, payload.options)
    : await parseTxt(payload.sourceBytes, payload.sourceName, payload.options);
  const graph = buildCanonicalGraph(parsedGraph);
  const materialized = materializePublication({
    publicationId: payload.publicationId,
    sourceFingerprint: payload.sourceFingerprint,
    parserVersion: payload.parserVersion,
    graph,
    manifestBaseUrl: payload.manifestBaseUrl,
  });

  return {
    ...materialized,
    source: {
      name: payload.sourceName,
      mediaType: payload.sourceMediaType,
      format: payload.format,
      byteLength: payload.sourceBytes.byteLength,
    },
    txtChapterDiagnostics: graph.txtChapterDiagnostics,
  };
}
