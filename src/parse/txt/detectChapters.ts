import { AUTO_TXT_CHAPTER_PATTERNS } from './chapterRules.js';

export interface ParsedChapter {
  title: string;
  lines: string[];
}

function normalizeChapterTitle(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function isHeadingLike(line: string, patterns: RegExp[]): boolean {
  if (!line.trim()) {
    return false;
  }

  return patterns.some((pattern) => pattern.test(line));
}

function createFallbackTitle(index: number): string {
  return index === 0 ? 'Start' : `Chapter ${index + 1}`;
}

export function detectChapters(
  text: string,
  options: {
    chapterDetection: 'auto' | 'none' | 'regex';
    chapterPatterns: RegExp[];
  },
): ParsedChapter[] {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');

  if (options.chapterDetection === 'none') {
    return [
      {
        title: 'Start',
        lines: lines.filter((line) => line.trim().length > 0),
      },
    ];
  }

  const patterns = options.chapterDetection === 'auto'
    ? AUTO_TXT_CHAPTER_PATTERNS
    : options.chapterPatterns;

  const chapters: ParsedChapter[] = [];
  let currentChapter: ParsedChapter | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (isHeadingLike(line, patterns)) {
      if (currentChapter) {
        chapters.push(currentChapter);
      }
      currentChapter = {
        title: line,
        lines: [],
      };
      continue;
    }

    if (!currentChapter) {
      currentChapter = {
        title: createFallbackTitle(chapters.length),
        lines: [],
      };
    }

    currentChapter.lines.push(line);
  }

  if (currentChapter) {
    chapters.push(currentChapter);
  }

  const filtered = chapters
    .map((chapter, index) => ({
      title: normalizeChapterTitle(chapter.title) || createFallbackTitle(index),
      lines: chapter.lines.filter((line) => line.trim().length > 0),
    }))
    .filter((chapter) => chapter.lines.length > 0 || chapter.title.trim().length > 0);

  if (filtered.length === 0) {
    return [
      {
        title: 'Start',
        lines: normalized.split('\n').filter((line) => line.trim().length > 0),
      },
    ];
  }

  return filtered;
}
