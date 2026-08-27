/**
 * Assignments resource — connects a document to one or more signers and
 * triggers the signature workflow.
 *
 * @see https://api.assinafy.com.br/v1/docs
 */

import { withQuery, type HttpClient } from "./http.js";
import { ConfigurationError } from "./errors.js";
import { pageQuery } from "./internal.js";
import type {
  Assignment,
  CostEstimate,
  CreateAssignmentInput,
  EstimateAssignmentCostInput,
  ListAssignmentsQuery,
  Page,
  ResendNotificationResult,
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
  signerSubmit: (documentId: string, assignmentId: string) =>
    `/documents/${encodeURIComponent(documentId)}/assignments/${encodeURIComponent(assignmentId)}`,
  signerReject: (documentId: string, assignmentId: string) =>
    `/documents/${encodeURIComponent(documentId)}/assignments/${encodeURIComponent(assignmentId)}/reject`,
  whatsappNotifications: (documentId: string, assignmentId: string) =>
    `/documents/${encodeURIComponent(documentId)}/assignments/${encodeURIComponent(assignmentId)}/whatsapp-notifications`,
};

export class AssignmentsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * List the assignments belonging to the authenticated user's current
   * account.
   */
  list(query: ListAssignmentsQuery = {}): Promise<Page<Assignment>> {
    return this.http.getPage<Assignment>(
      withQuery(paths.list(), pageQuery(query.page, query.perPage)),
    );
  }

  /**
   * Create an assignment, attaching one or more signers to a document.
   *
   * `signers: [{ id }]` is the canonical request field and supports per-signer
   * verification, notification, and signing-order settings. The `signerIds`
   * and `signer_ids` convenience aliases are normalized to that field.
   */
  create(documentId: string, input: CreateAssignmentInput): Promise<Assignment> {
    const body = normalizeAssignmentInput(input);
    if (!Array.isArray(body.signers) || body.signers.length === 0) {
      throw new ConfigurationError("AssignmentsResource.create requires at least one signer");
    }
    if (input.method === "collect" && (!input.entries || input.entries.length === 0)) {
      throw new ConfigurationError("Collect assignments require at least one field entry");
    }
    return this.http.post<Assignment>(paths.collection(documentId), body);
  }

  /** Estimate the cost of an assignment without creating it. */
  estimateCost(documentId: string, input: EstimateAssignmentCostInput): Promise<CostEstimate> {
    return this.http.post<CostEstimate>(paths.estimate(documentId), normalizeAssignmentInput(input));
  }

  /** Resend the assignment notification to one signer. */
  resendToSigner(
    documentId: string,
    assignmentId: string,
    signerId: string,
  ): Promise<ResendNotificationResult> {
    return this.http.put<ResendNotificationResult>(paths.signerResend(documentId, assignmentId, signerId));
  }

  /** Estimate the cost of resending one signer's notification. */
  estimateResendCost(
    documentId: string,
    assignmentId: string,
    signerId: string,
  ): Promise<CostEstimate> {
    return this.http.post<CostEstimate>(paths.signerResendEstimate(documentId, assignmentId, signerId));
  }

  /**
   * Reset (extend) an assignment's expiration date. `expiresAt` must be an
   * ISO 8601 date-time — the API rejects the request with `400` if it is
   * omitted.
   */
  resetExpiration(documentId: string, assignmentId: string, expiresAt: string): Promise<Assignment> {
    return this.http.put<Assignment>(paths.resetExpiration(documentId, assignmentId), {
      expires_at: expiresAt,
    });
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
    entries: Array<{ itemId: string; fieldId: string; pageId: string; value: string }>,
  ): Promise<void> {
    await this.http.post<unknown>(
      withQuery(paths.signerSubmit(documentId, assignmentId), { "signer-access-code": accessCode }),
      entries,
    );
  }

  /** Decline an assignment using a signer access code. */
  async decline(
    documentId: string,
    assignmentId: string,
    accessCode: string,
    declineReason: string,
  ): Promise<void> {
    await this.http.put<unknown>(
      withQuery(paths.signerReject(documentId, assignmentId), { "signer-access-code": accessCode }),
      { decline_reason: declineReason },
    );
  }

  /** List rendered WhatsApp notifications sent for an assignment. */
  whatsappNotifications(documentId: string, assignmentId: string): Promise<WhatsAppNotification[]> {
    return this.http.get<WhatsAppNotification[]>(paths.whatsappNotifications(documentId, assignmentId));
  }
}

/**
 * Normalize convenience aliases to the canonical assignment request shape,
 * merging signer ids with explicit signer settings and mapping `expiration`
 * to `expires_at`.
 */
function normalizeAssignmentInput(
  input: CreateAssignmentInput | EstimateAssignmentCostInput,
): Record<string, unknown> {
  const { signerIds, signer_ids, signers, ...rawRest } = input;
  const { expiration, ...rest } = rawRest as typeof rawRest & { expiration?: string };
  const ids = [...(signer_ids ?? []), ...(signerIds ?? [])];
  const explicit = signers ?? [];
  const seen = new Set(explicit.map((s) => s.id).filter(Boolean));
  const fromIds = ids.flatMap((id) => {
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ id }];
  });
  const merged = [...explicit, ...fromIds];
  const expiresAt = "expires_at" in rest ? rest.expires_at : undefined;
  return {
    ...rest,
    ...(expiration !== undefined && expiresAt === undefined ? { expires_at: expiration } : {}),
    ...(merged.length > 0 ? { signers: merged } : {}),
  };
}
