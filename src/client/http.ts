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

import { ApiError, ConfigurationError } from "./errors.js";
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
   * exponentially: `baseDelayMs * 2 ** attempt`, capped at 10s.
   * Defaults to 250ms.
   */
  retryBaseDelayMs?: number;
  /**
   * User-Agent header value. Defaults to `@assinafy/chat-sdk/<version>`.
   */
  userAgent?: string;
  /**
   * Hook called with the last `X-Rate-Limit-*` headers seen. Useful for
   * surfacing rate-limit info to the host application.
   */
  onRateLimit?: (limit: RateLimit) => void;
}

/** Shape returned by {@link HttpClient.request} for callers that need headers too. */
export interface ResponseWithMeta<T> {
  data: T;
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
const VERSION = typeof __SDK_VERSION__ !== "undefined" ? __SDK_VERSION__ : "2.0.0";
const DEFAULT_USER_AGENT = `@assinafy/chat-sdk/${VERSION}`;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const RETRYABLE_METHOD = new Set(["GET", "HEAD", "OPTIONS"]);
const TRANSIENT_ERROR_CODE = new Set(["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN"]);

/**
 * Thin wrapper around `fetch` that knows how to talk to the Assinafy API.
 *
 * Resource modules (signers, documents, …) are built on top of this and
 * should not construct URLs or read envelopes themselves.
 */
export class HttpClient {
  readonly baseUrl: string;
  readonly auth: AuthStrategy;
  private readonly baseOrigin: string;
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

    try {
      const base = new URL(options.baseUrl);
      if (base.protocol !== "https:" && base.protocol !== "http:") throw new Error("unsupported protocol");
      this.baseUrl = base.href.replace(/\/$/, "");
      this.baseOrigin = base.origin;
    } catch {
      throw new ConfigurationError("HttpClient requires an absolute HTTP(S) baseUrl");
    }
    this.auth = options.auth;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 250;
    this.userAgent = options.userAgent ?? DEFAULT_USER_AGENT;
    this.onRateLimit = options.onRateLimit;

    if (!this.fetchImpl) {
      throw new ConfigurationError(
        "No fetch implementation available. Pass options.fetch or run on Node 24+ / Bun / Deno / a modern browser.",
      );
    }
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
    return this.parseSuccess<T>(response, redactPath(path), rateLimit);
  }

  private buildUrl(path: string): string {
    if (path.startsWith("http://") || path.startsWith("https://")) {
      const url = new URL(path);
      if (url.origin !== this.baseOrigin) {
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
    path: string,
    rateLimit: RateLimit | undefined,
  ): Promise<ResponseWithMeta<T>> {
    const pagination = readPagination(response.headers);
    const contentType = response.headers.get("content-type") ?? "";

    let data: T;
    if (response.status === 204) {
      data = undefined as T;
    } else if (contentType.includes("application/json")) {
      const json = (await response.json()) as ApiEnvelope<T> | T;
      data = isEnvelope(json) ? (json.data as T) : (json as T);
    } else {
      // Non-JSON success (e.g. download endpoints). Return the raw Response —
      // resource methods that expect this should use {@link rawRequest}.
      data = response as unknown as T;
    }

    return {
      data,
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
    const message =
      (isEnvelope(body) && body.message) ||
      (isRecord(body) && typeof body.message === "string" && body.message) ||
      `Assinafy API ${method} ${path} failed with status ${response.status}`;
    throw new ApiError({ status: response.status, body, path, method, message });
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
        if (Number.isFinite(seconds)) return Math.min(Math.max(seconds, 0) * 1000, 10_000);
        const dateMs = Date.parse(retryAfter);
        if (Number.isFinite(dateMs)) return Math.min(Math.max(dateMs - Date.now(), 0), 10_000);
      }
    }
    return Math.min(this.retryBaseDelayMs * 2 ** attempt, 10_000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
      try {
        const response = await this.fetchImpl(url, { ...init, method, headers, redirect: "manual" });
        const rateLimit = readRateLimit(response.headers);
        if (rateLimit) this.onRateLimit?.(rateLimit);
        if (response.ok) return { response, rateLimit };

        if (this.shouldRetry(response.status, attempt, method)) {
          await response.body?.cancel().catch(() => undefined);
          await this.sleep(this.backoff(attempt, response.headers));
          attempt++;
          continue;
        }

        await this.throwFromResponse(response, safePath, method);
      } catch (err) {
        if (err instanceof ApiError || !RETRYABLE_METHOD.has(method)) throw err;
        if (attempt < this.maxRetries && isLikelyTransient(err)) {
          await this.sleep(this.backoff(attempt));
          attempt++;
          continue;
        }
        throw err;
      }
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
  return path.replace(/([?&](?:access-token|signer-access-code)=)[^&]*/gi, "$1[REDACTED]");
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
