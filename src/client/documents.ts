/**
 * Documents resource — upload, list, fetch, download, delete.
 *
 * Documents are the core object in Assinafy: a PDF (or other supported file)
 * that has been uploaded and may pass through statuses such as
 * `metadata_ready` → `pending_signature` → `certificated`.
 *
 * @see https://api.assinafy.com.br/v1/docs
 */

import { withQuery, type HttpClient } from "./http.js";
import { ConfigurationError } from "./errors.js";
import { csv, pageQuery, toUploadBlob } from "./internal.js";
import type {
  Document,
  DocumentActivity,
  DocumentArtifactName,
  DocumentStatus,
  DocumentVerificationResult,
  ListDocumentsQuery,
  Page,
  PublicDocument,
  RenameDocumentInput,
  SearchDocumentsQuery,
  SendPublicTokenInput,
  SendPublicTokenResult,
  UploadDocumentInput,
} from "./types.js";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

const paths = {
  statuses: () => `/documents/statuses`,
  collection: (accountId: string) => `/accounts/${encodeURIComponent(accountId)}/documents`,
  search: (accountId: string) => `/accounts/${encodeURIComponent(accountId)}/documents/search`,
  item: (documentId: string) => `/documents/${encodeURIComponent(documentId)}`,
  download: (documentId: string, artifact: string) =>
    `/documents/${encodeURIComponent(documentId)}/download/${encodeURIComponent(artifact)}`,
  thumbnail: (documentId: string) => `/documents/${encodeURIComponent(documentId)}/thumbnail`,
  page: (documentId: string, pageId: string) =>
    `/documents/${encodeURIComponent(documentId)}/pages/${encodeURIComponent(pageId)}/download`,
  verify: (signatureHash: string) => `/documents/${encodeURIComponent(signatureHash)}/verify`,
  activities: (documentId: string) => `/documents/${encodeURIComponent(documentId)}/activities`,
  publicGet: (documentId: string) => `/public/documents/${encodeURIComponent(documentId)}`,
  sendToken: (documentId: string) =>
    `/public/documents/${encodeURIComponent(documentId)}/send-token`,
};

export class DocumentsResource {
  constructor(private readonly http: HttpClient) {}

  /** List the canonical document status codes plus their `deletable` flag. */
  statuses(): Promise<DocumentStatus[]> {
    return this.http.get<DocumentStatus[]>(paths.statuses());
  }

  /** List documents for an account, with optional filters. */
  list(accountId: string, query: ListDocumentsQuery = {}): Promise<Page<Document>> {
    return this.http.getPage<Document>(
      withQuery(paths.collection(accountId), {
        status: csv(query.status),
        method: query.method,
        search: query.search,
        tags: csv(query.tags),
        sort: query.sort,
        ...pageQuery(query.page, query.perPage),
      }),
    );
  }

  /**
   * Lightweight document search. Returns a compact document representation
   * (no expanded assignment/pages) — cheaper than {@link list} when you only
   * need to resolve names/ids.
   */
  search(accountId: string, query: SearchDocumentsQuery = {}): Promise<Page<Document>> {
    return this.http.getPage<Document>(
      withQuery(paths.search(accountId), {
        search: query.search,
        status: csv(query.status),
        ...pageQuery(query.page, query.perPage),
      }),
    );
  }

  /** Iterate through every document, automatically paging. */
  async *iterate(accountId: string, query: ListDocumentsQuery = {}): AsyncIterableIterator<Document> {
    let page = query.page ?? 1;
    const perPage = query.perPage ?? 50;
    while (true) {
      const result = await this.list(accountId, { ...query, page, perPage });
      for (const doc of result.data) yield doc;
      if (page >= result.pagination.pageCount) return;
      page++;
    }
  }

  /**
   * Upload a new document under an account.
   *
   * Assinafy accepts files up to 25 MB and documents up to 2,000 pages.
   * The body can be a Blob (Browser / Bun), an ArrayBuffer, or a Uint8Array
   * (Node). For Node, prefer reading the file with `fs.readFile` and passing
   * the resulting Buffer (Buffers are Uint8Arrays).
   */
  async upload(accountId: string, input: UploadDocumentInput): Promise<Document> {
    const size = input.body instanceof Blob ? input.body.size : input.body.byteLength;
    if (size > MAX_UPLOAD_BYTES) {
      throw new ConfigurationError("DocumentsResource.upload accepts files up to 25 MB");
    }
    const form = new FormData();
    const blob = toUploadBlob(input.body, input.contentType, "application/pdf");
    form.append("file", blob, input.filename);
    if (input.tags) {
      for (const tag of input.tags) form.append("tags[]", tag);
    }
    // `request` rather than `post`: the body is multipart, so the runtime must
    // generate the boundary and set `content-type` itself.
    const response = await this.http.request<Document>(paths.collection(accountId), {
      method: "POST",
      body: form,
    });
    return response.data;
  }

  /** Fetch a single document by id. */
  get(documentId: string): Promise<Document> {
    return this.http.get<Document>(paths.item(documentId));
  }

  /**
   * Rename a document. Only allowed before any assignment exists (status
   * `uploaded` or `metadata_ready` with no signers); once the signature process
   * has started or the document is certificated, the name is locked. The API
   * normalizes the name (diacritics removed, unsupported characters replaced
   * with dashes).
   */
  rename(documentId: string, name: string): Promise<Document> {
    return this.http.patch<Document>(paths.item(documentId), { name } satisfies RenameDocumentInput);
  }

  /** Delete a document. Only available when its current status is `deletable`. */
  async remove(documentId: string): Promise<void> {
    await this.http.delete<unknown>(paths.item(documentId));
  }

  /**
   * Download a specific artifact (e.g. `original`, `certificated`).
   * Returns a `Response` so callers can stream, buffer, or pipe as they like.
   */
  download(documentId: string, artifactName: DocumentArtifactName): Promise<Response> {
    return this.http.rawRequest(paths.download(documentId, artifactName));
  }

  /** Download the document thumbnail as an image `Response`. */
  thumbnail(documentId: string): Promise<Response> {
    return this.http.rawRequest(paths.thumbnail(documentId));
  }

  /** Download a single page as an image `Response`. */
  downloadPage(documentId: string, pageId: string): Promise<Response> {
    return this.http.rawRequest(paths.page(documentId, pageId));
  }

  /** Activity log for a document (signed events, notifications, declines, …). */
  activities(documentId: string): Promise<DocumentActivity[]> {
    return this.http.get<DocumentActivity[]>(paths.activities(documentId));
  }

  /** Public, unauthenticated verification by signature hash. */
  verify(signatureHash: string): Promise<DocumentVerificationResult> {
    return this.http.get<DocumentVerificationResult>(paths.verify(signatureHash));
  }

  /** Public, unauthenticated fetch of a document by id (used by signer UIs). */
  publicGet(documentId: string): Promise<Document | PublicDocument> {
    return this.http.get<Document | PublicDocument>(paths.publicGet(documentId));
  }

  /** Public: ask Assinafy to send a document access token. */
  sendPublicToken(
    documentId: string,
    input?: SendPublicTokenInput,
  ): Promise<SendPublicTokenResult | undefined> {
    return this.http.put<SendPublicTokenResult | undefined>(paths.sendToken(documentId), input);
  }
}
