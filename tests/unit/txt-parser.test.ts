import { describe, expect, it } from 'vitest';

import {
  detectChapters,
  detectChaptersWithDiagnostics,
} from '../../src/parse/txt/detectChapters.js';
import { parseTxt } from '../../src/parse/txt/parseTxt.js';
import { createChineseTxt, createEnglishTxt } from '../helpers/createTextFixtures.js';

const encoder = new TextEncoder();

function createTxtOptions(overrides?: {
  chapterDetection?: 'auto' | 'none' | 'regex';
  chapterPatterns?: RegExp[];
  language?: string;
  title?: string;
}) {
  return {
    format: 'txt' as const,
    targetProfile: 'epub' as const,
    cachePolicy: 'reuse' as const,
    validate: false,
    txt: {
      chapterDetection: overrides?.chapterDetection ?? 'auto',
      chapterPatterns: overrides?.chapterPatterns ?? [],
      language: overrides?.language ?? 'en',
      title: overrides?.title,
      encoding: undefined,
    },
    epub: {
      allowRemoteResources: 'reject' as const,
      javascriptPolicy: 'strip' as const,
      unsupportedFontPolicy: 'warn-and-drop' as const,
    },
  };
}

async function parseFixtureText(
  text: string,
  options?: {
    fileName?: string;
    chapterDetection?: 'auto' | 'none' | 'regex';
    chapterPatterns?: RegExp[];
    language?: string;
    title?: string;
  },
) {
  return parseTxt(
    encoder.encode(text),
    options?.fileName ?? 'book.txt',
    createTxtOptions(options),
  );
}

describe('parseTxt', () => {
  it('creates chapters from english text', async () => {
    const graph = await parseFixtureText(createEnglishTxt());

    expect(graph.metadata.title).toBe('book');
    expect(graph.readingOrder).toHaveLength(2);
    expect(graph.toc[0]?.title).toBe('Chapter 1');
  });

  it('creates chapters from chinese headings', async () => {
    const graph = await parseFixtureText(createChineseTxt(), {
      fileName: 'novel.txt',
      language: 'zh-Hans',
      title: '中文小说',
    });

    expect(graph.metadata.title).toBe('中文小说');
    expect(graph.readingOrder).toHaveLength(2);
    expect(graph.readingOrder[0]?.title).toContain('第1章');
  });

  it.each([
    ['第一章 标题', '第一章 标题'],
    ['1、这个就是标题', '1、这个就是标题'],
    ['二十四章 我瞎编的标题', '二十四章 我瞎编的标题'],
    ['正文 我奶常山赵子龙', '正文 我奶常山赵子龙'],
    ['Chapter 1 MyGrandmaIsNB', 'Chapter 1 MyGrandmaIsNB'],
    ['Chapter One The Beginning', 'Chapter One The Beginning'],
    ['CHAPTER IV The House on the Hill', 'CHAPTER IV The House on the Hill'],
    ['Part II The Long Road', 'Part II The Long Road'],
    ['Prologue: Before the Storm', 'Prologue: Before the Storm'],
    ['Epilogue', 'Epilogue'],
    ['Episode IV A New Dawn', 'Episode IV A New Dawn'],
    ['卷五 开源盛世', '卷五 开源盛世'],
    ['标题后面数字有括号(12)', '标题后面数字有括号(12)'],
    ['标题后面数字没有括号124', '标题后面数字没有括号124'],
    ['第一页 翻页测试', '第一页 翻页测试'],
    ['分节阅读- 第一节', '分节阅读- 第一节'],
  ])('recognizes built-in chapter rule for %s', async (heading, expectedTitle) => {
    const graph = await parseFixtureText(`${heading}\n\n这里是正文内容。`);

    expect(graph.readingOrder).toHaveLength(1);
    expect(graph.readingOrder[0]?.title).toBe(expectedTitle);
    expect(graph.toc[0]?.title).toBe(expectedTitle);
  });

  it('keeps leading indentation for matching but normalizes the emitted chapter title', async () => {
    const chapters = detectChapters('   第一章 缩进标题\n\n这里是正文内容。', {
      chapterDetection: 'auto',
      chapterPatterns: [],
    });

    expect(chapters).toHaveLength(1);

    const graph = await parseFixtureText('   第一章 缩进标题\n\n这里是正文内容。');
    expect(graph.readingOrder[0]?.title).toBe('第一章 缩进标题');
    expect(graph.toc[0]?.title).toBe('第一章 缩进标题');
  });

  it('records chapter diagnostics with line numbers and rule metadata', () => {
    const detected = detectChaptersWithDiagnostics('Preface\n\nChapter 1\n\n这里是段落内容。', {
      chapterDetection: 'auto',
      chapterPatterns: [],
    });

    expect(detected.diagnostics).toEqual([
      {
        title: 'Preface',
        lineNumber: 1,
        ruleName: 'Prologue/Epilogue 等英文单章标题',
        source: 'builtin',
      },
      {
        title: 'Chapter 1',
        lineNumber: 3,
        ruleName: 'Chapter/Ch. 序号 标题',
        source: 'builtin',
      },
    ]);
  });

  it('uses only caller-provided patterns in regex mode', async () => {
    const graph = await parseFixtureText(
      'Chapter 1\n\n这段内容不会触发内置规则。\n\nScene 1\n\n这是自定义规则命中的章节。',
      {
        chapterDetection: 'regex',
        chapterPatterns: [/^Scene\s+\d+.*$/u],
      },
    );

    expect(graph.readingOrder).toHaveLength(2);
    expect(graph.readingOrder[0]?.title).toBe('Start');
    expect(graph.readingOrder[1]?.title).toBe('Scene 1');
    expect(graph.txtChapterDiagnostics).toEqual([
      {
        title: 'Start',
        lineNumber: 1,
        source: 'fallback',
      },
      {
        title: 'Scene 1',
        lineNumber: 5,
        ruleName: 'custom:1',
        source: 'custom',
      },
    ]);
  });

  it('records fallback chapter diagnostics at the first non-empty line', () => {
    const detected = detectChaptersWithDiagnostics(
      '\n\nChapter 1\n\n这段内容不会触发内置规则。\n\nScene 1\n\n这是自定义规则命中的章节。',
      {
        chapterDetection: 'regex',
        chapterPatterns: [/^Scene\s+\d+.*$/u],
      },
    );

    expect(detected.diagnostics).toEqual([
      {
        title: 'Start',
        lineNumber: 3,
        source: 'fallback',
      },
      {
        title: 'Scene 1',
        lineNumber: 7,
        ruleName: 'custom:1',
        source: 'custom',
      },
    ]);
  });

  it('does not fall back to built-in rules when regex mode has no patterns', async () => {
    const graph = await parseFixtureText(
      'Chapter 1\n\n这段内容不应触发内置规则。\n\n第一章 中文标题\n\n后续内容仍属于同一章节。',
      {
        chapterDetection: 'regex',
        chapterPatterns: [],
      },
    );

    expect(graph.readingOrder).toHaveLength(1);
    expect(graph.readingOrder[0]?.title).toBe('Start');
    expect(graph.toc[0]?.title).toBe('Start');
  });

  it('drops whitespace-only lines at the document edges before chapter detection', async () => {
    const graph = await parseFixtureText(
      ' \t　\n   第一章 缩进标题\n\n这里是正文内容。\n\t　 ',
    );

    expect(graph.readingOrder).toHaveLength(1);
    expect(graph.readingOrder[0]?.title).toBe('第一章 缩进标题');
    expect(graph.toc[0]?.title).toBe('第一章 缩进标题');
  });

  it.each([
    'Chapter one explains the system.',
    'Section three covers testing.',
    'Book one was missing from the shelf.',
  ])('does not treat ordinary English prose as a numbered heading: %s', async (line) => {
    const graph = await parseFixtureText(`${line}\n\nStill the same chapter.`);

    expect(graph.readingOrder).toHaveLength(1);
    expect(graph.readingOrder[0]?.title).toBe('Start');
    expect(graph.toc[0]?.title).toBe('Start');
  });

  it.each([
    'Introduction to algorithms is hard.',
    'Epilogue of the story follows.',
  ])('does not treat ordinary prose as a standalone English heading: %s', async (line) => {
    const graph = await parseFixtureText(`${line}\n\nStill the same chapter.`);

    expect(graph.readingOrder).toHaveLength(1);
    expect(graph.readingOrder[0]?.title).toBe('Start');
    expect(graph.toc[0]?.title).toBe('Start');
  });

  it('requires boundary context before treating an auto-detected heading as a chapter title', async () => {
    const graph = await parseFixtureText(
      '前文内容\nChapter 1\nThis line should stay in the same chapter.\n\nChapter 2\n\nNew section starts here.',
    );

    expect(graph.readingOrder).toHaveLength(2);
    expect(graph.readingOrder[0]?.title).toBe('Start');
    expect(graph.readingOrder[1]?.title).toBe('Chapter 2');
  });
});
