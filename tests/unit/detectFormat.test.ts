import { describe, expect, it } from 'vitest';

import { detectFormatFromNameAndType } from '../../src/ingest/detectFormat.js';

describe('detectFormatFromNameAndType', () => {
  it('detects epub by extension', () => {
    expect(detectFormatFromNameAndType('book.epub', undefined)).toBe('epub');
  });

  it('detects text by media type', () => {
    expect(detectFormatFromNameAndType('book.bin', 'text/plain')).toBe('txt');
  });

  it('returns null for unsupported inputs', () => {
    expect(detectFormatFromNameAndType('book.pdf', 'application/pdf')).toBeNull();
  });
});
