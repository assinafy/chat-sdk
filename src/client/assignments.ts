/**
 * Assignments resource — connects a document to one or more signers and
 * triggers the signature workflow.
 *
 * @see https://api.assinafy.com.br/v1/docs
 */

import { HttpClient, withQuery } from "./http.js";
import type {
  Assignment,
  CostEstimate,
  CreateAssignmentInput,
  ListAssignmentsQuery,
  Page,
  ResendCostEstimate,
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
   * List the assignments belonging to the authenticated user's **current
   * account**.
   *
   * Note: the API derives the account from a user session, so this endpoint
   * requires a bearer access token. Requests authenticated with an API key
   * return `400` (no current-account context); use the per-document assignment
   * data on {@link DocumentsResource.get} in that case.
   */
  list(query: ListAssignmentsQuery = {}): Promise<Page<Assignment>> {
    return this.http.getPage<Assignment>(
      withQuery(paths.list(), { page: query.page, "per-page": query.perPage }),
    );
  }

  /**
   * Create an assignment, attaching one or more signers to a document.
   *
   * Prefer `signers: [{ id }]` so verification and notification methods can be
   * configured per signer. The `signerIds` / `signer_ids` convenience aliases
   * are expanded into `signers: [{ id }]` (the API's documented field) before
   * sending.
   */
  create(documentId: string, input: CreateAssignmentInput): Promise<Assignment> {
    return this.http.post<Assignment>(paths.collection(documentId), normalizeAssignmentInput(input));
  }

  /** Estimate the cost of an assignment without creating it. */
  estimateCost(documentId: string, input: CreateAssignmentInput): Promise<CostEstimate> {
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
  ): Promise<ResendCostEstimate> {
    return this.http.post<ResendCostEstimate>(paths.signerResendEstimate(documentId, assignmentId, signerId));
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

  /** Submit signer-filled field values using a signer access code. */
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
 * Normalize the create/estimate body to the API's documented shape. The API
 * only recognizes `signers: [{ id, … }]`; a bare `signer_ids` / `signerIds`
 * array is silently ignored (the request then fails with "at least one signer
 * is required"). We therefore expand any id array into `signers` entries and
 * merge them with an explicit `signers` list.
 */
function normalizeAssignmentInput(input: CreateAssignmentInput): Record<string, unknown> {
  const { signerIds, signer_ids, signers, ...rest } = input;
  const ids = signer_ids ?? signerIds ?? [];
  const explicit = signers ?? [];
  const seen = new Set(explicit.map((s) => s.id).filter(Boolean));
  const fromIds = ids.filter((id) => !seen.has(id)).map((id) => ({ id }));
  const merged = [...explicit, ...fromIds];
  return {
    ...rest,
    ...(merged.length > 0 ? { signers: merged } : {}),
  };
}
