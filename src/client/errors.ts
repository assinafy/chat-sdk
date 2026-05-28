/**
 * Error types raised by the Assinafy client and chat layers.
 *
 * Callers should rely on `instanceof` rather than inspecting message strings —
 * the messages are for humans and may change.
 */

/** Base class for every error thrown by this SDK. */
export class AssinafyError extends Error {
  override readonly name: string = "AssinafyError";
}

/** Thrown when the SDK is misconfigured (e.g. missing API key). */
export class ConfigurationError extends AssinafyError {
  override readonly name = "ConfigurationError";
}

/** Thrown when an HTTP request returns a non-2xx status. */
export class ApiError extends AssinafyError {
  override readonly name = "ApiError";
  /** HTTP status code returned by the API. */
  readonly status: number;
  /** The unwrapped response body, if any. */
  readonly body: unknown;
  /** The path that was requested. */
  readonly path: string;
  /** The HTTP method used. */
  readonly method: string;

  constructor(args: { status: number; body: unknown; path: string; method: string; message?: string }) {
    super(args.message ?? `Assinafy API ${args.method} ${args.path} failed with status ${args.status}`);
    this.status = args.status;
    this.body = args.body;
    this.path = args.path;
    this.method = args.method;
  }
}

/** Thrown when an operation isn't supported by the active adapter. */
export class NotImplementedError extends AssinafyError {
  override readonly name = "NotImplementedError";
  readonly adapter: string;
  readonly operation: string;

  constructor(adapter: string, operation: string, reason?: string) {
    super(
      reason
        ? `Adapter "${adapter}" does not implement "${operation}": ${reason}`
        : `Adapter "${adapter}" does not implement "${operation}"`,
    );
    this.adapter = adapter;
    this.operation = operation;
  }
}

/** Thrown when a webhook signature can't be verified. */
export class WebhookSignatureError extends AssinafyError {
  override readonly name = "WebhookSignatureError";
}
