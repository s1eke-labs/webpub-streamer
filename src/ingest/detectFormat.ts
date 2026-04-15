import type { InputFormat } from '../core/types.js';

const EPUB_MEDIA_TYPES = new Set([
  'application/epub+zip',
]);

const TXT_MEDIA_TYPES = new Set([
  'text/plain',
]);

export function detectFormatFromNameAndType(
  fileName: string | undefined,
  mediaType: string | undefined,
): Exclude<InputFormat, 'auto'> | null {
  const normalizedType = mediaType?.toLowerCase();
  if (normalizedType && EPUB_MEDIA_TYPES.has(normalizedType)) {
    return 'epub';
  }

  if (normalizedType && TXT_MEDIA_TYPES.has(normalizedType)) {
    return 'txt';
  }

  const lowerName = fileName?.toLowerCase();
  if (lowerName?.endsWith('.epub')) {
    return 'epub';
  }

  if (lowerName?.endsWith('.txt')) {
    return 'txt';
  }

  return null;
}
