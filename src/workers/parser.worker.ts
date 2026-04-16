import type { ParserRequestPayload, ParserResponse } from '../core/types.js';
import { processPublicationRequest } from '../core/processPublication.js';

interface ParserWorkerRequest {
  id: string;
  payload: Omit<ParserRequestPayload, 'sourceBytes'> & {
    sourceBytes: ArrayBuffer;
  };
}

declare const self: DedicatedWorkerGlobalScope;

self.addEventListener('message', async (event: MessageEvent<ParserWorkerRequest>) => {
  const { id, payload } = event.data;
  let response: ParserResponse;

  try {
    const publication = await processPublicationRequest({
      ...payload,
      sourceBytes: new Uint8Array(payload.sourceBytes),
    });
    response = {
      ok: true,
      publication,
    };
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error));
    response = {
      ok: false,
      error: {
        name: normalizedError.name,
        message: normalizedError.message,
        stack: normalizedError.stack,
      },
    };
  }

  self.postMessage({
    id,
    response,
  });
});
