export class WebPubStreamerError extends Error {
  readonly code: string;

  constructor(message: string, code = 'WEBPUB_STREAMER_ERROR') {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}

export class UnsupportedTargetProfileError extends WebPubStreamerError {
  constructor(profile: string) {
    super(`Unsupported target profile: ${profile}`, 'UNSUPPORTED_TARGET_PROFILE');
  }
}

export class UnsupportedInputFormatError extends WebPubStreamerError {
  constructor(message: string) {
    super(message, 'UNSUPPORTED_INPUT_FORMAT');
  }
}

export class UnsupportedTextEncodingError extends WebPubStreamerError {
  constructor(encoding?: string) {
    super(
      encoding ? `Unsupported text encoding: ${encoding}` : 'Unsupported text encoding',
      'UNSUPPORTED_TEXT_ENCODING',
    );
  }
}

export class InvalidPublicationError extends WebPubStreamerError {
  constructor(message: string, code = 'INVALID_PUBLICATION') {
    super(message, code);
  }
}

export class PublicationNotFoundError extends WebPubStreamerError {
  constructor(publicationId: string) {
    super(`Publication not found: ${publicationId}`, 'PUBLICATION_NOT_FOUND');
  }
}

export class EncryptedPublicationError extends WebPubStreamerError {
  constructor() {
    super('Encrypted or DRM-protected EPUB files are not supported', 'ENCRYPTED_PUBLICATION');
  }
}

export class RemoteResourceError extends WebPubStreamerError {
  constructor(resource: string) {
    super(`Remote resources are not supported in Milestone 1: ${resource}`, 'REMOTE_RESOURCE');
  }
}

export class ServiceWorkerMountError extends WebPubStreamerError {
  constructor(message: string, code = 'SERVICE_WORKER_MOUNT_ERROR') {
    super(message, code);
  }
}

export class UnsupportedServiceWorkerTopologyError extends ServiceWorkerMountError {
  constructor(message: string) {
    super(message, 'UNSUPPORTED_SERVICE_WORKER_TOPOLOGY');
  }
}
