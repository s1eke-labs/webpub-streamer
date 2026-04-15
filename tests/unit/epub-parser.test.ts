import { describe, expect, it } from 'vitest';

import { parseEpub } from '../../src/parse/epub/parseEpub.js';
import { readContainerXml } from '../../src/parse/epub/readContainerXml.js';
import { readNav } from '../../src/parse/epub/readNav.js';
import { readOpf } from '../../src/parse/epub/readOpf.js';
import { createTestEpub } from '../helpers/createTestEpub.js';

describe('EPUB parsing', () => {
  it('reads container xml', () => {
    expect(readContainerXml(`<?xml version="1.0"?>
<container>
  <rootfiles>
    <rootfile full-path="OPS/package.opf" />
  </rootfiles>
</container>`)).toBe('OPS/package.opf');
  });

  it('reads nav toc entries', () => {
    const toc = readNav(`<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc">
      <ol>
        <li><a href="chapter.xhtml">Hello</a></li>
      </ol>
    </nav>
  </body>
</html>`);
    expect(toc).toEqual([{ href: 'chapter.xhtml', title: 'Hello', children: undefined }]);
  });

  it('reads OPF metadata', () => {
    const opf = readOpf(`<?xml version="1.0"?>
<package>
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Hello</dc:title>
    <dc:language>en</dc:language>
    <dc:identifier>id-1</dc:identifier>
  </metadata>
  <manifest>
    <item id="a" href="chapter.xhtml" media-type="application/xhtml+xml" />
  </manifest>
  <spine>
    <itemref idref="a" />
  </spine>
</package>`);

    expect(opf.metadata.title).toBe('Hello');
    expect(opf.manifest[0]?.href).toBe('chapter.xhtml');
  });

  it('sanitizes and materializes a valid EPUB', async () => {
    const graph = await parseEpub(createTestEpub({
      includeScript: true,
      includeObfuscatedFont: true,
    }), {
      format: 'epub',
      targetProfile: 'epub',
      cachePolicy: 'reuse',
      validate: false,
      txt: {
        chapterDetection: 'auto',
        chapterPatterns: [],
        language: undefined,
        title: undefined,
        encoding: undefined,
      },
      epub: {
        allowRemoteResources: 'reject',
        javascriptPolicy: 'strip',
        unsupportedFontPolicy: 'warn-and-drop',
      },
    });

    expect(graph.readingOrder).toHaveLength(2);
    expect(graph.resources.some((item) => item.path === 'styles/book.css')).toBe(true);
    expect(graph.cover?.path).toContain('assets/');

    const firstChapter = new TextDecoder().decode(graph.readingOrder[0]!.content);
    expect(firstChapter).not.toContain('<script');
    expect(firstChapter).not.toContain('onclick=');
    expect(firstChapter).toContain('../styles/book.css');
    expect(graph.warnings.some((item) => item.code === 'OBFUSCATED_FONT_DROPPED')).toBe(true);
  });

  it('rejects remote resources', async () => {
    await expect(parseEpub(createTestEpub({
      includeRemoteResource: true,
    }), {
      format: 'epub',
      targetProfile: 'epub',
      cachePolicy: 'reuse',
      validate: false,
      txt: {
        chapterDetection: 'auto',
        chapterPatterns: [],
        language: undefined,
        title: undefined,
        encoding: undefined,
      },
      epub: {
        allowRemoteResources: 'reject',
        javascriptPolicy: 'strip',
        unsupportedFontPolicy: 'warn-and-drop',
      },
    })).rejects.toThrow(/Remote resources/);
  });
});
