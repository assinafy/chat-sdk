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
  ResendCostEstimate,
  ResendNotificationResult,
  WhatsAppNotification,
} from "./types.js";

const paths = {
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
   * Create an assignment, attaching one or more signers to a document.
   *
   * Prefer `signers: [{ id }]` so verification and notification methods can
   * be configured per signer. The SDK also accepts the older `signerIds`
   * convenience alias and sends it to the API as `signer_ids`.
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

  /** Reset or extend an assignment expiration date. */
  resetExpiration(
    documentId: string,
    assignmentId: string,
    expiresAt?: string,
  ): Promise<Assignment> {
    return this.http.put<Assignment>(
      paths.resetExpiration(documentId, assignmentId),
      expiresAt ? { expires_at: expiresAt } : undefined,
    );
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

function normalizeAssignmentInput(input: CreateAssignmentInput): CreateAssignmentInput {
  const { signerIds, ...rest } = input;
  return {
    ...rest,
    signer_ids: input.signer_ids ?? signerIds,
  };
}
