import { sanitizePathSegment } from '../../core/path-utils.js';

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function paragraphize(lines: string[]): string {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `      <p>${escapeHtml(line)}</p>`)
    .join('\n');
}

export const DEFAULT_TXT_STYLESHEET = `:root {
  color-scheme: light;
}

html,
body {
  margin: 0;
  padding: 0;
}

body {
  font-family: serif;
  line-height: 1.7;
  padding: 0 1rem 2rem;
}

section {
  margin: 0 auto;
  max-width: 42rem;
}

h1 {
  font-size: 1.5rem;
  margin: 2rem 0 1rem;
}

p {
  margin: 0 0 1rem;
  text-indent: 2em;
}
`;

export function materializeTxtChapterXhtml(params: {
  title: string;
  language: string;
  bodyLines: string[];
}): string {
  const title = escapeHtml(params.title);
  const paragraphs = paragraphize(params.bodyLines);

  return `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${escapeHtml(params.language)}">
  <head>
    <title>${title}</title>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="../styles/text.css" />
  </head>
  <body>
    <section epub:type="bodymatter chapter">
      <h1>${title}</h1>
${paragraphs}
    </section>
  </body>
</html>
`;
}

export function createTxtChapterPath(index: number, title: string): string {
  const suffix = String(index + 1).padStart(3, '0');
  const slug = sanitizePathSegment(title);
  return `spine/chapter-${suffix}-${slug}.xhtml`;
}
