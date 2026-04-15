const encoder = new TextEncoder();

function stableStringify(value: unknown): string {
  if (value instanceof RegExp) {
    return JSON.stringify({
      source: value.source,
      flags: value.flags,
    });
  }

  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`);

  return `{${entries.join(',')}}`;
}

function concatUint8Arrays(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const merged = new Uint8Array(totalLength);

  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.byteLength;
  }

  return merged;
}

async function sha256(input: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(input));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

export async function fingerprintSource(bytes: Uint8Array): Promise<string> {
  return sha256(bytes);
}

export async function fingerprintPublication(
  sourceBytes: Uint8Array,
  parserVersion: string,
  normalizedOptions: unknown,
): Promise<string> {
  const payload = concatUint8Arrays([
    sourceBytes,
    encoder.encode(parserVersion),
    encoder.encode(stableStringify(normalizedOptions)),
  ]);

  return sha256(payload);
}
