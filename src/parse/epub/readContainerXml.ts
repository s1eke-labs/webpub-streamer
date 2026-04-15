import { InvalidPublicationError } from '../../core/errors.js';
import { xmlParser } from './xml.js';

export function readContainerXml(xml: string): string {
  const parsed = xmlParser.parse(xml);
  const fullPath = parsed?.container?.rootfiles?.rootfile?.['full-path'];

  if (!fullPath || typeof fullPath !== 'string') {
    throw new InvalidPublicationError('Unable to locate OPF rootfile in container.xml');
  }

  return fullPath;
}
