import { DOMParser, XMLSerializer, type Element as XmlElement } from '@xmldom/xmldom';
import * as cssTree from 'css-tree';

import { RemoteResourceError } from '../../core/errors.js';
import { relativePath, resolveRelativePath } from '../../core/path-utils.js';

const RESOURCE_ATTRIBUTES = new Set(['src', 'href', 'poster', 'xlink:href']);
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink';

function isAbsoluteRemoteUrl(value: string): boolean {
  return /^(https?:)?\/\//i.test(value) || /^[a-z][a-z0-9+.-]*:/i.test(value);
}

function isJavascriptUrl(value: string): boolean {
  return /^javascript:/i.test(value.trim());
}

function isDataUrl(value: string): boolean {
  return /^data:/i.test(value.trim());
}

function shouldAllowExternalAnchor(element: XmlElement, attributeName: string): boolean {
  return attributeName === 'href' && element.tagName.toLowerCase() === 'a';
}

function rewriteUrl(
  rawValue: string,
  currentOriginalPath: string,
  currentRuntimePath: string,
  pathMapping: Map<string, string>,
  allowExternalAnchor: boolean,
): string | null {
  if (!rawValue || rawValue.startsWith('#')) {
    return rawValue;
  }

  if (isJavascriptUrl(rawValue)) {
    return null;
  }

  if (isAbsoluteRemoteUrl(rawValue) || isDataUrl(rawValue)) {
    if (allowExternalAnchor) {
      return rawValue;
    }

    throw new RemoteResourceError(rawValue);
  }

  const hashIndex = rawValue.indexOf('#');
  const anchor = hashIndex === -1 ? '' : rawValue.slice(hashIndex);
  const reference = hashIndex === -1 ? rawValue : rawValue.slice(0, hashIndex);
  const resolvedOriginalPath = resolveRelativePath(currentOriginalPath, reference);
  const mappedPath = pathMapping.get(resolvedOriginalPath);
  if (!mappedPath) {
    return null;
  }

  const nextPath = relativePath(currentRuntimePath, mappedPath);
  return anchor ? `${nextPath}${anchor}` : nextPath;
}

export function sanitizeCss(params: {
  cssText: string;
  currentOriginalPath: string;
  currentRuntimePath: string;
  pathMapping: Map<string, string>;
}): string {
  const ast = cssTree.parse(params.cssText, {
    parseAtrulePrelude: true,
    parseRulePrelude: true,
  });

  cssTree.walk(ast, {
    visit: 'Url',
    enter(node: any) {
      const value = cssTree
        .generate(node)
        .replace(/^url\(/i, '')
        .replace(/\)$/i, '')
        .replace(/^['"]|['"]$/g, '');
      const rewritten = rewriteUrl(
        value,
        params.currentOriginalPath,
        params.currentRuntimePath,
        params.pathMapping,
        false,
      );

      const mutableNode = node as {
        value: {
          type: string;
          value: string;
        };
      };

      if (!rewritten) {
        mutableNode.value = {
          type: 'Raw',
          value: '""',
        };
        return;
      }

      mutableNode.value = {
        type: 'Raw',
        value: JSON.stringify(rewritten),
      };
    },
  });

  return cssTree.generate(ast);
}

function sanitizeElement(
  element: XmlElement,
  currentOriginalPath: string,
  currentRuntimePath: string,
  pathMapping: Map<string, string>,
): void {
  if (element.tagName.toLowerCase() === 'script') {
    element.parentNode?.removeChild(element);
    return;
  }

  const attributeNames = Array.from(element.attributes).map((attribute) => attribute.name);
  for (const attributeName of attributeNames) {
    if (attributeName.toLowerCase().startsWith('on')) {
      element.removeAttribute(attributeName);
      continue;
    }

    if (!RESOURCE_ATTRIBUTES.has(attributeName)) {
      continue;
    }

    const currentValue = element.getAttribute(attributeName);
    if (!currentValue) {
      continue;
    }

    const rewritten = rewriteUrl(
      currentValue,
      currentOriginalPath,
      currentRuntimePath,
      pathMapping,
      shouldAllowExternalAnchor(element, attributeName),
    );

    if (rewritten) {
      element.setAttribute(attributeName, rewritten);
      if (attributeName === 'href' && element.tagName.toLowerCase() === 'a' && isAbsoluteRemoteUrl(rewritten)) {
        element.setAttribute('rel', 'noopener noreferrer');
        element.setAttribute('target', '_blank');
      }
      continue;
    }

    element.removeAttribute(attributeName);
  }

  const xlinkHref = element.getAttributeNS(XLINK_NAMESPACE, 'href');
  if (xlinkHref) {
    const rewritten = rewriteUrl(
      xlinkHref,
      currentOriginalPath,
      currentRuntimePath,
      pathMapping,
      false,
    );
    if (rewritten) {
      element.setAttributeNS(XLINK_NAMESPACE, 'xlink:href', rewritten);
    } else {
      element.removeAttributeNS(XLINK_NAMESPACE, 'href');
    }
  }

  for (let index = element.childNodes.length - 1; index >= 0; index -= 1) {
    const child = element.childNodes[index];
    if (child.nodeType === child.ELEMENT_NODE) {
      sanitizeElement(child as XmlElement, currentOriginalPath, currentRuntimePath, pathMapping);
    }
  }
}

export function sanitizeXhtml(params: {
  xhtml: string;
  currentOriginalPath: string;
  currentRuntimePath: string;
  pathMapping: Map<string, string>;
}): {
    xhtml: string;
    textContent: string;
  } {
  const document = new DOMParser().parseFromString(params.xhtml, 'application/xhtml+xml');
  const root = document.documentElement;
  if (!root) {
    throw new Error('Unable to parse XHTML root element');
  }
  sanitizeElement(root, params.currentOriginalPath, params.currentRuntimePath, params.pathMapping);

  const textContent = root.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  const xhtml = new XMLSerializer().serializeToString(document);

  return {
    xhtml,
    textContent,
  };
}
