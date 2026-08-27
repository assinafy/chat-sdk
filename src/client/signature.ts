/**
 * Public signer-flow endpoints — used by signers themselves (not the account
 * holder). These are unauthenticated; the caller proves identity by passing
 * a `signer-access-code` that Assinafy delivered out-of-band (typically by
 * email or WhatsApp link).
 *
 * @see https://api.assinafy.com.br/v1/docs
 */

import { withQuery, type HttpClient } from "./http.js";
import { csv, pageQuery, toBlobPart } from "./internal.js";
import type {
  Document,
  DocumentArtifactName,
  ListSignerDocumentsQuery,
  Page,
  SignFieldEntry,
  SignerSelf,
} from "./types.js";

export type SignatureType = "signature" | "initial" | (string & {});

const paths = {
  self: () => `/signers/self`,
  acceptTerms: () => `/signers/accept-terms`,
  verify: () => `/verify`,
  upload: () => `/signature`,
  get: (type: string) => `/signature/${encodeURIComponent(type)}`,
  sign: () => "/sign",
  signerDocument: (signerId: string) => `/signers/${encodeURIComponent(signerId)}/document`,
  signerDocuments: (signerId: string) => `/signers/${encodeURIComponent(signerId)}/documents`,
  signerDocumentsSearch: (signerId: string) =>
    `/signers/${encodeURIComponent(signerId)}/documents/search`,
  signerDownload: (signerId: string, documentId: string, artifact: string) =>
    `/signers/${encodeURIComponent(signerId)}/documents/${encodeURIComponent(documentId)}/download/${encodeURIComponent(artifact)}`,
  signMultiple: () => "/signers/documents/sign-multiple",
  declineMultiple: () => "/signers/documents/decline-multiple",
  submitAssignment: (documentId: string, assignmentId: string) =>
    `/documents/${encodeURIComponent(documentId)}/assignments/${encodeURIComponent(assignmentId)}`,
  declineAssignment: (documentId: string, assignmentId: string) =>
    `/documents/${encodeURIComponent(documentId)}/assignments/${encodeURIComponent(assignmentId)}/reject`,
};

export class SignatureResource {
  constructor(private readonly http: HttpClient) {}

  /** Fetch the signer's own record using their access code. */
  self(accessCode: string): Promise<SignerSelf> {
    return this.http.get<SignerSelf>(withQuery(paths.self(), { "signer-access-code": accessCode }));
  }

  /**
   * Accept the signer terms of use. The signer is identified by the
   * `signer-access-code` query parameter (the endpoint's sole credential).
   */
  async acceptTerms(accessCode: string): Promise<void> {
    await this.http.put<unknown>(withQuery(paths.acceptTerms(), { "signer-access-code": accessCode }));
  }

  /**
   * Verify the one-time code (OTP) sent to the signer to unlock the signing
   * flow. Throws {@link ApiError} on an invalid code; resolves on success.
   */
  async verify(accessCode: string, verificationCode: string): Promise<void> {
    await this.http.post<unknown>(
      withQuery(paths.verify(), { "signer-access-code": accessCode }),
      { "verification-code": verificationCode },
    );
  }

  /**
   * Upload a signature or initials image as the raw request body. The published
   * media type is `image/png`; `type` selects the image kind. When supplied,
   * `reuse` updates the signer's reusable-signature preference, while omitting
   * it leaves that preference unchanged.
   */
  upload(
    accessCode: string,
    image: Blob | ArrayBuffer | Uint8Array,
    contentType?: string,
    reuse?: boolean,
  ): Promise<void>;
  upload(
    accessCode: string,
    type: SignatureType | undefined,
    image: Blob | ArrayBuffer | Uint8Array,
    contentType?: string,
    reuse?: boolean,
  ): Promise<void>;
  async upload(
    accessCode: string,
    ...args:
      | [Blob | ArrayBuffer | Uint8Array, string?, boolean?]
      | [SignatureType | undefined, Blob | ArrayBuffer | Uint8Array, string?, boolean?]
  ): Promise<void> {
    const hasType = typeof args[0] === "string" || args[0] === undefined;
    const type = hasType ? args[0] : undefined;
    const image = (hasType ? args[1] : args[0]) as Blob | ArrayBuffer | Uint8Array;
    const contentType = ((hasType ? args[2] : args[1]) as string | undefined) ?? "image/png";
    const reuse = (hasType ? args[3] : args[2]) as boolean | undefined;
    const body = image instanceof Blob ? image : new Blob([toBlobPart(image)], { type: contentType });
    await this.http.request<unknown>(
      withQuery(paths.upload(), { "signer-access-code": accessCode, type, reuse }),
      {
        method: "POST",
        body,
        headers: { "content-type": contentType },
      },
    );
  }

  /** Download a previously uploaded signature image. */
  download(accessCode: string, type: SignatureType): Promise<Response> {
    return this.http.rawRequest(
      withQuery(paths.get(type), { "signer-access-code": accessCode }),
    );
  }

  /**
   * Fetch the signer-facing document context and mark the document as viewed.
   * A `409` means the document is still being prepared; retry with backoff.
   *
   * Digital-certificate signers must confirm their data and accept the terms
   * before this request. Send `has_accepted_terms: true` through
   * `SignersResource.confirmDataForDocument`, or accept terms separately; the
   * query option here is too late to satisfy that gate.
   */
  signContext(accessCode: string, options: { hasAcceptedTerms?: boolean } = {}): Promise<Document> {
    return this.http.get<Document>(
      withQuery(paths.sign(), {
        "signer-access-code": accessCode,
        has_accepted_terms: options.hasAcceptedTerms,
      }),
    );
  }

  /** Fetch the current document associated with a signer access code. */
  currentDocument(signerId: string, accessCode: string): Promise<Document> {
    return this.http.get<Document>(
      withQuery(paths.signerDocument(signerId), { "signer-access-code": accessCode }),
    );
  }

  /** List documents visible to a signer. */
  listDocuments(
    signerId: string,
    accessCode: string,
    query: ListSignerDocumentsQuery = {},
  ): Promise<Page<Document>> {
    return this.http.getPage<Document>(
      withQuery(paths.signerDocuments(signerId), {
        "signer-access-code": accessCode,
        status: csv(query.status),
        method: query.method,
        search: query.search,
        sort: query.sort,
        tags: csv(query.tags),
        ...pageQuery(query.page, query.perPage),
      }),
    );
  }

  /**
   * Lightweight search over the documents a signer is party to. Returns a
   * compact document representation.
   */
  searchDocuments(
    signerId: string,
    accessCode: string,
    search?: string,
  ): Promise<Page<Document>> {
    return this.http.getPage<Document>(
      withQuery(paths.signerDocumentsSearch(signerId), {
        "signer-access-code": accessCode,
        search,
      }),
    );
  }

  /**
   * Submit signer-filled values for a collect assignment. Virtual assignments
   * require confirmed signer data first; digital-certificate assignments use
   * the certificate signing flow instead of this endpoint.
   */
  async sign(
    documentId: string,
    assignmentId: string,
    accessCode: string,
    entries: SignFieldEntry[],
  ): Promise<void> {
    await this.http.post<unknown>(
      withQuery(paths.submitAssignment(documentId, assignmentId), {
        "signer-access-code": accessCode,
      }),
      entries,
    );
  }

  /** Decline one assignment as the signer. */
  async decline(
    documentId: string,
    assignmentId: string,
    accessCode: string,
    declineReason: string,
  ): Promise<void> {
    await this.http.put<unknown>(
      withQuery(paths.declineAssignment(documentId, assignmentId), {
        "signer-access-code": accessCode,
      }),
      { decline_reason: declineReason },
    );
  }

  /** Sign multiple virtual documents at once. */
  async signMultiple(accessCode: string, documentIds: string[]): Promise<void> {
    await this.http.put<unknown>(
      withQuery(paths.signMultiple(), { "signer-access-code": accessCode }),
      { document_ids: documentIds },
    );
  }

  /** Decline multiple documents at once. */
  async declineMultiple(
    accessCode: string,
    documentIds: string[],
    declineReason: string,
  ): Promise<void> {
    await this.http.put<unknown>(
      withQuery(paths.declineMultiple(), { "signer-access-code": accessCode }),
      { document_ids: documentIds, decline_reason: declineReason },
    );
  }

  /**
   * Download an artifact from the public signer-link endpoint.
   * @param accessCode Deprecated and ignored; this route is public.
   */
  downloadDocument(
    signerId: string,
    documentId: string,
    artifactName: DocumentArtifactName,
    accessCode?: string,
  ): Promise<Response> {
    void accessCode;
    return this.http.rawRequest(paths.signerDownload(signerId, documentId, artifactName));
  }
}
