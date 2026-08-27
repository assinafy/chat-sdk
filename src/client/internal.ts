/**
 * Internal helpers shared between resource modules. Not part of the public
 * API — re-export from {@link ./index.js} only what we want to expose.
 */

import { ConfigurationError } from "./errors.js";

/**
 * Join an array of string values with `,` for query-parameter use, or pass a
 * string through unchanged. The Assinafy API accepts comma-separated values
 * for repeated filters such as `tags` and `status`.
 */
export function csv(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(",") : value;
}

/**
 * Convert an `ArrayBuffer` or `Uint8Array` to a `BlobPart` whose underlying
 * buffer is guaranteed to be an `ArrayBuffer` (not `SharedArrayBuffer`). The
 * `Blob` constructor's type signature rejects `SharedArrayBuffer`, so we
 * re-wrap defensively.
 */
export function toBlobPart(body: ArrayBuffer | Uint8Array): BlobPart {
  if (body instanceof ArrayBuffer) return body;
  const copy = new Uint8Array(body.byteLength);
  copy.set(body);
  return copy;
}

/** Build an upload Blob while honoring an explicit MIME-type override. */
export function toUploadBlob(
  body: Blob | ArrayBuffer | Uint8Array,
  contentType: string | undefined,
  defaultType: string,
): Blob {
  const type = contentType ?? (body instanceof Blob && body.type ? body.type : defaultType);
  if (body instanceof Blob) return body.type === type ? body : body.slice(0, body.size, type);
  return new Blob([toBlobPart(body)], { type });
}

/** Validate and encode the API's shared pagination parameters. */
export function pageQuery(page?: number, perPage?: number): Record<string, number | undefined> {
  if (page !== undefined && (!Number.isInteger(page) || page < 1)) {
    throw new ConfigurationError("page must be a positive integer");
  }
  if (perPage !== undefined && (!Number.isInteger(perPage) || perPage < 1 || perPage > 100)) {
    throw new ConfigurationError("perPage must be an integer between 1 and 100");
  }
  return { page, "per-page": perPage };
}
