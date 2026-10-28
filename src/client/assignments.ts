/**
 * Assignments resource — connects a document to one or more signers and
 * triggers the signature workflow.
 *
 * @see https://api.assinafy.com.br/v1/docs
 */

import { withQuery, type HttpClient } from "./http.js";
import { ConfigurationError } from "./errors.js";
import { pageQuery } from "./internal.js";
import { SignatureResource } from "./signature.js";
import type {
  Assignment,
  AssignmentSignerInput,
  CostEstimate,
  CreateAssignmentInput,
  EstimateAssignmentCostInput,
  EstimateAssignmentSignerInput,
  ListAssignmentsQuery,
  IdentityReviewImage,
  Page,
  ResendCostEstimate,
  ResendNotificationResult,
  ReviewSignerIdentityInput,
  SignFieldEntry,
  SignerIdentityReview,
  WhatsAppNotification,
} from "./types.js";

const paths = {
  list: () => `/assignments`,
  collection: (documentId: string) => `/documents/${encodeURIComponent(documentId)}/assignments`,
  estimate: (documentId: string) =>
    `/documents/${encodeURIComponent(documentId)}/assignments/estimate-cost`,
  signerResend: (documentId: string, assignmentId: string, signerId: string) =>
    `/documents/${encodeURIComponent(documentId)}/assignments/${encodeURIComponent(assignmentId)}/signers/${encodeURIComponent(signerId)}/resend`,
  signerResendEstimate: (documentId: string, assignmentId: string, signerId: string) =>
    `/documents/${encodeURIComponent(documentId)}/assignments/${encodeURIComponent(assignmentId)}/signers/${encodeURIComponent(signerId)}/estimate-resend-cost`,
  resetExpiration: (documentId: string, assignmentId: string) =>
    `/documents/${encodeURIComponent(documentId)}/assignments/${encodeURIComponent(assignmentId)}/reset-expiration`,
  whatsappNotifications: (documentId: string, assignmentId: string) =>
    `/documents/${encodeURIComponent(documentId)}/assignments/${encodeURIComponent(assignmentId)}/whatsapp-notifications`,
  identityVerification: (documentId: string, assignmentId: string, signerId: string) =>
    `/documents/${encodeURIComponent(documentId)}/assignments/${encodeURIComponent(assignmentId)}/signers/${encodeURIComponent(signerId)}/identity-verification`,
};

const DIGITAL_CERTIFICATE_REQUIRES_VIRTUAL = "DIGITAL_CERTIFICATE_REQUIRES_VIRTUAL";

/** Signature requests: create, price, resend, re-expire and inspect assignments (workspace credentials). */
export class AssignmentsResource {
  /** Signer-facing operations reached through {@link sign} and {@link decline}. */
  private readonly signature: SignatureResource;

  constructor(private readonly http: HttpClient) {
    this.signature = new SignatureResource(http);
  }

  /**
   * `GET /assignments` — the workspace's assignments. Pass `accountId` unless
   * using OAuth, which selects its connected workspace. Query: `accountId`,
   * `sort`, `page`, `per-page` (1–100). Returns {@link Assignment}
   * objects with `X-Pagination-*` metadata.
   */
  async list(query: ListAssignmentsQuery = {}): Promise<Page<Assignment>> {
    return this.http.getPage<Assignment>(
      withQuery(paths.list(), {
        accountId: query.accountId,
        sort: query.sort,
        ...pageQuery(query.page, query.perPage),
      }),
    );
  }

  /**
   * `POST /documents/{documentId}/assignments` — request signatures.
   *
   * Request: `{ method: "virtual" | "collect", signers: [{ id,
   * verification_method?: "Email" | "Whatsapp" | "DigitalCertificate" | "IdDocumentFaceMatchBasic",
   * notification_methods?: ("Email" | "Whatsapp")[], step? }], entries?,
   * message?, expires_at?, copy_receivers? }`. `entries` (page placements) is
   * required for `collect`. The `signerIds`/`signer_ids` aliases are
   * normalized into `signers`. `DigitalCertificate` signers require
   * `method: "virtual"`. Response: the created {@link Assignment}, including
   * `signing_urls`.
   */
  async create(documentId: string, input: CreateAssignmentInput): Promise<Assignment> {
    const body = normalizeAssignmentInput(input);
    if (!Array.isArray(body.signers) || body.signers.length === 0) {
      throw new ConfigurationError("AssignmentsResource.create requires at least one signer");
    }
    if (input.method === "collect" && (!input.entries || input.entries.length === 0)) {
      throw new ConfigurationError("Collect assignments require at least one field entry");
    }
    assertDigitalCertificateMethod(input.method, body.signers);
    return this.http.post<Assignment>(paths.collection(documentId), {
      ...body,
      entries: collectEntries(input.entries),
    });
  }

  /**
   * `POST /documents/{documentId}/assignments/estimate-cost` — price an
   * assignment without creating it.
   *
   * Request sent: `{ method?, signers?: [{ verification_method?,
   * notification_methods? }], entries? }`. Signer ids do not affect cost and
   * are not sent; each `signer_ids`/`signerIds` alias entry counts as one
   * Email signer (`{}`). `signers` is required for `virtual` (and when
   * `method` is omitted) and `entries` for `collect`; both are checked before
   * the request. `DigitalCertificate` signers require `method: "virtual"`.
   * Response: {@link CostEstimate} — `documents`, `credits`,
   * `needs_extra_document`, `extra_document_cost`, `total_credits`,
   * `breakdown[]`, `document_balance`, `credit_balance`,
   * `has_sufficient_resources`, `blocking_reason`, `message`.
   */
  async estimateCost(documentId: string, input: EstimateAssignmentCostInput): Promise<CostEstimate> {
    const signers = (normalizeAssignmentInput(input).signers ?? []).map(
      ({ verification_method, notification_methods }) => ({ verification_method, notification_methods }),
    );
    if (input.method === "collect") {
      if (!input.entries?.length) {
        throw new ConfigurationError("AssignmentsResource.estimateCost requires entries for collect");
      }
    } else if (signers.length === 0) {
      throw new ConfigurationError("AssignmentsResource.estimateCost requires at least one signer");
    }
    assertDigitalCertificateMethod(input.method, signers);
    return this.http.post<CostEstimate>(paths.estimate(documentId), {
      method: input.method,
      ...(signers.length > 0 ? { signers } : {}),
      entries: input.entries,
    });
  }

  /**
   * `PUT /documents/{documentId}/assignments/{assignmentId}/signers/{signerId}/resend`
   * — resend the signature request on the signer's notification channel
   * (Email or WhatsApp). Response: `{ is_sent, document_id, signer_id }`.
   */
  resendToSigner(
    documentId: string,
    assignmentId: string,
    signerId: string,
  ): Promise<ResendNotificationResult> {
    return this.http.put<ResendNotificationResult>(paths.signerResend(documentId, assignmentId, signerId));
  }

  /**
   * `POST /documents/{documentId}/assignments/{assignmentId}/signers/{signerId}/estimate-resend-cost`
   * — price a resend before sending it. Response: {@link ResendCostEstimate},
   * with `total`, `breakdown`, nullable `credit_balance` and
   * `has_sufficient_credits`. A resend consumes no document.
   */
  estimateResendCost(
    documentId: string,
    assignmentId: string,
    signerId: string,
  ): Promise<ResendCostEstimate> {
    return this.http.post<ResendCostEstimate>(paths.signerResendEstimate(documentId, assignmentId, signerId));
  }

  /**
   * `PUT /documents/{documentId}/assignments/{assignmentId}/reset-expiration`
   * — set a new expiration or remove it. Request: `{ expires_at: string |
   * null }`; the key is always sent. Pass an ISO 8601 date-time at least one
   * hour ahead, or `null` to clear the expiration. Not allowed once the
   * document is closed. Response: the updated {@link Assignment}.
   */
  async resetExpiration(
    documentId: string,
    assignmentId: string,
    expiresAt: string | null,
  ): Promise<Assignment> {
    if (expiresAt !== null && typeof expiresAt !== "string") {
      throw new ConfigurationError("resetExpiration requires an ISO 8601 date-time or null");
    }
    return this.http.put<Assignment>(paths.resetExpiration(documentId, assignmentId), {
      expires_at: expiresAt,
    });
  }

  /**
   * Alias of {@link SignatureResource.sign}: submit signer-filled values with
   * the signer's access code (never the workspace credentials).
   */
  sign(documentId: string, assignmentId: string, accessCode: string, entries: SignFieldEntry[]): Promise<void> {
    return this.signature.sign(documentId, assignmentId, accessCode, entries);
  }

  /**
   * Alias of {@link SignatureResource.decline}: decline with the signer's
   * access code (never the workspace credentials).
   */
  decline(documentId: string, assignmentId: string, accessCode: string, declineReason: string): Promise<void> {
    return this.signature.decline(documentId, assignmentId, accessCode, declineReason);
  }

  /**
   * `GET /documents/{documentId}/assignments/{assignmentId}/whatsapp-notifications`
   * — the WhatsApp messages sent for an assignment, as rendered. Response:
   * `[{ sent_at, header, body, buttons: [{ text }], phone_number, signer_id }]`.
   * Sandbox/stage simulate delivery and include button URLs with signer access
   * and verification codes; production strips the URLs. Treat them as credentials.
   */
  whatsappNotifications(documentId: string, assignmentId: string): Promise<WhatsAppNotification[]> {
    return this.http.get<WhatsAppNotification[]>(paths.whatsappNotifications(documentId, assignmentId));
  }

  /**
   * `GET /documents/{documentId}/assignments/{assignmentId}/signers/{signerId}/identity-verification`
   * — the account's {@link SignerIdentityReview}, including evidence summaries
   * and available image names. Uses workspace credentials, never a signer code.
   */
  getSignerIdentityReview(documentId: string, assignmentId: string, signerId: string): Promise<SignerIdentityReview> {
    return this.http.get<SignerIdentityReview>(paths.identityVerification(documentId, assignmentId, signerId));
  }

  /**
   * `GET .../identity-verification/images/{name}` — raw JPEG, PNG or PDF
   * `Response`, sent with `Cache-Control: no-store`. Choose a name from the
   * review's `images`. Available only during `InReview`; after a decision,
   * the API returns `404`. Do not persist biometric evidence.
   */
  downloadSignerIdentityReviewImage(
    documentId: string, assignmentId: string, signerId: string, name: IdentityReviewImage,
  ): Promise<Response> {
    return this.http.rawRequest(
      `${paths.identityVerification(documentId, assignmentId, signerId)}/images/${encodeURIComponent(name)}`,
    );
  }

  /**
   * `POST .../identity-verification/review` — `{ decision: "Approved" |
   * "Rejected", note?: string | null }`; returns {@link SignerIdentityReview}.
   * Requires `InReview` and a document awaiting signatures or identity review.
   * Approval releases certification after every signer finishes and all reviews
   * pass. Rejection cancels the document and notifies signers/copy receivers.
   * The optional note (at most 2,000 characters) is never shown to signers.
   */
  async reviewSignerIdentity(
    documentId: string, assignmentId: string, signerId: string, input: ReviewSignerIdentityInput,
  ): Promise<SignerIdentityReview> {
    const { decision, note } = input;
    if (decision !== "Approved" && decision !== "Rejected") {
      throw new ConfigurationError('Identity review decision must be "Approved" or "Rejected"');
    }
    if (note !== undefined && note !== null && (typeof note !== "string" || [...note].length > 2000)) {
      throw new ConfigurationError("Identity review note must be null or a string of at most 2,000 characters");
    }
    return this.http.post<SignerIdentityReview>(
      `${paths.identityVerification(documentId, assignmentId, signerId)}/review`, { decision, note },
    );
  }
}

function assertDigitalCertificateMethod(
  method: CreateAssignmentInput["method"] | EstimateAssignmentCostInput["method"],
  signers: EstimateAssignmentSignerInput[] | undefined,
): void {
  if (method !== "virtual" && signers?.some(({ verification_method }) => verification_method === "DigitalCertificate")) {
    throw new ConfigurationError('DigitalCertificate signers require method: "virtual"', {
      code: DIGITAL_CERTIFICATE_REQUIRES_VIRTUAL,
    });
  }
}

/**
 * Normalize convenience aliases to the canonical assignment request shape,
 * merging signer ids with explicit signer settings and mapping `expiration`
 * to `expires_at`.
 */
function normalizeAssignmentInput(
  input: CreateAssignmentInput | EstimateAssignmentCostInput,
): Record<string, unknown> & { signers?: EstimateAssignmentSignerInput[] } {
  const { signerIds, signer_ids, signers, method } = input;
  const { expiration, expires_at, message, copy_receivers } = input as CreateAssignmentInput;
  const ids = [...(signer_ids ?? []), ...(signerIds ?? [])];
  const explicit = signers ?? [];
  const seen = new Set(explicit.map((s) => s.id).filter(Boolean));
  const fromIds = ids.flatMap((id) => {
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ id }];
  });
  const merged = [...explicit, ...fromIds].map((signer) => {
    const { id, step, verification_method, notification_methods } = signer as AssignmentSignerInput;
    return { id, step, verification_method, notification_methods };
  });
  return {
    method,
    message,
    copy_receivers,
    expires_at: expires_at === undefined ? expiration : expires_at,
    ...(merged.length > 0 ? { signers: merged } : {}),
  };
}

function collectEntries(entries: CreateAssignmentInput["entries"]): CreateAssignmentInput["entries"] {
  return entries == null ? entries : entries.map(({ page_id, fields }) => ({
    page_id,
    fields: fields == null ? fields : fields.map(({ signer_id, field_id, display_settings }) => {
      if (display_settings != null) {
        const { left, top, width, height, fontSize, fontFamily, backgroundColor } = display_settings;
        display_settings = { left, top, width, height, fontSize, fontFamily, backgroundColor };
      }
      return { signer_id, field_id, display_settings };
    }),
  }));
}
