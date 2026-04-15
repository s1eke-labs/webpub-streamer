import {
  DEFAULT_SCOPE,
  HEALTHCHECK_PATH,
  MANIFEST_FILENAME,
  POSITIONS_FILENAME,
} from '../core/constants.js';

function ensureTrailingSlash(value: string): string {
  return value.endsWith('/') ? value : `${value}/`;
}

function resolveOrigin(origin?: string): string {
  return origin ?? globalThis.location?.origin ?? 'http://localhost';
}

export function normalizeScope(scope = DEFAULT_SCOPE): string {
  if (!scope.startsWith('/')) {
    return ensureTrailingSlash(`/${scope}`);
  }

  return ensureTrailingSlash(scope);
}

export function scopeBaseUrl(
  scope = DEFAULT_SCOPE,
  origin = globalThis.location?.origin ?? 'http://localhost',
): string {
  return new URL(normalizeScope(scope), origin).toString();
}

export function publicationPathPrefix(scope: string, publicationId: string): string {
  return `${normalizeScope(scope)}pub/${publicationId}/`;
}

export function publicationBaseUrl(scope: string, publicationId: string, origin?: string): string {
  return new URL(
    publicationPathPrefix(scope, publicationId),
    resolveOrigin(origin),
  ).toString();
}

export function publicationManifestPath(scope: string, publicationId: string): string {
  return `${publicationPathPrefix(scope, publicationId)}${MANIFEST_FILENAME}`;
}

export function publicationManifestUrl(
  scope: string,
  publicationId: string,
  origin?: string,
): string {
  return new URL(
    publicationManifestPath(scope, publicationId),
    resolveOrigin(origin),
  ).toString();
}

export function publicationPositionsPath(scope: string, publicationId: string): string {
  return `${publicationPathPrefix(scope, publicationId)}${POSITIONS_FILENAME}`;
}

export function publicationPositionsUrl(
  scope: string,
  publicationId: string,
  origin?: string,
): string {
  return new URL(
    publicationPositionsPath(scope, publicationId),
    resolveOrigin(origin),
  ).toString();
}

export function publicationResourcePath(
  scope: string,
  publicationId: string,
  resourcePath: string,
): string {
  return `${publicationPathPrefix(scope, publicationId)}${resourcePath}`;
}

export function healthcheckPath(scope: string): string {
  return `${normalizeScope(scope)}${HEALTHCHECK_PATH}`;
}

export function healthcheckUrl(scope: string, origin?: string): string {
  return new URL(healthcheckPath(scope), resolveOrigin(origin)).toString();
}

export interface ParsedRuntimeRequest {
  publicationId: string;
  resourcePath: string;
}

export function parseRuntimeRequestPath(
  scope: string,
  pathname: string,
): ParsedRuntimeRequest | null {
  const normalizedScope = normalizeScope(scope);
  if (!pathname.startsWith(`${normalizedScope}pub/`)) {
    return null;
  }

  const remainder = pathname.slice(`${normalizedScope}pub/`.length);
  const slashIndex = remainder.indexOf('/');
  if (slashIndex === -1) {
    return null;
  }

  const publicationId = remainder.slice(0, slashIndex);
  const resourcePath = remainder.slice(slashIndex + 1);

  if (!publicationId || !resourcePath) {
    return null;
  }

  return {
    publicationId,
    resourcePath,
  };
}
