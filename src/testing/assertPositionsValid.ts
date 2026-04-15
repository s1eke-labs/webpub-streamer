import type { PositionsList } from '../core/types.js';

export function assertPositionsValid(positions: unknown): asserts positions is PositionsList {
  const typed = positions as PositionsList;
  if (!typed || typeof typed !== 'object') {
    throw new Error('Positions must be an object');
  }

  if (!Array.isArray(typed.positions)) {
    throw new Error('Positions list must include an array of positions');
  }

  if (typeof typed.total !== 'number' || typed.total < typed.positions.length) {
    throw new Error('Positions total must be >= positions.length');
  }

  let previousPosition = 0;
  for (const locator of typed.positions) {
    if (locator.locations.position <= previousPosition) {
      throw new Error('Positions must be strictly increasing');
    }
    previousPosition = locator.locations.position;

    if (locator.locations.progression < 0 || locator.locations.progression > 1) {
      throw new Error('Locator progression must be between 0 and 1');
    }

    if (locator.locations.totalProgression < 0 || locator.locations.totalProgression > 1) {
      throw new Error('Locator totalProgression must be between 0 and 1');
    }
  }
}
