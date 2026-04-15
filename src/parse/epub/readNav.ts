import { DOMParser, type Element as XmlElement, type Node as XmlNode } from '@xmldom/xmldom';

import type { TocItem } from '../../core/types.js';

function textContent(node: XmlNode | null): string {
  return node?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
}

function isNamedElement(node: XmlNode, tagName: string): node is XmlElement {
  return node.nodeType === node.ELEMENT_NODE
    && (node as XmlElement).tagName.toLowerCase() === tagName;
}

function firstElementChildByTagName(parent: XmlElement, tagName: string): XmlElement | null {
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const child = parent.childNodes[index];
    if (isNamedElement(child, tagName)) {
      return child;
    }
  }

  return null;
}

function getDirectChildren(parent: XmlElement, tagName: string): XmlElement[] {
  const items: XmlElement[] = [];
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const child = parent.childNodes[index];
    if (isNamedElement(child, tagName)) {
      items.push(child);
    }
  }
  return items;
}

function parseList(list: XmlElement): TocItem[] {
  const items: TocItem[] = [];

  for (const item of getDirectChildren(list, 'li')) {
    const anchor = firstElementChildByTagName(item, 'a') ?? firstElementChildByTagName(item, 'span');
    if (!anchor) {
      continue;
    }

    const nestedList = firstElementChildByTagName(item, 'ol');
    const children = nestedList ? parseList(nestedList) : undefined;
    const title = textContent(anchor);
    if (!title) {
      continue;
    }

    items.push({
      href: anchor.getAttribute('href') ?? '',
      title,
      children: children && children.length > 0 ? children : undefined,
    });
  }

  return items;
}

export function readNav(navXhtml: string): TocItem[] {
  const document = new DOMParser().parseFromString(navXhtml, 'application/xhtml+xml');
  const navElements = Array.from(document.getElementsByTagName('nav'));
  const tocNav = navElements.find((element) => {
    const epubType = element.getAttribute('epub:type') ?? element.getAttribute('type') ?? '';
    return epubType.split(/\s+/).includes('toc');
  });

  if (!tocNav) {
    return [];
  }

  const list = firstElementChildByTagName(tocNav, 'ol');
  if (!list) {
    return [];
  }

  return parseList(list);
}
