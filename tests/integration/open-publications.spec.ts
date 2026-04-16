import { expect, test } from '@playwright/test';

import { createEnglishTxt } from '../helpers/createTextFixtures.js';
import { createTestEpub } from '../helpers/createTestEpub.js';

const encoder = new TextEncoder();

async function bootHarness(
  page: import('@playwright/test').Page,
  mountMode: 'merged' | 'standalone',
): Promise<void> {
  await page.goto(`/__webpub_streamer__/?mountMode=${mountMode}`);
  await expect(page.getByTestId('status')).toHaveText('ready', {
    timeout: 15_000,
  });
  await expect(page.getByTestId('mount-mode')).toHaveText(mountMode);
}

async function openBuffer(
  page: import('@playwright/test').Page,
  buffer: Uint8Array,
  name: string,
  type: string,
): Promise<{
  publicationId: string;
  manifestUrl: string;
  debugEventTypes: string[];
}> {
  return page.evaluate(async ({ bytes, name: fileName, type: mediaType }) => {
    return window.__webpubHarness!.openBuffer(bytes, fileName, mediaType);
  }, {
    bytes: Array.from(buffer),
    name,
    type,
  });
}

test('opens txt in Thorium harness with merged root service worker handler', async ({ page }) => {
  await bootHarness(page, 'merged');
  await openBuffer(page, encoder.encode(createEnglishTxt()), 'fixture.txt', 'text/plain');
  await expect(page.getByTestId('phase')).toHaveText('open:done', {
    timeout: 15_000,
  });

  await expect(page.getByTestId('publication-title')).toHaveText('fixture');
  await expect(page.getByTestId('profile')).not.toHaveText('');
  await expect(page.getByTestId('publication-loaded')).toHaveText('yes');
  await expect(page.getByTestId('reader-mounted')).toBeVisible();
});

test('opens epub in Thorium harness and exposes toc through merged root service worker handler', async ({ page }) => {
  await bootHarness(page, 'merged');
  await openBuffer(page, createTestEpub({
    title: 'Fixture EPUB',
  }), 'fixture.epub', 'application/epub+zip');
  await expect(page.getByTestId('phase')).toHaveText('open:done', {
    timeout: 15_000,
  });

  await expect(page.getByTestId('publication-title')).toHaveText('Fixture EPUB');
  await expect(page.getByTestId('toc-titles')).toContainText('Start');
  await expect(page.getByTestId('publication-loaded')).toHaveText('yes');
  await expect(page.getByTestId('reader-mounted')).toBeVisible();
});

test('keeps standalone runtime service worker as a smoke-tested fallback', async ({ page }) => {
  await bootHarness(page, 'standalone');
  await openBuffer(page, encoder.encode(createEnglishTxt()), 'fixture.txt', 'text/plain');
  await expect(page.getByTestId('phase')).toHaveText('open:done', {
    timeout: 15_000,
  });

  await expect(page.getByTestId('publication-title')).toHaveText('fixture');
  await expect(page.getByTestId('publication-loaded')).toHaveText('yes');
  await expect(page.getByTestId('reader-mounted')).toBeVisible();
});

test('reuses cached publications without reparsing on the second open', async ({ page }) => {
  await bootHarness(page, 'merged');
  const first = await openBuffer(page, encoder.encode(createEnglishTxt()), 'fixture.txt', 'text/plain');
  await expect(page.getByTestId('phase')).toHaveText('open:done', {
    timeout: 15_000,
  });

  const second = await openBuffer(page, encoder.encode(createEnglishTxt()), 'fixture.txt', 'text/plain');
  await expect(page.getByTestId('phase')).toHaveText('open:done', {
    timeout: 15_000,
  });

  expect(first.debugEventTypes).toContain('parse');
  expect(second.debugEventTypes).toContain('cache-hit');
  expect(second.debugEventTypes).not.toContain('parse');
  await expect(page.getByTestId('publication-loaded')).toHaveText('yes');
  await expect(page.getByTestId('reader-mounted')).toBeVisible();
});
