/**
 * Internal helpers shared between resource modules. Not part of the public
 * API — re-export from {@link ./index.js} only what we want to expose.
 */

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
