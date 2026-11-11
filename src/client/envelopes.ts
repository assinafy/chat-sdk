/** Documents sent together to the same signers (`client.envelopes`). */
import { withQuery, type HttpClient } from "./http.js";
import { collectEntries, pageQuery } from "./internal.js";
import type { CostEstimate, DocumentArtifactName, Page } from "./types.js";
import type {
  AddEnvelopeDocumentInput,
  CreateEnvelopeInput,
  DocumentEnvelope,
  EnvelopeActivity,
  EnvelopeCancellationResult,
  EnvelopeDocumentInput,
  EnvelopeResendResult,
  ListEnvelopesQuery,
  UpdateEnvelopeInput,
} from "./envelope-types.js";

const paths = {
  collection: (accountId: string) => `/accounts/${encodeURIComponent(accountId)}/envelopes`,
  item: (accountId: string, envelopeId: string) =>
    `${paths.collection(accountId)}/${encodeURIComponent(envelopeId)}`,
};

/** Workspace envelope lifecycle. Writes can send notifications and consume credits. */
export class EnvelopesResource {
  constructor(private readonly http: HttpClient) {}

  /** `GET /accounts/{accountId}/envelopes` — newest first, with document status counts and pagination. */
  async list(accountId: string, query: ListEnvelopesQuery = {}): Promise<Page<DocumentEnvelope>> {
    return this.http.getPage(withQuery(paths.collection(accountId), {
      search: query.search, status: query.status, ...pageQuery(query.page, query.perPage),
    }));
  }

  /**
   * `POST /accounts/{accountId}/envelopes` — create from ready documents and
   * send one invitation per signer. A 200 confirms creation, not delivery.
   * One document credit is charged for the envelope; identity/notification
   * costs apply once per signer and certificate costs apply per document.
   * An optional idempotency key belongs to the workspace and does not expire:
   * a manual retry with the same key returns the original envelope, regardless
   * of the body. The SDK never retries creation automatically.
   */
  async create(
    accountId: string,
    input: CreateEnvelopeInput,
    options: { idempotencyKey?: string } = {},
  ): Promise<DocumentEnvelope> {
    return this.http.post(paths.collection(accountId), envelopeFields(input), {
      headers: options.idempotencyKey === undefined ? {} : { "Idempotency-Key": options.idempotencyKey },
    });
  }

  /** `POST .../envelopes/estimate-cost` — validate and price the creation body without charging or sending. */
  async estimateCost(accountId: string, input: CreateEnvelopeInput): Promise<CostEstimate> {
    return this.http.post(`${paths.collection(accountId)}/estimate-cost`, envelopeFields(input));
  }

  /** `GET .../envelopes/{envelopeId}` — document order, signing progress, artifacts and links. */
  get(accountId: string, envelopeId: string): Promise<DocumentEnvelope> {
    return this.http.get(paths.item(accountId, envelopeId));
  }

  /**
   * `DELETE .../envelopes/{envelopeId}` — remove a closed envelope. Its
   * documents and artifacts remain. An open envelope returns 409 EnvelopeOpen.
   */
  async remove(accountId: string, envelopeId: string): Promise<void> {
    await this.http.delete(paths.item(accountId, envelopeId));
  }

  /** `PATCH .../envelopes/{envelopeId}` — change name, message or complete document order; sends nothing. */
  async update(accountId: string, envelopeId: string, input: UpdateEnvelopeInput): Promise<DocumentEnvelope> {
    const { name, message, document_ids } = input;
    return this.http.patch(paths.item(accountId, envelopeId), { name, message, document_ids });
  }

  /** `GET .../envelopes/{envelopeId}/activities` — paginated document activities, including removed documents. */
  async activities(
    accountId: string,
    envelopeId: string,
    query: { sort?: string; page?: number; perPage?: number } = {},
  ): Promise<Page<EnvelopeActivity>> {
    return this.http.getPage(withQuery(`${paths.item(accountId, envelopeId)}/activities`, {
      sort: query.sort, ...pageQuery(query.page, query.perPage),
    }));
  }

  /** `GET .../envelopes/{envelopeId}/download/{artifactName}` — raw ZIP, in document order; 404 if none has the artifact. */
  download(accountId: string, envelopeId: string, artifactName: DocumentArtifactName): Promise<Response> {
    return this.http.rawRequest(`${paths.item(accountId, envelopeId)}/download/${encodeURIComponent(artifactName)}`);
  }

  /** `PUT .../envelopes/{envelopeId}/cancel` — cancel eligible documents and notify participants; closed documents stay unchanged. */
  cancel(accountId: string, envelopeId: string): Promise<EnvelopeCancellationResult[]> {
    return this.http.put(`${paths.item(accountId, envelopeId)}/cancel`);
  }

  /** `PUT .../envelopes/{envelopeId}/signers/{signerId}/resend` — one reminder for the whole envelope; paid channels are charged. */
  resendToSigner(accountId: string, envelopeId: string, signerId: string): Promise<EnvelopeResendResult> {
    return this.http.put(`${paths.item(accountId, envelopeId)}/signers/${encodeURIComponent(signerId)}/resend`);
  }

  /**
   * `POST .../envelopes/{envelopeId}/documents` — add a ready document for
   * existing envelope signers, up to 20 documents. Sends their invitation
   * again; charges only this document's digital-certificate signatures.
   */
  async addDocument(accountId: string, envelopeId: string, input: AddEnvelopeDocumentInput): Promise<DocumentEnvelope> {
    return this.http.post(`${paths.item(accountId, envelopeId)}/documents`, {
      ...documentFields(input), max_total_credits: input.max_total_credits,
    });
  }

  /** `DELETE .../envelopes/{envelopeId}/documents/{documentId}` — cancel and remove an open document; notifies its participants. */
  removeDocument(accountId: string, envelopeId: string, documentId: string): Promise<DocumentEnvelope> {
    return this.http.delete(`${paths.item(accountId, envelopeId)}/documents/${encodeURIComponent(documentId)}`);
  }
}

function envelopeFields(input: CreateEnvelopeInput): CreateEnvelopeInput {
  const { name, message, max_total_credits, signers, documents } = input;
  return {
    name, message, max_total_credits,
    signers: signers.map(({ id, verification_method, notification_methods, embedded }) => ({
      id, verification_method, notification_methods, embedded,
    })),
    documents: documents.map(documentFields),
  };
}

function documentFields(input: EnvelopeDocumentInput): EnvelopeDocumentInput {
  const { id, method, entries, signer_ids, expires_at, copy_receiver_ids } = input;
  return { id, method, entries: collectEntries(entries), signer_ids, expires_at, copy_receiver_ids };
}
