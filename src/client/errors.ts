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

/** Constructor arguments shared by {@link ApiError} and its subclasses. */
export interface ApiErrorArgs {
  status: number;
  body: unknown;
  path: string;
  method: string;
  message?: string;
  /** Raw `WWW-Authenticate` challenge, when the response carried one. */
  wwwAuthenticate?: string;
}

/** Thrown when an HTTP request returns a non-2xx status. */
export class ApiError extends AssinafyError {
  override readonly name: string = "ApiError";
  /** HTTP status code returned by the API. */
  readonly status: number;
  /**
   * The parsed error response body. For Assinafy errors this is the full
   * `{ status, message, data }` envelope (with `data: null`); for non-JSON
   * responses it is the raw text. OAuth endpoints answer with a flat
   * `{ error, error_description }` object instead — see {@link OAuthError}.
   */
  readonly body: unknown;
  /** The path that was requested. */
  readonly path: string;
  /** The HTTP method used. */
  readonly method: string;
  /**
   * The response's `WWW-Authenticate` challenge, when present. A `403` from an
   * OAuth-authenticated call carries the permission the token is missing here.
   */
  readonly wwwAuthenticate?: string;

  constructor(args: ApiErrorArgs) {
    super(args.message ?? `Assinafy API ${args.method} ${args.path} failed with status ${args.status}`);
    this.status = args.status;
    this.body = args.body;
    this.path = args.path;
    this.method = args.method;
    this.wwwAuthenticate = args.wwwAuthenticate;
  }
}

/**
 * An {@link ApiError} whose response carried an RFC 6749 error code, either in
 * the body (`{ error, error_description }`, how the OAuth endpoints report
 * failure) or in a `WWW-Authenticate: Bearer error="…"` challenge (how any
 * endpoint reports an expired token or a missing permission).
 *
 * It extends {@link ApiError}, so existing `instanceof ApiError` handling keeps
 * working; catch this type only when you want to branch on {@link error}.
 *
 * The codes worth branching on:
 *
 * | `error` | Meaning | What to do |
 * | --- | --- | --- |
 * | `invalid_grant` | Code expired (60s), replayed, or a retired refresh token | Send the user through the authorization flow again |
 * | `invalid_client` | Unknown `client_id`, wrong secret, or a disabled application | Fix the credentials |
 * | `invalid_target` | `resource` disagrees with the authorized value | Match the value sent to `/authorize` |
 * | `insufficient_scope` | The token lacks a permission — {@link scope} names it | Reconnect asking for that scope |
 *
 * An expired or revoked access token answers `401` with a bare
 * `WWW-Authenticate: Bearer` challenge carrying no `error` parameter, so it
 * stays an ordinary {@link ApiError}: branch on `status === 401` there.
 */
export class OAuthError extends ApiError {
  override readonly name = "OAuthError";
  /** RFC 6749 error code, e.g. `invalid_grant` or `insufficient_scope`. */
  readonly error: string;
  /** Human-readable detail from the server. Never shown to end users verbatim. */
  readonly errorDescription?: string;
  /** Permission named by an `insufficient_scope` challenge, when present. */
  readonly scope?: string;

  constructor(args: ApiErrorArgs & { error: string; errorDescription?: string; scope?: string }) {
    super(args);
    this.error = args.error;
    this.errorDescription = args.errorDescription;
    this.scope = args.scope;
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
