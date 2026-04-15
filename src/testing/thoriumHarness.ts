import type { PublicationRuntime } from '../core/types.js';

export interface OpenInThoriumHarnessOptions {
  harnessUrl?: string;
  open?: (url: string) => Promise<void> | void;
}

export async function openInThoriumHarness(
  runtime: Pick<PublicationRuntime, 'manifestUrl'>,
  options: OpenInThoriumHarnessOptions = {},
): Promise<string> {
  const harnessUrl = new URL(options.harnessUrl ?? '/', globalThis.location?.origin ?? 'http://localhost');
  harnessUrl.searchParams.set('manifestUrl', runtime.manifestUrl);
  const resolvedUrl = harnessUrl.toString();

  if (options.open) {
    await options.open(resolvedUrl);
  }

  return resolvedUrl;
}
