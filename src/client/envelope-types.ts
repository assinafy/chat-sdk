import type {
  AssignmentEntryInput,
  DocumentActivity,
  DocumentStatusCode,
  NotificationMethod,
  SigningUrl,
  VerificationMethod,
} from "./types.js";

/** A signer shared by the envelope's documents. Envelope signing has no steps. */
export interface EnvelopeSignerInput {
  id: string;
  verification_method?: VerificationMethod;
  notification_methods?: NotificationMethod[];
  embedded?: boolean;
}

/** An uploaded, metadata-ready document and its envelope signer bindings. */
export interface EnvelopeDocumentInput {
  id: string;
  method?: "virtual" | "collect";
  /** Required for collect; each signer must own at least one placed field. */
  entries?: AssignmentEntryInput[];
  signer_ids: string[];
  /** ISO 8601 or Unix seconds; null, zero or empty text means no expiration. */
  expires_at?: string | number | null;
  copy_receiver_ids?: string[];
}

/** Create or estimate an envelope: 1–20 existing signers and 1–20 ready documents. */
export interface CreateEnvelopeInput {
  name: string;
  message?: string | null;
  /** Refuse the whole creation with 409 when its cost exceeds this ceiling. */
  max_total_credits?: number;
  signers: EnvelopeSignerInput[];
  documents: EnvelopeDocumentInput[];
}

/** Add a document for existing envelope signers; its invitation is sent again. */
export interface AddEnvelopeDocumentInput extends EnvelopeDocumentInput {
  max_total_credits?: number;
}

/** Change the envelope without sending a notification. */
export interface UpdateEnvelopeInput {
  name?: string;
  message?: string | null;
  /** Every current document exactly once, in the desired order. */
  document_ids?: string[];
}

/** Workspace envelope filters and pagination. */
export interface ListEnvelopesQuery {
  search?: string;
  status?: "open" | "closed";
  page?: number;
  perPage?: number;
}

/** One document's signing progress inside an envelope. */
export interface EnvelopeDocument {
  id: string;
  position: number;
  name: string;
  status: DocumentStatusCode;
  /** List responses contain only the thumbnail; detail responses contain all available artifacts. */
  artifacts: Record<string, string>;
  signers: Array<{
    id: string;
    full_name: string;
    email: string | null;
    whatsapp_phone_number: string | null;
    completed: boolean;
    signed_at: string | null;
  }>;
}

/** Documents sent together; every document keeps its own assignment and status. */
export interface DocumentEnvelope {
  resource?: string;
  id: string;
  name: string;
  message: string | null;
  documents: EnvelopeDocument[];
  /** Counts by document status; null when no document remains. */
  counts: Record<string, number> | null;
  signing_urls: SigningUrl[];
  created_at: string;
}

/** An envelope activity names the document whose activity it records. */
export interface EnvelopeActivity extends DocumentActivity {
  document_id: string;
  document_name: string;
}

/** Result for each document of an envelope cancellation. */
export interface EnvelopeCancellationResult {
  id: string;
  status: DocumentStatusCode;
  cancelled: boolean;
}

/** Result of sending an envelope reminder through the signer's configured channel. */
export interface EnvelopeResendResult {
  is_sent: boolean;
  envelope_id: string;
  signer_id: string;
}
