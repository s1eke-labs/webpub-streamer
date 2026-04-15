import { extname } from '../core/path-utils.js';

const MEDIA_TYPES = new Map<string, string>([
  ['.css', 'text/css'],
  ['.gif', 'image/gif'],
  ['.htm', 'application/xhtml+xml'],
  ['.html', 'application/xhtml+xml'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'application/javascript'],
  ['.json', 'application/json'],
  ['.ncx', 'application/x-dtbncx+xml'],
  ['.opf', 'application/oebps-package+xml'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.ttf', 'font/ttf'],
  ['.txt', 'text/plain'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.xhtml', 'application/xhtml+xml'],
  ['.xml', 'application/xml'],
]);

export function resolveMediaType(path: string, fallback?: string): string {
  return fallback ?? MEDIA_TYPES.get(extname(path)) ?? 'application/octet-stream';
}
