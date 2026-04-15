import { XMLParser } from 'fast-xml-parser';

export const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  allowBooleanAttributes: true,
  removeNSPrefix: false,
  trimValues: true,
});

export function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

export function textValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  if (value && typeof value === 'object' && '#text' in value) {
    return textValue((value as Record<string, unknown>)['#text']);
  }

  return undefined;
}
