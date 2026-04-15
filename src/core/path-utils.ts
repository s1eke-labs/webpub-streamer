function splitPath(path: string): string[] {
  return path
    .split('/')
    .filter(Boolean)
    .filter((segment) => segment !== '.');
}

export function normalizePath(path: string): string {
  const segments = splitPath(path);
  const normalized: string[] = [];

  for (const segment of segments) {
    if (segment === '..') {
      normalized.pop();
      continue;
    }

    normalized.push(segment);
  }

  return normalized.join('/');
}

export function dirname(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  if (index === -1) {
    return '';
  }

  return normalized.slice(0, index);
}

export function basename(path: string): string {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf('/');
  return index === -1 ? normalized : normalized.slice(index + 1);
}

export function extname(path: string): string {
  const name = basename(path);
  const index = name.lastIndexOf('.');
  return index === -1 ? '' : name.slice(index).toLowerCase();
}

export function joinPath(...segments: string[]): string {
  return normalizePath(segments.filter(Boolean).join('/'));
}

export function resolveRelativePath(fromFilePath: string, href: string): string {
  if (!href) {
    return href;
  }

  if (href.startsWith('/')) {
    return normalizePath(href);
  }

  const hashIndex = href.indexOf('#');
  const cleanHref = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const anchor = hashIndex === -1 ? '' : href.slice(hashIndex);

  const fromDirectory = dirname(fromFilePath);
  const resolved = normalizePath(joinPath(fromDirectory, cleanHref));
  return anchor ? `${resolved}${anchor}` : resolved;
}

export function relativePath(fromFilePath: string, toPath: string): string {
  const fromSegments = splitPath(dirname(fromFilePath));
  const toSegments = splitPath(toPath);

  while (fromSegments.length > 0 && toSegments.length > 0 && fromSegments[0] === toSegments[0]) {
    fromSegments.shift();
    toSegments.shift();
  }

  const upwards = fromSegments.map(() => '..');
  const result = [...upwards, ...toSegments].join('/');
  return result || './';
}

export function sanitizePathSegment(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '') || 'resource';
}
