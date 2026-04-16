import type {
  CanonicalPublicationGraph,
  OpenPublicationOptions,
} from '../../core/types.js';
import { detectChaptersWithDiagnostics } from './detectChapters.js';
import { decodeText } from './detectEncoding.js';
import {
  createTxtChapterPath,
  DEFAULT_TXT_STYLESHEET,
  materializeTxtChapterXhtml,
} from './materializeTxtXhtml.js';

const encoder = new TextEncoder();

function normalizeDocumentText(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  let start = 0;
  let end = lines.length - 1;

  while (start <= end && lines[start]?.trim().length === 0) {
    start += 1;
  }

  while (end >= start && lines[end]?.trim().length === 0) {
    end -= 1;
  }

  return start > end ? '' : lines.slice(start, end + 1).join('\n');
}

function inferTitle(fileName: string, explicitTitle?: string): string {
  if (explicitTitle?.trim()) {
    return explicitTitle.trim();
  }

  return fileName.replace(/\.[^.]+$/, '') || 'Untitled Text';
}

export async function parseTxt(
  sourceBytes: Uint8Array,
  sourceName: string,
  options: Required<OpenPublicationOptions>,
): Promise<CanonicalPublicationGraph> {
  const decoded = decodeText(sourceBytes, options.txt.encoding);
  const normalizedText = normalizeDocumentText(decoded.content);
  const title = inferTitle(sourceName, options.txt.title);
  const language = options.txt.language ?? 'en';

  const {
    chapters,
    diagnostics,
  } = detectChaptersWithDiagnostics(normalizedText, {
    chapterDetection: options.txt.chapterDetection ?? 'auto',
    chapterPatterns: options.txt.chapterPatterns ?? [],
  });

  const resources = [
    {
      id: 'text-style',
      path: 'styles/text.css',
      href: 'styles/text.css',
      mediaType: 'text/css',
      content: encoder.encode(DEFAULT_TXT_STYLESHEET),
      textContent: DEFAULT_TXT_STYLESHEET,
    },
  ];

  const readingOrder = chapters.map((chapter, index) => {
    const path = createTxtChapterPath(index, chapter.title);
    const xhtml = materializeTxtChapterXhtml({
      title: chapter.title,
      language,
      bodyLines: chapter.lines,
    });
    return {
      id: `chapter-${index + 1}`,
      path,
      href: path,
      mediaType: 'application/xhtml+xml',
      content: encoder.encode(xhtml),
      textContent: chapter.lines.join('\n'),
      title: chapter.title,
    };
  });

  return {
    metadata: {
      title,
      language,
    },
    readingOrder,
    resources,
    toc: readingOrder.map((item) => ({
      href: item.href,
      title: item.title,
    })),
    txtChapterDiagnostics: diagnostics,
    warnings: [
      {
        code: 'TXT_ENCODING_DETECTED',
        message: `Decoded text as ${decoded.encoding}`,
      },
    ],
  };
}
