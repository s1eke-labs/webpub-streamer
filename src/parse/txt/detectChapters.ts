import type {
  TxtChapterDiagnostic,
  TxtChapterDiagnosticSource,
} from '../../core/types.js';
import { BUILTIN_TXT_CHAPTER_RULES } from './chapterRules.js';

export interface ParsedChapter {
  title: string;
  lines: string[];
}

interface ParsedChapterInternal extends ParsedChapter {
  lineNumber: number;
  ruleName?: string;
  source: TxtChapterDiagnosticSource;
}

interface ChapterRuleMatch {
  name: string;
  pattern: RegExp;
  source: TxtChapterDiagnosticSource;
}

export interface DetectChaptersResult {
  chapters: ParsedChapter[];
  diagnostics: TxtChapterDiagnostic[];
}

function normalizeChapterTitle(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function isBlankLine(line: string | undefined): boolean {
  return !line || line.trim().length === 0;
}

function findMatch(line: string, rules: ChapterRuleMatch[]): ChapterRuleMatch | null {
  if (!line.trim()) {
    return null;
  }

  for (const rule of rules) {
    if (rule.pattern.test(line)) {
      return rule;
    }
  }

  return null;
}

function createFallbackTitle(index: number): string {
  return index === 0 ? 'Start' : `Chapter ${index + 1}`;
}

function createFallbackChapter(index: number, lineNumber: number): ParsedChapterInternal {
  return {
    title: createFallbackTitle(index),
    lines: [],
    lineNumber,
    source: 'fallback',
  };
}

function hasAutoHeadingContext(lines: string[], index: number): boolean {
  if (index === 0 || index === lines.length - 1) {
    return true;
  }

  return isBlankLine(lines[index - 1]) || isBlankLine(lines[index + 1]);
}

function normalizeChapters(
  chapters: ParsedChapterInternal[],
  normalized: string,
): DetectChaptersResult {
  const filtered = chapters
    .map((chapter, index) => ({
      ...chapter,
      title: normalizeChapterTitle(chapter.title)
        || createFallbackTitle(index),
      lines: chapter.lines.filter((line) => line.trim().length > 0),
    }))
    .filter((chapter) => chapter.lines.length > 0 || chapter.title.trim().length > 0);

  if (filtered.length === 0) {
    const fallback = {
      title: 'Start',
      lines: normalized.split('\n').filter((line) => line.trim().length > 0),
      lineNumber: 1,
      source: 'fallback' as const,
    };

    return {
      chapters: [{
        title: fallback.title,
        lines: fallback.lines,
      }],
      diagnostics: [{
        title: fallback.title,
        lineNumber: fallback.lineNumber,
        source: fallback.source,
      }],
    };
  }

  return {
    chapters: filtered.map((chapter) => ({
      title: chapter.title,
      lines: chapter.lines,
    })),
    diagnostics: filtered.map((chapter) => ({
      title: chapter.title,
      lineNumber: chapter.lineNumber,
      ruleName: chapter.ruleName,
      source: chapter.source,
    })),
  };
}

export function detectChaptersWithDiagnostics(
  text: string,
  options: {
    chapterDetection: 'auto' | 'none' | 'regex';
    chapterPatterns: RegExp[];
  },
): DetectChaptersResult {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const firstContentLine = Math.max(1, lines.findIndex((line) => line.trim().length > 0) + 1);

  if (options.chapterDetection === 'none') {
    return {
      chapters: [{
        title: 'Start',
        lines: lines.filter((line) => line.trim().length > 0),
      }],
      diagnostics: [{
        title: 'Start',
        lineNumber: firstContentLine,
        source: 'fallback',
      }],
    };
  }

  const rules: ChapterRuleMatch[] = options.chapterDetection === 'auto'
    ? BUILTIN_TXT_CHAPTER_RULES
      .filter((rule) => rule.enable)
      .map((rule) => ({
        name: rule.name,
        pattern: rule.pattern,
        source: 'builtin' as const,
      }))
    : options.chapterPatterns.map((pattern, index) => ({
      name: `custom:${index + 1}`,
      pattern,
      source: 'custom' as const,
    }));

  const chapters: ParsedChapterInternal[] = [];
  let currentChapter: ParsedChapterInternal | null = null;

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trimEnd();
    const matchedRule = findMatch(line, rules);
    const acceptsMatch = matchedRule
      && (options.chapterDetection !== 'auto' || hasAutoHeadingContext(lines, index));
    if (acceptsMatch) {
      if (currentChapter) {
        chapters.push(currentChapter);
      }

      currentChapter = {
        title: line,
        lines: [],
        lineNumber: index + 1,
        ruleName: matchedRule.name,
        source: matchedRule.source,
      };
      continue;
    }

    if (!currentChapter) {
      currentChapter = createFallbackChapter(chapters.length, firstContentLine);
    }

    currentChapter.lines.push(line);
  }

  if (currentChapter) {
    chapters.push(currentChapter);
  }

  return normalizeChapters(chapters, normalized);
}

export function detectChapters(
  text: string,
  options: {
    chapterDetection: 'auto' | 'none' | 'regex';
    chapterPatterns: RegExp[];
  },
): ParsedChapter[] {
  return detectChaptersWithDiagnostics(text, options).chapters;
}
