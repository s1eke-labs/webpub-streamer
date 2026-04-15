import { describe, expect, it } from 'vitest';

import { parseTxt } from '../../src/parse/txt/parseTxt.js';
import { createChineseTxt, createEnglishTxt } from '../helpers/createTextFixtures.js';

const encoder = new TextEncoder();

describe('parseTxt', () => {
  it('creates chapters from english text', async () => {
    const graph = await parseTxt(encoder.encode(createEnglishTxt()), 'book.txt', {
      format: 'txt',
      targetProfile: 'epub',
      cachePolicy: 'reuse',
      validate: false,
      txt: {
        chapterDetection: 'auto',
        chapterPatterns: [],
        language: 'en',
        title: undefined,
        encoding: undefined,
      },
      epub: {
        allowRemoteResources: 'reject',
        javascriptPolicy: 'strip',
        unsupportedFontPolicy: 'warn-and-drop',
      },
    });

    expect(graph.metadata.title).toBe('book');
    expect(graph.readingOrder).toHaveLength(2);
    expect(graph.toc[0]?.title).toBe('Chapter 1');
  });

  it('creates chapters from chinese headings', async () => {
    const graph = await parseTxt(encoder.encode(createChineseTxt()), 'novel.txt', {
      format: 'txt',
      targetProfile: 'epub',
      cachePolicy: 'reuse',
      validate: false,
      txt: {
        chapterDetection: 'auto',
        chapterPatterns: [],
        language: 'zh-Hans',
        title: '中文小说',
        encoding: undefined,
      },
      epub: {
        allowRemoteResources: 'reject',
        javascriptPolicy: 'strip',
        unsupportedFontPolicy: 'warn-and-drop',
      },
    });

    expect(graph.metadata.title).toBe('中文小说');
    expect(graph.readingOrder).toHaveLength(2);
    expect(graph.readingOrder[0]?.title).toContain('第1章');
  });
});
