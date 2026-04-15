export interface ParsedChapter {
  title: string;
  lines: string[];
}

const CHINESE_CHAPTER_PATTERN = /^第[0-9一二三四五六七八九十百千零两]+[章回节卷部篇].*$/u;
const ENGLISH_CHAPTER_PATTERN = /^chapter\s+\d+.*$/iu;

function normalizeLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim();
}

function isHeadingLike(line: string, patterns: RegExp[]): boolean {
  const normalized = normalizeLine(line);
  if (!normalized) {
    return false;
  }

  return patterns.some((pattern) => pattern.test(normalized));
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
  const defaultPatterns = [CHINESE_CHAPTER_PATTERN, ENGLISH_CHAPTER_PATTERN];
  const patterns = options.chapterDetection === 'regex' && options.chapterPatterns.length > 0
    ? options.chapterPatterns
    : defaultPatterns;

  if (options.chapterDetection === 'none') {
    return [
      {
        title: 'Start',
        lines: lines.filter((line) => line.trim().length > 0),
      },
    ];
  }

  const chapters: ParsedChapter[] = [];
  let currentChapter: ParsedChapter | null = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (isHeadingLike(line, patterns)) {
      if (currentChapter) {
        chapters.push(currentChapter);
      }
      currentChapter = {
        title: normalizeLine(line),
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
    .map((chapter) => ({
      title: chapter.title || createFallbackTitle(chapters.indexOf(chapter)),
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
