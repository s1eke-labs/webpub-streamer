import { UnsupportedTextEncodingError } from '../../core/errors.js';

const BOM_UTF8 = [0xef, 0xbb, 0xbf];
const BOM_UTF16_LE = [0xff, 0xfe];
const BOM_UTF16_BE = [0xfe, 0xff];

function hasPrefix(bytes: Uint8Array, prefix: number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value);
}

function canDecode(bytes: Uint8Array, encoding: string): boolean {
  try {
    const decoder = new TextDecoder(encoding, {
      fatal: true,
    });
    decoder.decode(bytes);
    return true;
  } catch {
    return false;
  }
}

export function detectTextEncoding(bytes: Uint8Array, explicitEncoding?: string): string {
  if (explicitEncoding) {
    if (!canDecode(bytes, explicitEncoding)) {
      throw new UnsupportedTextEncodingError(explicitEncoding);
    }
    return explicitEncoding;
  }

  if (hasPrefix(bytes, BOM_UTF8)) {
    return 'utf-8';
  }

  if (hasPrefix(bytes, BOM_UTF16_LE)) {
    return 'utf-16le';
  }

  if (hasPrefix(bytes, BOM_UTF16_BE)) {
    return 'utf-16be';
  }

  const candidates = ['utf-8', 'utf-16le', 'utf-16be', 'gb18030'];
  for (const candidate of candidates) {
    if (canDecode(bytes, candidate)) {
      return candidate;
    }
  }

  throw new UnsupportedTextEncodingError();
}

export function decodeText(bytes: Uint8Array, explicitEncoding?: string): {
  encoding: string;
  content: string;
} {
  const encoding = detectTextEncoding(bytes, explicitEncoding);
  const decoder = new TextDecoder(encoding, {
    fatal: true,
  });
  let content = decoder.decode(bytes);

  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  return {
    encoding,
    content,
  };
}
