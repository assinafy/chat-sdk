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

/** Document upload, listing, artifacts, verification and the public document routes (`client.documents`). */
export class DocumentsResource {
  constructor(private readonly http: HttpClient) {}

  /** `GET /documents/statuses` — `[{ code, deletable }]` for every document status. */
  statuses(): Promise<DocumentStatus[]> {
    return this.http.get<DocumentStatus[]>(paths.statuses());
  }

  /**
   * `GET /accounts/{accountId}/documents` — query `status`, `method`,
   * `search`, `tags`, `sort`, `page`, `per-page` (array filters are joined
   * with commas). Response: `Page<Document>`.
   */
  async list(accountId: string, query: ListDocumentsQuery = {}): Promise<Page<Document>> {
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
   * `GET /accounts/{accountId}/documents/search` — query `search`, `status`,
   * `page`, `per-page`. Returns a compact document representation
   * (no expanded assignment/pages) — cheaper than {@link list} when you only
   * need to resolve names/ids.
   */
  async search(accountId: string, query: SearchDocumentsQuery = {}): Promise<Page<Document>> {
    return this.http.getPage<Document>(
      withQuery(paths.search(accountId), {
        search: query.search,
        status: csv(query.status),
        ...pageQuery(query.page, query.perPage),
      }),
    );
  }

  /** Page through every document of {@link list} lazily (50 per request by default). */
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
   * `POST /accounts/{accountId}/documents` — upload a document as
   * `multipart/form-data` with a single `file` part. Response: the new
   * {@link Document} (status `uploaded`, then `metadata_processing` →
   * `metadata_ready`).
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
    // `request` rather than `post`: the body is multipart, so the runtime must
    // generate the boundary and set `content-type` itself.
    const response = await this.http.request<Document>(paths.collection(accountId), {
      method: "POST",
      body: form,
    });
    return response.data;
  }

  /** `GET /documents/{documentId}` — one {@link Document}, with its assignment and pages. */
  get(documentId: string): Promise<Document> {
    return this.http.get<Document>(paths.item(documentId));
  }

  /**
   * `PATCH /documents/{documentId}` — request `{ name }`; response: the
   * renamed {@link Document}. Only allowed before any assignment exists (status
   * `uploaded` or `metadata_ready` with no signers); once the signature process
   * has started or the document is certificated, the name is locked. The API
   * normalizes the name (diacritics removed, unsupported characters replaced
   * with dashes).
   */
  rename(documentId: string, name: string): Promise<Document> {
    return this.http.patch<Document>(paths.item(documentId), { name } satisfies RenameDocumentInput);
  }

  /** `DELETE /documents/{documentId}` — only when its current status is `deletable`. */
  async remove(documentId: string): Promise<void> {
    await this.http.delete<unknown>(paths.item(documentId));
  }

  /**
   * `GET /documents/{documentId}/download/{artifactName}` — download an
   * artifact: `original`, `certificated`, `certificate-page`, `pades` or `bundle`.
   * Returns a `Response` so callers can stream, buffer, or pipe as they like.
   */
  download(documentId: string, artifactName: DocumentArtifactName): Promise<Response> {
    return this.http.rawRequest(paths.download(documentId, artifactName));
  }

  /** `GET /documents/{documentId}/thumbnail` — the thumbnail image as a raw `Response`. */
  thumbnail(documentId: string): Promise<Response> {
    return this.http.rawRequest(paths.thumbnail(documentId));
  }

  /** `GET /documents/{documentId}/pages/{pageId}/download` — one page image as a raw `Response`. */
  downloadPage(documentId: string, pageId: string): Promise<Response> {
    return this.http.rawRequest(paths.page(documentId, pageId));
  }

  /**
   * `GET /documents/{documentId}/activities` — the activity log:
   * `[{ id, event, message, payload, origin, created_at }]` (`origin` holds the request IP).
   */
  activities(documentId: string): Promise<DocumentActivity[]> {
    return this.http.get<DocumentActivity[]>(paths.activities(documentId));
  }

  /**
   * `GET /documents/{documentSignatureHash}/verify` — public verification.
   * Response: `{ hash, id, agreement_code, status, page_count, signer_count,
   * completed_count, completed_at, verified_at, is_valid, message }`.
   */
  verify(signatureHash: string): Promise<DocumentVerificationResult> {
    return this.http.get<DocumentVerificationResult>(paths.verify(signatureHash));
  }

  /** `GET /public/documents/{documentId}` — public read of a document (used by signer UIs). */
  publicGet(documentId: string): Promise<Document | PublicDocument> {
    return this.http.get<Document | PublicDocument>(paths.publicGet(documentId));
  }

  /**
   * `PUT /public/documents/{documentId}/send-token` — email a one-time access
   * token to a signer of a pending public document. Public: no credential.
   *
   * Request: `{ channel: "email", recipient: "<signer email>" }` — both
   * required; `email` is the only channel, and `recipient` must be a signer of
   * the document who has not signed yet. The deprecated `{ email }` form is
   * sent as `{ channel: "email", recipient: email }`. Response:
   * `{ document: { resource, id, name, page_count, created_by }, channel,
   * recipient }`.
   */
  async sendPublicToken(documentId: string, input: SendPublicTokenInput): Promise<SendPublicTokenResult> {
    const recipient = input && ("email" in input ? input.email : input.recipient);
    const channel = input && ("email" in input ? "email" : input.channel);
    if (channel !== "email") {
      throw new ConfigurationError('sendPublicToken supports only channel "email"');
    }
    if (typeof recipient !== "string" || recipient.trim() === "") {
      throw new ConfigurationError("sendPublicToken requires the signer's email as recipient");
    }
    return this.http.put<SendPublicTokenResult>(paths.sendToken(documentId), { channel, recipient });
  }
}
