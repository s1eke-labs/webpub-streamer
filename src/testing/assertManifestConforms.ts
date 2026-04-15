import Ajv2020 from 'ajv/dist/2020.js';

import type { ReadiumManifest, TargetProfile } from '../core/types.js';
import coreSchema from '../../tests/fixtures/schemas/publication.schema.json';
import epubSchema from '../../tests/fixtures/schemas/publication.epub.schema.json';

const ajv = new Ajv2020({
  allErrors: true,
  strict: false,
});

const validateCore = ajv.compile(coreSchema);
const validateEpub = ajv.compile(epubSchema);

function formatErrors(errors: typeof validateCore.errors): string {
  return (errors ?? [])
    .map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`)
    .join('; ');
}

export function assertManifestConforms(
  manifest: unknown,
  profile: TargetProfile = 'epub',
): asserts manifest is ReadiumManifest {
  if (!validateCore(manifest)) {
    throw new Error(`Manifest validation failed: ${formatErrors(validateCore.errors)}`);
  }

  if (profile === 'epub' && !validateEpub(manifest)) {
    throw new Error(`EPUB profile validation failed: ${formatErrors(validateEpub.errors)}`);
  }

  const typedManifest = manifest as unknown as ReadiumManifest;
  const selfLink = typedManifest.links.find((link) => link.rel === 'self');
  if (!selfLink) {
    throw new Error('Manifest must include a self link');
  }

  if (!/^https?:\/\//.test(selfLink.href)) {
    throw new Error('Manifest self link must be absolute');
  }
}
