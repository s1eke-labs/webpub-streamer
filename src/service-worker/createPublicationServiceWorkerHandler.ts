/// <reference lib="webworker" />

import {
  DEFAULT_DB_NAME,
  DEFAULT_SCOPE,
  HEALTHCHECK_PATH,
  MANIFEST_FILENAME,
  MANIFEST_MEDIA_TYPE,
  POSITIONS_FILENAME,
  POSITIONS_MEDIA_TYPE,
} from '../core/constants.js';
import type {
  PublicationServiceWorkerHandler,
  PublicationServiceWorkerHandlerOptions,
  PublicationServiceWorkerRequestInput,
} from '../core/types.js';
import { normalizeScope, parseRuntimeRequestPath } from '../mount/runtimeUrls.js';
import { openRuntimeDatabase } from '../store/idb/schema.js';

function resolveUrl(request: PublicationServiceWorkerRequestInput): URL {
  if (request instanceof Request) {
    return new URL(request.url);
  }

  if (request instanceof URL) {
    return request;
  }

  return new URL(request, globalThis.location?.origin ?? 'http://localhost');
}

function jsonResponse(body: unknown, contentType: string): Response {
  return new Response(JSON.stringify(body, null, 2), {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-store',
    },
  });
}

export function createPublicationServiceWorkerHandler(
  options: PublicationServiceWorkerHandlerOptions = {},
): PublicationServiceWorkerHandler {
  const dbName = options.dbName ?? DEFAULT_DB_NAME;
  const scope = normalizeScope(options.scope ?? DEFAULT_SCOPE);
  const mode = options.mode ?? 'merged';
  const healthPath = `${scope}${HEALTHCHECK_PATH}`;
  const matchesRuntimeRequest = (request: PublicationServiceWorkerRequestInput): boolean => {
    const { pathname } = resolveUrl(request);
    return pathname === healthPath || parseRuntimeRequestPath(scope, pathname) !== null;
  };

  return {
    scope,
    dbName,
    mode,
    matches(request) {
      return matchesRuntimeRequest(request);
    },
    async respond(request) {
      const url = new URL(request.url);
      if (!matchesRuntimeRequest(request)) {
        return new Response('Not found', {
          status: 404,
        });
      }

      if (url.pathname === healthPath) {
        return jsonResponse({
          ok: true,
          dbName,
          scope,
          mode,
        }, 'application/json');
      }

      const parsedPath = parseRuntimeRequestPath(scope, url.pathname);
      if (!parsedPath) {
        return new Response('Not found', {
          status: 404,
        });
      }

      const database = await openRuntimeDatabase(dbName);
      const publication = await database.get('publications', parsedPath.publicationId);
      if (!publication) {
        return new Response('Not found', {
          status: 404,
        });
      }

      if (parsedPath.resourcePath === MANIFEST_FILENAME) {
        return jsonResponse(publication.manifest, MANIFEST_MEDIA_TYPE);
      }

      if (parsedPath.resourcePath === POSITIONS_FILENAME) {
        return jsonResponse(publication.positions, POSITIONS_MEDIA_TYPE);
      }

      const resource = await database.getFromIndex('resources', 'byPublicationIdAndPath', [
        parsedPath.publicationId,
        parsedPath.resourcePath,
      ]);

      if (!resource) {
        return new Response('Not found', {
          status: 404,
        });
      }

      return new Response(resource.body, {
        headers: {
          'Content-Type': resource.mediaType,
          'Content-Length': String(resource.byteLength),
          'Cache-Control': 'no-store',
        },
      });
    },
  };
}
