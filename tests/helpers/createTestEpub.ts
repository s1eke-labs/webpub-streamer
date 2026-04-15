import { zipSync } from 'fflate';

const encoder = new TextEncoder();

function pngPixel(): Uint8Array {
  return Uint8Array.from(Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9sTgF4kAAAAASUVORK5CYII=',
    'base64',
  ));
}

export interface CreateTestEpubOptions {
  title?: string;
  includeScript?: boolean;
  includeRemoteResource?: boolean;
  includeObfuscatedFont?: boolean;
}

export function createTestEpub(options: CreateTestEpubOptions = {}): Uint8Array {
  const title = options.title ?? 'Fixture EPUB';
  const remoteImage = options.includeRemoteResource ? '<img src="https://example.com/remote.jpg" alt="remote" />' : '';
  const inlineScript = options.includeScript ? '<script>alert("xss")</script>' : '';
  const fontManifest = options.includeObfuscatedFont
    ? '<item id="font" href="fonts/book.woff2" media-type="font/woff2" />'
    : '';
  const fontStyle = options.includeObfuscatedFont
    ? '@font-face { font-family: "Fixture"; src: url("../fonts/book.woff2"); }'
    : '';
  const encryptionXml = options.includeObfuscatedFont
    ? `<?xml version="1.0" encoding="UTF-8"?>
<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <EncryptedData xmlns="http://www.w3.org/2001/04/xmlenc#">
    <EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding" />
    <CipherData>
      <CipherReference URI="OPS/fonts/book.woff2" />
    </CipherData>
  </EncryptedData>
</encryption>`
    : undefined;

  const files: Record<string, Uint8Array> = {
    mimetype: encoder.encode('application/epub+zip'),
    'META-INF/container.xml': encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml" />
  </rootfiles>
</container>`),
    'OPS/package.opf': encoder.encode(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="bookid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:fixture-book</dc:identifier>
    <dc:title>${title}</dc:title>
    <dc:language>en</dc:language>
    <dc:creator>Fixture Author</dc:creator>
    <meta name="cover" content="cover-image" />
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav" />
    <item id="chapter1" href="chapter-1.xhtml" media-type="application/xhtml+xml" />
    <item id="chapter2" href="chapter-2.xhtml" media-type="application/xhtml+xml" />
    <item id="style" href="styles/book.css" media-type="text/css" />
    <item id="cover-image" href="images/cover.png" media-type="image/png" properties="cover-image" />
    ${fontManifest}
  </manifest>
  <spine>
    <itemref idref="chapter1" />
    <itemref idref="chapter2" />
  </spine>
</package>`),
    'OPS/nav.xhtml': encoder.encode(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <head><title>Contents</title></head>
  <body>
    <nav epub:type="toc">
      <ol>
        <li><a href="chapter-1.xhtml">Start</a></li>
        <li><a href="chapter-2.xhtml#section-two">Second</a></li>
      </ol>
    </nav>
  </body>
</html>`),
    'OPS/chapter-1.xhtml': encoder.encode(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>Start</title>
    <link rel="stylesheet" href="styles/book.css" />
  </head>
  <body>
    <section id="chapter-one">
      <h1>Start</h1>
      <p onclick="alert('bad')">Hello fixture world.</p>
      <img src="images/cover.png" alt="cover" />
      <a href="chapter-2.xhtml#section-two">Next chapter</a>
      ${remoteImage}
      ${inlineScript}
    </section>
  </body>
</html>`),
    'OPS/chapter-2.xhtml': encoder.encode(`<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head>
    <title>Second</title>
    <link rel="stylesheet" href="styles/book.css" />
  </head>
  <body>
    <section id="section-two">
      <h1>Second</h1>
      <p>Another paragraph in chapter two.</p>
    </section>
  </body>
</html>`),
    'OPS/styles/book.css': encoder.encode(`body { color: #222; background-image: url("../images/cover.png"); } ${fontStyle}`),
    'OPS/images/cover.png': pngPixel(),
  };

  if (options.includeObfuscatedFont) {
    files['OPS/fonts/book.woff2'] = Uint8Array.from([0x77, 0x4f, 0x46, 0x32]);
  }

  if (encryptionXml) {
    files['META-INF/encryption.xml'] = encoder.encode(encryptionXml);
  }

  return zipSync(files, {
    level: 0,
  });
}
