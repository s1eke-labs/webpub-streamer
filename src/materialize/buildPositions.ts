import {
  DEFAULT_CHARACTERS_PER_POSITION,
} from '../core/constants.js';
import type {
  CanonicalSpineItem,
  PositionsList,
} from '../core/types.js';

function splitIntoGraphemeChunks(text: string, size: number): string[] {
  if (!text) {
    return [];
  }

  if ('Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: 'grapheme',
    });
    const segments = Array.from(segmenter.segment(text), (item) => item.segment);
    const chunks: string[] = [];
    for (let index = 0; index < segments.length; index += size) {
      chunks.push(segments.slice(index, index + size).join(''));
    }
    return chunks;
  }

  const codePoints = Array.from(text);
  const chunks: string[] = [];
  for (let index = 0; index < codePoints.length; index += size) {
    chunks.push(codePoints.slice(index, index + size).join(''));
  }
  return chunks;
}

function graphemeLength(text: string): number {
  return Array.from(text).length;
}

export function buildPositions(
  readingOrder: CanonicalSpineItem[],
  charactersPerPosition = DEFAULT_CHARACTERS_PER_POSITION,
): PositionsList {
  const totalLength = readingOrder.reduce((sum, item) => sum + Math.max(graphemeLength(item.textContent ?? ''), 1), 0);
  const positions: PositionsList['positions'] = [];
  let globalPosition = 1;
  let consumedLength = 0;

  for (const item of readingOrder) {
    const text = item.textContent ?? '';
    const chunks = splitIntoGraphemeChunks(text, charactersPerPosition);
    const effectiveChunks = chunks.length > 0 ? chunks : [''];
    const itemLength = Math.max(graphemeLength(text), 1);
    let itemConsumed = 0;

    for (const chunk of effectiveChunks) {
      const chunkLength = Math.max(graphemeLength(chunk), 1);
      positions.push({
        href: item.href,
        type: item.mediaType,
        title: item.title,
        locations: {
          position: globalPosition,
          progression: itemConsumed / itemLength,
          totalProgression: consumedLength / totalLength,
        },
      });

      globalPosition += 1;
      itemConsumed += chunkLength;
      consumedLength += chunkLength;
    }
  }

  return {
    total: positions.length,
    positions,
  };
}
