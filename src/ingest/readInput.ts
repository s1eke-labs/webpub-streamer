import { UnsupportedInputFormatError } from '../core/errors.js';
import type {
  InputFormat,
  InputSource,
} from '../core/types.js';
import { detectFormatFromNameAndType } from './detectFormat.js';

export interface ResolvedInput {
  bytes: Uint8Array;
  fileName: string;
  mediaType?: string;
  format: Exclude<InputFormat, 'auto'>;
}

function isTypedSource(
  input: InputSource,
): input is {
  name: string;
  mediaType?: string;
  data: ArrayBuffer | Uint8Array;
} {
  return typeof input === 'object' && input !== null && 'data' in input && 'name' in input;
}

function toUint8Array(data: ArrayBuffer | Uint8Array): Uint8Array {
  if (data instanceof Uint8Array) {
    return data;
  }

  return new Uint8Array(data);
}

async function readBlobLike(input: Blob | File): Promise<Uint8Array> {
  return new Uint8Array(await input.arrayBuffer());
}

export async function readInputSource(
  input: InputSource,
  requestedFormat: InputFormat,
): Promise<ResolvedInput> {
  let bytes: Uint8Array;
  let fileName = 'publication';
  let mediaType: string | undefined;

  if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else if (isTypedSource(input)) {
    bytes = toUint8Array(input.data);
    fileName = input.name;
    mediaType = input.mediaType;
  } else if (input instanceof Blob) {
    bytes = await readBlobLike(input);
    fileName = input instanceof File ? input.name : fileName;
    mediaType = input.type || undefined;
  } else {
    throw new UnsupportedInputFormatError('Unsupported input source');
  }

  const detectedFormat = requestedFormat === 'auto'
    ? detectFormatFromNameAndType(fileName, mediaType)
    : requestedFormat;

  if (!detectedFormat) {
    throw new UnsupportedInputFormatError(
      `Unable to detect a supported format for "${fileName}"`,
    );
  }

  return {
    bytes,
    fileName,
    mediaType,
    format: detectedFormat,
  };
}
