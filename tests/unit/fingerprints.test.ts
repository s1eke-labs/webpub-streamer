import { describe, expect, it } from 'vitest';

import { fingerprintPublication, fingerprintSource } from '../../src/core/fingerprints.js';

describe('fingerprints', () => {
  it('creates deterministic source fingerprints', async () => {
    const source = new Uint8Array([1, 2, 3, 4]);
    await expect(fingerprintSource(source)).resolves.toBe(await fingerprintSource(source));
  });

  it('stably hashes equivalent option objects', async () => {
    const source = new Uint8Array([5, 6, 7]);
    const left = await fingerprintPublication(source, '1.0.0', {
      b: 2,
      a: 1,
      regex: /chapter/iu,
    });
    const right = await fingerprintPublication(source, '1.0.0', {
      a: 1,
      regex: /chapter/iu,
      b: 2,
    });

    expect(left).toBe(right);
  });
});
