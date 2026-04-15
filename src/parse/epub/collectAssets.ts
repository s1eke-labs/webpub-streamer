import { basename, extname, sanitizePathSegment } from '../../core/path-utils.js';
import { resolveMediaType } from '../../materialize/mediaType.js';
import type { EpubManifestItem } from './readOpf.js';

function createUniquePath(prefix: string, fileName: string, usedPaths: Set<string>): string {
  const extension = extname(fileName);
  const baseName = sanitizePathSegment(fileName.replace(new RegExp(`${extension}$`), ''));
  let attempt = `${prefix}/${baseName}${extension}`;
  let index = 1;

  while (usedPaths.has(attempt)) {
    attempt = `${prefix}/${baseName}-${index}${extension}`;
    index += 1;
  }

  usedPaths.add(attempt);
  return attempt;
}

export function collectRuntimePaths(
  manifest: EpubManifestItem[],
  spineIds: Set<string>,
): Map<string, string> {
  const mapping = new Map<string, string>();
  const usedPaths = new Set<string>();
  let spineIndex = 1;

  for (const item of manifest) {
    if (spineIds.has(item.id)) {
      const path = `spine/chapter-${String(spineIndex).padStart(3, '0')}.xhtml`;
      mapping.set(item.href, path);
      usedPaths.add(path);
      spineIndex += 1;
      continue;
    }

    const fileName = basename(item.href);
    const targetDir = resolveMediaType(item.href, item.mediaType) === 'text/css' ? 'styles' : 'assets';
    mapping.set(item.href, createUniquePath(targetDir, fileName, usedPaths));
  }

  return mapping;
}
