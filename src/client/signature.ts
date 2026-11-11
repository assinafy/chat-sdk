/**
 * Signer-flow endpoints — used by signers themselves (not the account holder).
 * The signer proves identity with the `signer-access-code` Assinafy delivered
 * out-of-band (by email or WhatsApp). Every method taking `accessCode` rejects
 * a missing or blank code with {@link ConfigurationError} before any request
 * and sends the code alone: the client's API key or bearer token is never
 * attached. Workspace access to a signer's documents goes through the separate
 * {@link SignatureResource.listDocumentsAsWorkspace} and
 * {@link SignatureResource.searchDocumentsAsWorkspace} methods.
 *
 * @see https://api.assinafy.com.br/v1/docs
 */

import { withQuery, type HttpClient } from "./http.js";
import { ConfigurationError } from "./errors.js";
import { pageQuery, signerTransport, toBlobPart, withAccessCode } from "./internal.js";
import type {
  Document,
  AccountTheme,
  CertifiedCopyResult,
  SigningDocument,
  DocumentArtifactName,
  IdentityVerification,
  IdentityVerificationSession,
  ListSignerDocumentsQuery,
  Page,
  SignFieldEntry,
  SignerSelf,
  StartIdentityVerificationInput,
} from "./types.js";

/** Signature image kind: `signature` or `initial`. */
export type SignatureType = "signature" | "initial" | (string & {});

const paths = {
  self: () => `/signers/self`,
  theme: () => "/sign/theme",
  logo: () => "/sign/logo",
  certifiedCopy: () => "/sign/certified-copy",
  copyDownload: (token: string) => `/signers/downloads/${encodeURIComponent(token)}`,
  identityVerification: () => `/signers/identity-verification`,
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

/** Signer-facing signing flow (`client.signature`), authenticated by the signer access code. */
export class SignatureResource {
  /** Credential-free transport: signer operations send the access code only. */
  private readonly signer: HttpClient;

  constructor(private readonly http: HttpClient) {
    this.signer = signerTransport(http);
  }

  /**
   * `GET /signers/self` — the signer's own record.
   *
   * Response: `{ resource, id, full_name, email, whatsapp_phone_number,
   * government_id, has_accepted_terms, has_signature, has_initial,
   * is_signature_reusable, verification_method }`.
   */
  async self(accessCode: string): Promise<SignerSelf> {
    return this.signer.get<SignerSelf>(withAccessCode(paths.self(), accessCode));
  }

  /** Workspace branding for the signer, available before verification and after deletion. */
  async getTheme(accessCode: string): Promise<AccountTheme> {
    return this.signer.get<AccountTheme>(withAccessCode(paths.theme(), accessCode));
  }

  /** Download workspace branding with signer credentials only. No logo answers 404. */
  async downloadLogo(accessCode: string): Promise<Response> {
    return this.signer.rawRequest(withAccessCode(paths.logo(), accessCode));
  }

  /**
   * Send the certified copy to the original signing contact, also for closed codes.
   * Optional document_id selects another signed document of the same envelope.
   * Email is limited to once per two minutes and ten per day; WhatsApp to one resend.
   */
  async sendCertifiedCopy(accessCode: string, input: { document_id?: string } = {}): Promise<CertifiedCopyResult> {
    return this.signer.post<CertifiedCopyResult>(withAccessCode(paths.certifiedCopy(), accessCode),
      input.document_id === undefined ? undefined : { document_id: input.document_id });
  }

  /**
   * Public certified PDF download by bearer link token; optional pades selects ICP-Brasil output.
   * Expired links answer 302 as ApiError; the transport never follows redirects with credentials.
   */
  async downloadCertifiedCopy(token: string, artifact?: "pades"): Promise<Response> {
    if (typeof token !== "string" || !token.trim()) throw new ConfigurationError("A download token is required");
    return this.signer.rawRequest(`${paths.copyDownload(token)}${artifact ? `/${encodeURIComponent(artifact)}` : ""}`);
  }

  /** Request a fresh copy using an expired download token. Uses the original contact and resend limits. */
  async resendCertifiedCopy(token: string): Promise<CertifiedCopyResult> {
    if (typeof token !== "string" || !token.trim()) throw new ConfigurationError("A download token is required");
    return this.signer.post<CertifiedCopyResult>(`${paths.copyDownload(token)}/resend`);
  }

  /**
   * `GET /signers/identity-verification` — `{ can_start, status, url,
   * expires_at, completed_at }`, using only the signer access code. Start a
   * capture only when `can_start` is true. `InReview` permits signing but
   * holds certification until the account approves the identity review.
   */
  async getIdentityVerification(accessCode: string): Promise<IdentityVerification> {
    return this.signer.get<IdentityVerification>(withAccessCode(paths.identityVerification(), accessCode));
  }

  /**
   * `POST /signers/identity-verification` — request `{ consent: true }`,
   * supplied explicitly by the signer. Response: `{ id, url, expires_at }`.
   * Open the bearer URL unchanged, including its fragment; never log it or
   * persist it in browser storage. Only no session or an `Expired` session
   * may start; `Declined`/`Abandoned` require a new document and assignment.
   * The request is never retried, and restarting an expired capture is not billed again.
   */
  async startIdentityVerification(
    accessCode: string,
    input: StartIdentityVerificationInput,
  ): Promise<IdentityVerificationSession> {
    const path = withAccessCode(paths.identityVerification(), accessCode);
    if (input?.consent !== true) {
      throw new ConfigurationError("Identity verification requires the signer's explicit biometric consent");
    }
    return this.signer.post<IdentityVerificationSession>(path, { consent: input.consent });
  }

  /** `PUT /signers/accept-terms` — accept the signer terms of use. No body; resolves on success. */
  async acceptTerms(accessCode: string): Promise<void> {
    await this.signer.put<unknown>(withAccessCode(paths.acceptTerms(), accessCode));
  }

  /**
   * `POST /verify` — check the one-time code (Email or WhatsApp) sent to the
   * signer. Request: `{ "verification-code": string }`. Rejects with
   * {@link ApiError} `400` on a wrong code; resolves on success.
   */
  async verify(accessCode: string, verificationCode: string): Promise<void> {
    await this.signer.post<unknown>(withAccessCode(paths.verify(), accessCode), {
      "verification-code": verificationCode,
    });
  }

  /**
   * `POST /signature` — upload a signature or initials image as the raw
   * request body (published media type `image/png`). `type` selects the image
   * kind; `reuse`, when supplied, updates the signer's reusable-signature
   * preference. Resolves on success.
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
    await this.signer.request<unknown>(withAccessCode(paths.upload(), accessCode, { type, reuse }), {
      method: "POST",
      body,
      headers: { "content-type": contentType },
    });
  }

  /** `GET /signature/{signatureType}` — download a previously uploaded image as a raw `Response`. */
  async download(accessCode: string, type: SignatureType): Promise<Response> {
    return this.signer.rawRequest(withAccessCode(paths.get(type), accessCode));
  }

  /**
   * `GET /sign` — the signer-facing {@link SigningDocument} context; marks the
   * document as viewed. A `409` means the document is still being prepared;
   * retry with backoff.
   *
   * Digital-certificate signers must confirm their data and accept the terms
   * before this request (`SignersResource.confirmDataForDocument` with
   * `has_accepted_terms: true`, or {@link acceptTerms}); the query option here
   * is too late to satisfy that gate.
   */
  async signContext(accessCode: string, options: { hasAcceptedTerms?: boolean; expand?: "envelope"; document_id?: string } = {}): Promise<SigningDocument> {
    return this.signer.get<SigningDocument>(
      withAccessCode(paths.sign(), accessCode, { has_accepted_terms: options.hasAcceptedTerms, expand: options.expand, document_id: options.document_id }),
    );
  }

  /** `GET /signers/{signerId}/document` — the {@link SigningDocument}, compact once the code closes. */
  async currentDocument(signerId: string, accessCode: string, options: { expand?: "envelope" } = {}): Promise<SigningDocument> {
    return this.signer.get<SigningDocument>(withAccessCode(paths.signerDocument(signerId), accessCode, { expand: options.expand }));
  }

  /**
   * `GET /signers/{signerId}/documents` as the signer — the documents the
   * signer is party to, paginated via `X-Pagination-*`.
   *
   * Query sent: `search`, `sort`, `page`, `per-page`. The `status`, `method`
   * and `tags` members of {@link ListSignerDocumentsQuery} are not part of this
   * operation and are ignored.
   */
  async listDocuments(
    signerId: string,
    accessCode: string,
    query: ListSignerDocumentsQuery = {},
  ): Promise<Page<Document>> {
    return this.signer.getPage<Document>(
      withAccessCode(paths.signerDocuments(signerId), accessCode, signerDocumentsQuery(query)),
    );
  }

  /**
   * `GET /signers/{signerId}/documents` with the client's workspace
   * credentials (API key or bearer token) instead of an access code. The
   * signer must belong to that workspace. Same query and response as
   * {@link listDocuments}.
   */
  async listDocumentsAsWorkspace(
    signerId: string,
    query: ListSignerDocumentsQuery = {},
  ): Promise<Page<Document>> {
    return this.http.getPage<Document>(withQuery(paths.signerDocuments(signerId), signerDocumentsQuery(query)));
  }

  /**
   * `GET /signers/{signerId}/documents/search` as the signer — lightweight
   * search over the signer's documents. Query: `search`. Returns compact
   * {@link Document} objects.
   */
  async searchDocuments(signerId: string, accessCode: string, search?: string): Promise<Page<Document>> {
    return this.signer.getPage<Document>(
      withAccessCode(paths.signerDocumentsSearch(signerId), accessCode, { search }),
    );
  }

  /**
   * `GET /signers/{signerId}/documents/search` with the client's workspace
   * credentials instead of an access code. Same query and response as
   * {@link searchDocuments}.
   */
  async searchDocumentsAsWorkspace(signerId: string, search?: string): Promise<Page<Document>> {
    return this.http.getPage<Document>(withQuery(paths.signerDocumentsSearch(signerId), { search }));
  }

  /**
   * `POST /documents/{documentId}/assignments/{assignmentId}` — submit
   * signer-filled values. Request: `[{ itemId, fieldId, pageId, value }]`.
   * Virtual assignments require confirmed signer data first;
   * digital-certificate signers use the certificate flow instead (`400`).
   */
  async sign(
    documentId: string,
    assignmentId: string,
    accessCode: string,
    entries: SignFieldEntry[],
  ): Promise<void> {
    await this.signer.post<unknown>(
      withAccessCode(paths.submitAssignment(documentId, assignmentId), accessCode),
      entries.map(({ itemId, fieldId, pageId, value }) => ({ itemId, fieldId, pageId, value })),
    );
  }

  /**
   * `PUT /documents/{documentId}/assignments/{assignmentId}/reject` — decline
   * one assignment. Request: `{ decline_reason: string }`.
   */
  async decline(
    documentId: string,
    assignmentId: string,
    accessCode: string,
    declineReason: string,
  ): Promise<void> {
    await this.signer.put<unknown>(
      withAccessCode(paths.declineAssignment(documentId, assignmentId), accessCode),
      { decline_reason: declineReason },
    );
  }

  /** `PUT /signers/documents/sign-multiple` — sign several virtual documents. Request: `{ document_ids: string[] }`. */
  async signMultiple(accessCode: string, documentIds: string[]): Promise<void> {
    await this.signer.put<unknown>(withAccessCode(paths.signMultiple(), accessCode), {
      document_ids: documentIds,
    });
  }

  /**
   * `PUT /signers/documents/decline-multiple` — decline several documents.
   * Request: `{ document_ids: string[], decline_reason: string }`.
   */
  async declineMultiple(accessCode: string, documentIds: string[], declineReason: string): Promise<void> {
    await this.signer.put<unknown>(withAccessCode(paths.declineMultiple(), accessCode), {
      document_ids: documentIds,
      decline_reason: declineReason,
    });
  }

  /**
   * `GET /signers/{signerId}/documents/{documentId}/download/{artifactName}` —
   * public signer-link download, returned as a raw `Response`.
   * @param accessCode Deprecated and ignored; this route is public.
   */
  downloadDocument(
    signerId: string,
    documentId: string,
    artifactName: DocumentArtifactName,
    accessCode?: string,
  ): Promise<Response> {
    void accessCode;
    return this.signer.rawRequest(paths.signerDownload(signerId, documentId, artifactName));
  }
}

/** Query members the signer-document list operation declares. */
function signerDocumentsQuery(query: ListSignerDocumentsQuery): Record<string, unknown> {
  return { search: query.search, sort: query.sort, envelope_id: query.envelope_id, ...pageQuery(query.page, query.perPage) };
}
