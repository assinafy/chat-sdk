/**
 * Shared types for the Assinafy API surface.
 *
 * The HTTP layer unwraps Assinafy's `{ status, message, data }` envelope, so
 * resource methods return the `data` shape directly. Types intentionally keep
 * room for new server fields with index signatures where the API returns
 * event- or field-specific data.
 *
 * @see https://api.assinafy.com.br/v1/docs
 */

/** Canonical envelope returned by Assinafy endpoints. */
export interface ApiEnvelope<T> {
  status: number;
  message: string;
  data: T;
}

/** Pagination details surfaced via `X-Pagination-*` response headers. */
export interface Pagination {
  currentPage: number;
  pageCount: number;
  perPage: number;
  totalCount: number;
}

/** A paginated list wrapper returned by resource `list()` methods. */
export interface Page<T> {
  data: T[];
  pagination: Pagination;
}

/** Rate-limit metadata surfaced via `X-Rate-Limit-*` headers. */
export interface RateLimit {
  limit: number;
  remaining: number;
  resetSeconds: number;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Email/password login request. */
export interface LoginInput {
  email: string;
  password: string;
}

/** Login response containing the bearer access token and user context. */
export interface LoginResponse {
  access_token: string;
  expires_at?: string;
  user?: Record<string, unknown>;
  accounts?: Array<Record<string, unknown>>;
}

/** Social-provider login request. */
export interface SocialLoginInput {
  provider: string;
  token: string | Record<string, unknown>;
  has_accepted_terms: boolean;
}

/** API key payload returned by create/get API-key endpoints. */
export interface ApiKeyRecord {
  api_key: string;
}

/** Change-password request. */
export interface ChangePasswordInput {
  email: string;
  password: string;
  new_password: string;
}

/** Request-password-reset request. */
export interface RequestPasswordResetInput {
  email: string;
}

/** Reset-password request. */
export interface ResetPasswordInput {
  email: string;
  token?: string;
  new_password: string;
}

// ---------------------------------------------------------------------------
// Signers
// ---------------------------------------------------------------------------

/** Verification method codes accepted by assignment/template APIs. */
export type VerificationMethod = "Email" | "Whatsapp" | (string & {});

/** Notification channel codes accepted by assignment/template APIs. */
export type NotificationMethod = "Email" | "Whatsapp" | (string & {});

/** A signer profile. */
export interface Signer {
  resource?: string;
  id: string;
  full_name: string;
  email: string | null;
  whatsapp_phone_number?: string | null;
  has_accepted_terms: boolean;
  has_signature?: boolean;
  has_initial?: boolean;
  completed?: boolean;
  notification_history?: unknown[];
  verification_method?: VerificationMethod;
  notification_methods?: NotificationMethod[];
  step?: number;
  notified?: boolean;
  [key: string]: unknown;
}

/** Signer creation request. */
export interface CreateSignerInput {
  full_name: string;
  email?: string;
  whatsapp_phone_number?: string;
}

/** Signer update request. */
export type UpdateSignerInput = Partial<CreateSignerInput>;

/** Query accepted by signer list endpoints. */
export interface ListSignersQuery {
  search?: string;
  sort?: string;
  page?: number;
  perPage?: number;
}

/** Signer data-confirmation request. */
export interface SignerSelfConfirmDataInput {
  full_name?: string;
  email?: string;
  whatsapp_phone_number?: string;
  has_accepted_terms?: boolean;
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

/** Document lifecycle status codes. */
export type DocumentStatusCode =
  | "uploading"
  | "uploaded"
  | "metadata_processing"
  | "metadata_ready"
  | "expired"
  | "certificating"
  | "certificated"
  | "rejected_by_signer"
  | "pending_signature"
  | "rejected_by_user"
  | "failed"
  | (string & {});

/** One entry from `GET /documents/statuses`. */
export interface DocumentStatus {
  code: DocumentStatusCode;
  deletable: boolean;
}

/** Page metadata embedded in document responses. */
export interface DocumentPage {
  id: string;
  number: number;
  height: number;
  width: number;
  download_url: string;
}

/** Downloadable document artifacts. */
export interface DocumentArtifacts {
  original?: string;
  thumbnail?: string;
  certificated?: string;
  "certificate-page"?: string;
  bundle?: string;
  [key: string]: string | undefined;
}

/** Assignment method codes. */
export type AssignmentMethod = "virtual" | "collect" | (string & {});

/** Assignment field value item. */
export interface AssignmentItem {
  id: string;
  page: DocumentPage | number | null;
  signer: Signer | null;
  field: FieldDefinition | { id: string; name: string; type: string; [key: string]: unknown } | null;
  display_settings: unknown;
  value: unknown;
  completed: boolean;
}

/** Assignment completion summary. */
export interface AssignmentSummary {
  signer_count: number;
  completed_count: number;
  signers: Array<
    Pick<Signer, "id" | "full_name" | "email" | "whatsapp_phone_number" | "has_accepted_terms"> & {
      completed: boolean;
    }
  >;
}

/** Signature-request assignment. */
export interface Assignment {
  resource?: string;
  id: string;
  document_id?: string;
  sender_email?: string;
  method: AssignmentMethod | null;
  status?: string;
  expiration?: string | null;
  expires_at?: string | null;
  message?: string | null;
  signers: Signer[];
  copy_receivers?: Signer[];
  items: AssignmentItem[];
  summary: AssignmentSummary;
  signing_urls?: Array<{ signer_id: string; url: string }>;
  completed_at?: string | number | null;
  created_at?: string | number;
  updated_at?: string | number;
  [key: string]: unknown;
}

/** Document object returned by document and signer-document endpoints. */
export interface Document {
  resource?: string;
  id: string;
  account_id: string;
  template_id?: string | null;
  name: string;
  status: DocumentStatusCode;
  artifacts: DocumentArtifacts;
  is_closed: boolean;
  signing_url?: string | null;
  decline_reason?: string | null;
  declined_by?: Signer | string | null;
  tags?: Tag[];
  created_at: string | number;
  updated_at?: string | number;
  current_signer?: Signer;
  assignment?: Assignment | null;
  pages?: DocumentPage[];
  [key: string]: unknown;
}

/** Public document summary returned by unauthenticated public-document endpoints. */
export interface PublicDocument {
  resource?: string;
  id: string;
  name: string;
  page_count: string | number | null;
  created_by?: string | null;
  [key: string]: unknown;
}

/** Result returned by public document signature-hash verification. */
export interface DocumentVerificationResult {
  hash: string;
  id: string | null;
  status: DocumentStatusCode | null;
  page_count: string | number | null;
  signer_count: string | number | null;
  completed_count: number | null;
  completed_at: string | null;
  verified_at: string;
  is_valid: boolean;
  message: string;
}

/** Query accepted by account document lists. */
export interface ListDocumentsQuery {
  status?: DocumentStatusCode | DocumentStatusCode[];
  method?: AssignmentMethod;
  search?: string;
  tags?: string | string[];
  sort?: string;
  page?: number;
  perPage?: number;
}

/** Query accepted by signer-facing document lists. */
export interface ListSignerDocumentsQuery extends ListDocumentsQuery {}

/** Input for uploading a document via multipart/form-data. */
export interface UploadDocumentInput {
  filename: string;
  body: Blob | ArrayBuffer | Uint8Array;
  contentType?: string;
  tags?: string[];
}

/** One row from a document activity log. */
export interface DocumentActivity {
  id: string | number;
  event?: string;
  type?: string;
  message?: string | null;
  payload?: unknown;
  origin?: Record<string, unknown> | string | null;
  actor?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  created_at: string;
}

/** Public document token request. */
export interface SendPublicTokenInput {
  recipient: string;
  channel: "email" | "whatsapp" | (string & {});
}

/** Public document token response. */
export interface SendPublicTokenResult {
  document: PublicDocument | Record<string, unknown>;
  channel: string;
  recipient: string;
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

/** Workspace tag. */
export interface Tag {
  resource?: string;
  id: string;
  name: string;
  color?: string | null;
  created_at?: string;
  updated_at?: string;
}

/** Tag list query. */
export interface ListTagsQuery {
  search?: string;
  sort?: string;
  page?: number;
  perPage?: number;
}

/** Tag creation request. */
export interface CreateTagInput {
  name: string;
  color?: string | null;
}

/** Tag update request. */
export type UpdateTagInput = Partial<CreateTagInput>;

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** Template object. */
export interface Template {
  resource?: string;
  id: string;
  name: string;
  document_name?: string | null;
  message?: string | null;
  status?: string;
  pages?: TemplatePage[];
  roles?: TemplateRole[];
  tags?: Tag[];
  default_document_tags?: Array<Pick<Tag, "id" | "name">>;
  created_at?: string;
  updated_at?: string;
}

/** Page entry embedded in a template. */
export interface TemplatePage {
  id: string;
  number: number;
  height: number;
  width: number;
  download_url?: string;
  fields?: TemplateField[];
}

/** Field placement embedded in a template page. */
export interface TemplateField {
  id: string;
  field_id?: string;
  role_id?: string;
  name?: string;
  label?: string;
  type?: string;
  display_settings?: unknown;
  is_required?: boolean;
}

/** Role defined by a template. */
export interface TemplateRole {
  id: string;
  name: string;
  assignment_type?: string;
  created_at?: string;
  updated_at?: string;
}

/** Signer binding used when creating a document from a template. */
export interface TemplateSignerInput {
  role_id?: string;
  id?: string;
  full_name?: string;
  email?: string;
  whatsapp_phone_number?: string;
  step?: number;
  verification_method?: VerificationMethod;
  notification_methods?: NotificationMethod[];
}

/** Editor-filled template field value. */
export interface TemplateEditorFieldInput {
  field_id: string;
  value: unknown;
}

/** Create-document-from-template request. */
export interface CreateDocumentFromTemplateInput {
  signers: TemplateSignerInput[];
  editor_fields?: TemplateEditorFieldInput[] | Record<string, unknown>;
  name?: string;
  message?: string;
  expires_at?: string;
  tags?: string[];
}

/** Detailed cost estimate returned by assignment/template estimate endpoints. */
export interface CostEstimate {
  documents?: number;
  credits?: number;
  needs_extra_document?: boolean;
  extra_document_cost?: number;
  total_credits?: number;
  breakdown?: Array<{
    code: string;
    name: string;
    cost: number;
    quantity?: number;
    unit_cost?: number;
  }>;
  document_balance?: number;
  credit_balance?: number;
  has_sufficient_resources?: boolean;
  blocking_reason?: "PendingPayment" | "InsufficientDocuments" | "InsufficientCredits" | string | null;
  message?: string | null;
  total?: number;
  currency?: string;
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

/** Per-signer assignment configuration. */
export interface AssignmentSignerInput {
  id?: string;
  step?: number;
  verification_method?: VerificationMethod;
  notification_methods?: NotificationMethod[];
}

/** One field placement inside a collect assignment entry. */
export interface AssignmentFieldInput {
  signer_id: string;
  field_id: string;
  display_settings: Record<string, unknown>;
}

/** One page entry for collect assignments. */
export interface AssignmentEntryInput {
  page_id: string;
  fields: AssignmentFieldInput[];
}

/** Create/estimate assignment request. */
export interface CreateAssignmentInput {
  method?: AssignmentMethod;
  /** @deprecated Use `signer_ids`; kept for older callers. */
  signerIds?: string[];
  signer_ids?: string[];
  signers?: AssignmentSignerInput[];
  entries?: AssignmentEntryInput[];
  message?: string;
  expiration?: string;
  expires_at?: string;
  copy_receivers?: string[];
}

/** Resend notification response. */
export interface ResendNotificationResult {
  is_sent: boolean;
  document_id: string;
  signer_id: string;
}

/** Cost estimate for resending one notification. */
export interface ResendCostEstimate {
  total: number;
  breakdown: Array<{ code: string; name: string; cost: number }>;
  credit_balance: number;
  has_sufficient_credits: boolean;
}

/** Rendered WhatsApp notification row. */
export interface WhatsAppNotification {
  sent_at: number;
  header: string;
  body: string;
  buttons: Array<{ text: string; url?: string }>;
  phone_number: string;
  signer_id: string;
}

/** One signer-filled field value submitted to the sign endpoint. */
export interface SignFieldEntry {
  itemId: string;
  fieldId: string;
  pageId: string;
  value: string;
}

// ---------------------------------------------------------------------------
// Fields
// ---------------------------------------------------------------------------

/** Workspace field definition. */
export interface FieldDefinition {
  resource?: string;
  id: string;
  name: string;
  type: string;
  regex?: string | null;
  is_pre_defined?: boolean;
  is_active: boolean;
  is_required?: boolean;
  is_standard?: boolean;
  is_read_only?: boolean;
  is_visible?: boolean;
}

/** Field-definition list query. */
export interface ListFieldsQuery {
  include_inactive?: boolean;
  include_standard?: boolean;
  search?: string;
  sort?: string;
  page?: number;
  perPage?: number;
}

/** Field-definition creation request. */
export interface CreateFieldInput {
  type: string;
  name: string;
  regex?: string;
  is_required?: boolean;
  is_active?: boolean;
}

/** Field-definition update request. */
export interface UpdateFieldInput {
  type?: string;
  name?: string;
  regex?: string | null;
  is_required?: boolean;
  is_active?: boolean;
}

/** Supported field type. */
export interface FieldType {
  type: string;
  name: string;
}

/** Single field validation result. */
export interface FieldValidationResult {
  field_id?: string;
  type?: string;
  success: boolean;
  error_message: string;
}

/** Entry for multi-field validation. */
export interface ValidateFieldEntry {
  field_id: string;
  value: unknown;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

/** Known webhook event names. New events are accepted as strings. */
export type WebhookEventType =
  | "document_uploaded"
  | "document_metadata_ready"
  | "document_prepared"
  | "assignment_created"
  | "document_ready"
  | "signature_requested"
  | "signer_created"
  | "signer_email_verified"
  | "signer_whatsapp_verified"
  | "signer_data_confirmed"
  | "signer_viewed_document"
  | "signer_signed_document"
  | "signer_rejected_document"
  | "user_rejected_document"
  | "document_processing_failed"
  | "template_created"
  | "template_processed"
  | "template_processing_failed"
  | (string & {});

/** Webhook subscription upsert request. */
export interface WebhookSubscriptionInput {
  events: WebhookEventType[];
  is_active: boolean;
  url: string;
  email: string;
}

/** Webhook subscription response. */
export interface WebhookSubscription extends WebhookSubscriptionInput {
  id?: string;
  created_at?: string;
  updated_at?: string;
}

/** Webhook event type metadata. */
export interface WebhookEventTypeInfo {
  id: WebhookEventType;
  description: string;
}

/** Webhook dispatch history row. */
export interface WebhookDispatch {
  resource?: string;
  id: string;
  event: WebhookEventType;
  activity_id: number;
  endpoint: string | null;
  payload: Record<string, unknown> | null;
  delivered: boolean;
  http_status: number | null;
  response_body: string | null;
  error: string | null;
  created_at: number;
  updated_at?: number;
}

/** Webhook dispatch list query. */
export interface ListWebhookDispatchesQuery {
  event?: WebhookEventType;
  delivered?: boolean | "true" | "false";
  from?: number;
  to?: number;
  page?: number;
  perPage?: number;
}
