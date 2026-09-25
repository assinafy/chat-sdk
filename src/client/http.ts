/**
 * Low-level HTTP transport for the Assinafy API.
 *
 * Responsibilities:
 *  - Build URLs and apply auth headers.
 *  - Unwrap the `{ status, message, data }` envelope.
 *  - Surface pagination + rate-limit metadata from response headers.
 *  - Map non-2xx responses to typed {@link ApiError} instances.
 *  - Retry safe, idempotent reads after transient failures (429 + 5xx).
 *
 * This module is intentionally framework-agnostic and uses the global `fetch`
 * available in Node 24+, Bun, Deno, and modern browsers.
 */

import { ApiError, ConfigurationError, OAuthError } from "./errors.js";
import type { ApiEnvelope, Page, Pagination, RateLimit } from "./types.js";

/** Authentication strategies supported by the Assinafy API. */
export type AuthStrategy =
  | { kind: "apiKey"; apiKey: string }
  | { kind: "bearer"; token: string }
  | { kind: "none" };

/** Constructor options for {@link HttpClient}. */
export interface HttpClientOptions {
  /** Base URL including version, e.g. `https://sandbox.assinafy.com.br/v1`. */
  baseUrl: string;
  /** How requests should authenticate. */
  auth: AuthStrategy;
  /**
   * Optional custom fetch implementation. Defaults to the global `fetch`.
   * Useful for testing or for environments that need a polyfill.
   */
  fetch?: typeof fetch;
  /**
   * Number of times to retry safe reads after transient failures (HTTP 408,
   * 425, 429, 500, 502, 503, 504, plus network errors). Mutating requests are
   * never retried because the API has no idempotency-key contract. Defaults to
   * 2 (so up to 3 total attempts).
   */
  maxRetries?: number;
  /**
   * Base delay in milliseconds for retry backoff. The actual delay grows
   * exponentially: `baseDelayMs * 2 ** attempt`, capped at 10s. A server
   * `Retry-After` value takes precedence. Defaults to 250ms.
   */
  retryBaseDelayMs?: number;
  /**
   * User-Agent header value. Defaults to `@assinafy/chat-sdk/<version>`.
   */
  userAgent?: string;
  /**
   * Hook called with the last `X-Rate-Limit-*` headers seen. Useful for
   * surfacing rate-limit info to the host application. Observer errors are
   * ignored so they cannot turn a successful API request into a failure.
   */
  onRateLimit?: (limit: RateLimit) => void;
}

/** Shape returned by {@link HttpClient.request} for callers that need headers too. */
export interface ResponseWithMeta<T> {
  data: T;
  /** Message from an Assinafy `{ status, message, data }` response envelope. */
  message?: string;
  status: number;
  rateLimit?: RateLimit;
  pagination?: Pagination;
  headers: Headers;
}

/**
 * SDK version, injected at build time from package.json by tsup (see
 * `tsup.config.ts`). The literal fallback keeps un-bundled usage (e.g. running
 * the TypeScript sources directly) working; the build replaces it so the
 * User-Agent never drifts from the published version.
 */
declare const __SDK_VERSION__: string | undefined;
const VERSION = typeof __SDK_VERSION__ !== "undefined" ? __SDK_VERSION__ : "2.3.0";
const DEFAULT_USER_AGENT = `@assinafy/chat-sdk/${VERSION}`;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_METHOD = new Set(["GET", "HEAD", "OPTIONS"]);
const TRANSIENT_ERROR_CODE = new Set(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"]);
const MAX_TIMER_DELAY_MS = 2_147_483_647;

/**
 * Thin wrapper around `fetch` that knows how to talk to the Assinafy API.
 *
 * Resource modules (signers, documents, …) are built on top of this and
 * should not construct URLs or read envelopes themselves.
 */
export class HttpClient {
  readonly baseUrl: string;
  readonly auth: AuthStrategy;
  /**
   * Scheme + host of {@link baseUrl}, without the `/v1` path. The
   * `.well-known` discovery documents and the OAuth resource indicator live
   * at the host root rather than under the versioned prefix.
   */
  readonly origin: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly userAgent: string;
  private readonly onRateLimit?: (limit: RateLimit) => void;

  constructor(options: HttpClientOptions) {
    if (!options.baseUrl) {
      throw new ConfigurationError("HttpClient requires a baseUrl");
    }
    if (options.auth.kind === "apiKey" && !options.auth.apiKey) {
      throw new ConfigurationError("HttpClient: apiKey auth requires a non-empty apiKey");
    }
    if (options.auth.kind === "bearer" && !options.auth.token) {
      throw new ConfigurationError("HttpClient: bearer auth requires a non-empty token");
    }
    const maxRetries = options.maxRetries ?? 2;
    const retryBaseDelayMs = options.retryBaseDelayMs ?? 250;
    if (!Number.isInteger(maxRetries) || maxRetries < 0) {
      throw new ConfigurationError("HttpClient: maxRetries must be a non-negative integer");
    }
    if (!Number.isFinite(retryBaseDelayMs) || retryBaseDelayMs < 0) {
      throw new ConfigurationError("HttpClient: retryBaseDelayMs must be a non-negative number");
    }

    try {
      const base = new URL(options.baseUrl);
      if (base.protocol !== "https:" && base.protocol !== "http:") throw new Error("unsupported protocol");
      if (base.username || base.password || base.search || base.hash) {
        throw new ConfigurationError(
          "HttpClient baseUrl must not contain credentials, a query string, or a fragment",
        );
      }
      if (
        base.protocol === "http:" &&
        !["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)
      ) {
        throw new ConfigurationError(
          "HttpClient refuses plain HTTP to a remote host",
        );
      }
      this.baseUrl = base.href.replace(/\/+$/, "");
      this.origin = base.origin;
    } catch (error) {
      if (error instanceof ConfigurationError) throw error;
      throw new ConfigurationError("HttpClient requires an absolute HTTP(S) baseUrl");
    }
    this.auth = options.auth;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.maxRetries = maxRetries;
    this.retryBaseDelayMs = retryBaseDelayMs;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.onRateLimit = options.onRateLimit;

    if (typeof this.fetchImpl !== "function") {
      throw new ConfigurationError(
        "No fetch implementation available. Pass options.fetch or run on Node 24+ / Bun / Deno / a modern browser.",
      );
    }
  }

  /**
   * Clone this transport with a different base URL and/or authentication
   * strategy, keeping every other setting (fetch implementation, retry policy,
   * User-Agent, rate-limit observer).
   *
   * Two OAuth cases need it: the token and revocation endpoints authenticate
   * the *application* with `client_id`/`client_secret`, so sending the
   * integrator's own `X-Api-Key` alongside would hand a workspace credential
   * to a route that has no use for it; and the authorization server's metadata
   * lives on a different host from the API.
   */
  fork(overrides: { baseUrl?: string; auth?: AuthStrategy } = {}): HttpClient {
    return new HttpClient({
      baseUrl: overrides.baseUrl ?? this.baseUrl,
      auth: overrides.auth ?? this.auth,
      fetch: this.fetchImpl,
      maxRetries: this.maxRetries,
      retryBaseDelayMs: this.retryBaseDelayMs,
      userAgent: this.userAgent,
      onRateLimit: this.onRateLimit,
    });
  }

  /** Convenience: GET that returns just the unwrapped data. */
  get<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.request<T>(path, { ...init, method: "GET" }).then((r) => r.data);
  }

  /** Convenience: POST with a JSON body. */
  post<T>(path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
    return this.request<T>(path, withJsonBody(init, "POST", body)).then((r) => r.data);
  }

  /** Convenience: PUT with a JSON body. */
  put<T>(path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
    return this.request<T>(path, withJsonBody(init, "PUT", body)).then((r) => r.data);
  }

  /** Convenience: PATCH with a JSON body. */
  patch<T>(path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
    return this.request<T>(path, withJsonBody(init, "PATCH", body)).then((r) => r.data);
  }

  /** Convenience: DELETE that returns just the unwrapped data. */
  delete<T>(path: string, init: RequestInit = {}): Promise<T> {
    return this.request<T>(path, { ...init, method: "DELETE" }).then((r) => r.data);
  }

  /**
   * Paginated GET. Returns both the array of items and the pagination metadata
   * extracted from `X-Pagination-*` headers.
   */
  async getPage<T>(path: string, init: RequestInit = {}): Promise<Page<T>> {
    const res = await this.request<T[]>(path, { ...init, method: "GET" });
    return {
      data: res.data,
      pagination: res.pagination ?? {
        currentPage: 1,
        pageCount: 1,
        perPage: res.data.length,
        totalCount: res.data.length,
      },
    };
  }

  /**
   * Full request lifecycle: build URL, attach auth + JSON headers, send,
   * unwrap envelope, throw on error, surface metadata.
   *
   * `init.body` may be a string (JSON), `FormData`, `Blob`, `Uint8Array`, etc.
   * When it is one of those binary types the caller should also set
   * `init.headers["content-type"]` (or omit it for `FormData` so the runtime
   * generates a boundary).
   */
  async request<T>(path: string, init: RequestInit = {}): Promise<ResponseWithMeta<T>> {
    const { response, rateLimit } = await this.send(path, init);
    return this.parseSuccess<T>(response, rateLimit);
  }

  private buildUrl(path: string): string {
    if (path.startsWith("http://") || path.startsWith("https://")) {
      const url = new URL(path);
      if (url.origin !== this.origin) {
        throw new ConfigurationError("HttpClient refuses to send credentials to a different origin");
      }
      return url.href;
    }
    return path.startsWith("/") ? `${this.baseUrl}${path}` : `${this.baseUrl}/${path}`;
  }

  private buildHeaders(init: RequestInit): Headers {
    const headers = new Headers(init.headers ?? {});
    if (!headers.has("accept")) headers.set("accept", "application/json");
    if (!headers.has("user-agent")) headers.set("user-agent", this.userAgent);

    switch (this.auth.kind) {
      case "apiKey":
        headers.set("X-Api-Key", this.auth.apiKey);
        break;
      case "bearer":
        headers.set("authorization", `Bearer ${this.auth.token}`);
        break;
      case "none":
        break;
    }
    return headers;
  }

  private async parseSuccess<T>(
    response: Response,
    rateLimit: RateLimit | undefined,
  ): Promise<ResponseWithMeta<T>> {
    const pagination = readPagination(response.headers);
    const contentType = response.headers.get("content-type") ?? "";

    let data: T;
    let message: string | undefined;
    if (response.status === 204) {
      data = undefined as T;
    } else if (contentType.includes("application/json")) {
      const json = (await response.json()) as ApiEnvelope<T> | T;
      if (isEnvelope(json)) {
        data = json.data as T;
        message = json.message;
      } else {
        data = json as T;
      }
    } else {
      // Non-JSON success (e.g. download endpoints). Return the raw Response —
      // resource methods that expect this should use {@link rawRequest}.
      data = response as unknown as T;
    }

    return {
      data,
      message,
      status: response.status,
      rateLimit,
      pagination,
      headers: response.headers,
    };
  }

  private async throwFromResponse(response: Response, path: string, method: string): Promise<never> {
    let body: unknown;
    try {
      const text = await response.text();
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    } catch {
      body = undefined;
    }
    const wwwAuthenticate = response.headers.get("www-authenticate") ?? undefined;
    const oauth = readOAuthError(body, wwwAuthenticate);
    const message =
      oauth?.errorDescription ||
      (isEnvelope(body) && body.message) ||
      (isRecord(body) && typeof body.message === "string" && body.message) ||
      (oauth && `Assinafy OAuth ${method} ${path} failed: ${oauth.error}`) ||
      `Assinafy API ${method} ${path} failed with status ${response.status}`;
    const args = { status: response.status, body, path, method, message, wwwAuthenticate };
    throw oauth ? new OAuthError({ ...args, ...oauth }) : new ApiError(args);
  }

  private shouldRetry(status: number, attempt: number, method: string): boolean {
    return attempt < this.maxRetries && RETRYABLE_METHOD.has(method) && RETRYABLE_STATUS.has(status);
  }

  private backoff(attempt: number, headers?: Headers): number {
    if (headers) {
      const retryAfter = headers.get("retry-after");
      if (retryAfter) {
        // `Retry-After` may be either a number of seconds or an HTTP-date.
        const seconds = Number(retryAfter);
        if (Number.isFinite(seconds)) {
          return Math.min(Math.max(seconds, 0) * 1000, MAX_TIMER_DELAY_MS);
        }
        const dateMs = Date.parse(retryAfter);
        if (Number.isFinite(dateMs)) {
          return Math.min(Math.max(dateMs - Date.now(), 0), MAX_TIMER_DELAY_MS);
        }
      }
    }
    return Math.min(this.retryBaseDelayMs * 2 ** attempt, 10_000);
  }

  private sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason ?? new DOMException("The operation was aborted", "AbortError"));
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(signal?.reason ?? new DOMException("The operation was aborted", "AbortError"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
  }

  /**
   * Lower-level escape hatch: returns the raw `Response` without envelope
   * unwrapping. Used by file-download endpoints.
   */
  async rawRequest(path: string, init: RequestInit = {}): Promise<Response> {
    return (await this.send(path, init)).response;
  }

  private async send(
    path: string,
    init: RequestInit,
  ): Promise<{ response: Response; rateLimit: RateLimit | undefined }> {
    const url = this.buildUrl(path);
    const headers = this.buildHeaders(init);
    const method = (init.method ?? "GET").toUpperCase();
    const safePath = redactPath(path);
    let attempt = 0;

    while (true) {
      let response: Response;
      try {
        response = await this.fetchImpl(url, { ...init, method, headers, redirect: "manual" });
      } catch (err) {
        if (!RETRYABLE_METHOD.has(method)) throw err;
        if (attempt < this.maxRetries && isLikelyTransient(err)) {
          await this.sleep(this.backoff(attempt), init.signal);
          attempt++;
          continue;
        }
        throw err;
      }

      const rateLimit = readRateLimit(response.headers);
      if (rateLimit && this.onRateLimit) {
        try {
          this.onRateLimit(rateLimit);
        } catch {
          // Observers must not change the request result.
        }
      }
      if (response.ok) return { response, rateLimit };

      if (this.shouldRetry(response.status, attempt, method)) {
        await response.body?.cancel().catch(() => undefined);
        await this.sleep(this.backoff(attempt, response.headers), init.signal);
        attempt++;
        continue;
      }

      await this.throwFromResponse(response, safePath, method);
    }
  }
}

/**
 * Build a request init object for a JSON POST/PUT. Returns a new object so
 * the caller's input isn't mutated.
 */
function withJsonBody(init: RequestInit, method: string, body: unknown): RequestInit {
  if (body === undefined) return { ...init, method };
  const headers = new Headers(init.headers ?? {});
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  return { ...init, method, headers, body: JSON.stringify(body) };
}

/**
 * Pull an RFC 6749 error out of a failed response, from the flat
 * `{ error, error_description }` body the OAuth endpoints return or from a
 * `WWW-Authenticate: Bearer error="…", scope="…"` challenge. Returns
 * `undefined` when the response is an ordinary Assinafy error, so only OAuth
 * failures are upgraded to {@link OAuthError}.
 */
function readOAuthError(
  body: unknown,
  wwwAuthenticate: string | undefined,
): { error: string; errorDescription?: string; scope?: string } | undefined {
  if (isRecord(body) && typeof body.error === "string" && body.error) {
    return {
      error: body.error,
      errorDescription: typeof body.error_description === "string" ? body.error_description : undefined,
      scope: challengeParam(wwwAuthenticate, "scope"),
    };
  }
  const error = challengeParam(wwwAuthenticate, "error");
  if (!error) return undefined;
  return {
    error,
    errorDescription: challengeParam(wwwAuthenticate, "error_description"),
    scope: challengeParam(wwwAuthenticate, "scope"),
  };
}

/** Read one `name="value"` parameter out of a `WWW-Authenticate` challenge. */
function challengeParam(challenge: string | undefined, name: string): string | undefined {
  if (!challenge) return undefined;
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(challenge);
  return match?.[1] || undefined;
}

function isEnvelope(value: unknown): value is ApiEnvelope<unknown> {
  return (
    isRecord(value) &&
    typeof value.status === "number" &&
    typeof value.message === "string"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readPagination(headers: Headers): Pagination | undefined {
  const current = headers.get("x-pagination-current-page");
  if (!current) return undefined;
  return {
    currentPage: Number(current),
    pageCount: Number(headers.get("x-pagination-page-count") ?? 1),
    perPage: Number(headers.get("x-pagination-per-page") ?? 0),
    totalCount: Number(headers.get("x-pagination-total-count") ?? 0),
  };
}

function readRateLimit(headers: Headers): RateLimit | undefined {
  const limit = headers.get("x-rate-limit-limit");
  if (!limit) return undefined;
  return {
    limit: Number(limit),
    remaining: Number(headers.get("x-rate-limit-remaining") ?? 0),
    resetSeconds: Number(headers.get("x-rate-limit-reset") ?? 0),
  };
}

function isLikelyTransient(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  if (code && TRANSIENT_ERROR_CODE.has(code)) return true;
  const cause = (err as { cause?: unknown }).cause;
  return err instanceof TypeError || (cause !== err && isLikelyTransient(cause));
}

function redactPath(path: string): string {
  return path.replace(
    /([?&](?:access[-_]token|signer[-_]access[-_]code|access[-_]code|code|token)=)[^&]*/gi,
    "$1[REDACTED]",
  );
}

/** Internal: append a query object to a path, omitting undefined/null values. */
export function withQuery(path: string, query: Record<string, unknown> | undefined): string {
  if (!query) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, String(v));
    } else {
      params.append(key, String(value));
    }
  }
  const qs = params.toString();
  if (!qs) return path;
  return `${path}${path.includes("?") ? "&" : "?"}${qs}`;
}
