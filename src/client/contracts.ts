/** Contract lifecycle tracking on workspace documents (`client.contracts`). */
import { ConfigurationError } from "./errors.js";
import { withQuery, type HttpClient } from "./http.js";
import { csv, pageQuery } from "./internal.js";
import type {
  DocumentContract,
  DocumentContractAmendment,
  DocumentContractInput,
  ListContractsQuery,
  Page,
  RenewContractInput,
  TerminateContractInput,
} from "./types.js";

const paths = {
  collection: (accountId: string) => `/accounts/${encodeURIComponent(accountId)}/contracts`,
  item: (accountId: string, documentId: string) =>
    `/accounts/${encodeURIComponent(accountId)}/documents/${encodeURIComponent(documentId)}/contract`,
};

/**
 * Read and maintain contract terms independently of document signing. Writes
 * require contract tracking on the workspace's plan; OAuth needs
 * `documents:read` for reads and `documents:write` for writes.
 */
export class ContractsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /accounts/{accountId}/contracts` — `Page<DocumentContract>` ordered
   * by most recently updated by default. Array statuses become comma-separated.
   * `ending_within_days: 0` means today in Brasília; `expand: "document"`
   * embeds each document. Page by `updated_at` to reconcile missed events.
   */
  async list(accountId: string, query: ListContractsQuery = {}): Promise<Page<DocumentContract>> {
    return this.http.getPage<DocumentContract>(withQuery(paths.collection(accountId), {
      status: csv(query.status),
      counterparty: query.counterparty,
      search: query.search,
      end_date_from: query.end_date_from,
      end_date_to: query.end_date_to,
      ending_within_days: query.ending_within_days,
      external_system: query.external_system,
      external_id: query.external_id,
      sort: query.sort,
      expand: query.expand,
      ...pageQuery(query.page, query.perPage),
    }));
  }

  /**
   * `GET /accounts/{accountId}/documents/{documentId}/contract` — the
   * {@link DocumentContract} with amendments, or this document's
   * {@link DocumentContractAmendment}. No body; `404` when no terms exist.
   * Reads remain available after the workspace's plan lapses.
   */
  get(accountId: string, documentId: string): Promise<DocumentContract | DocumentContractAmendment> {
    return this.http.get(paths.item(accountId, documentId));
  }

  /**
   * `PUT /accounts/{accountId}/documents/{documentId}/contract` — create or
   * partially update terms with {@link DocumentContractInput}; returns the
   * saved contract or amendment. Only supplied attributes change; external
   * references replace the list. Send the read `updated_at` to reject stale
   * writes with `409` (`ContractChanged`).
   *
   * `parent_document_id` links an amendment, renewal or termination; its delta
   * applies on certification in signing order. On a pending amendment, `null`
   * drops a delta key; `parent_document_id: null` unlinks it. Applied amendments
   * are read-only. This operation does not upload or sign a document.
   */
  async update(
    accountId: string,
    documentId: string,
    input: DocumentContractInput,
  ): Promise<DocumentContract | DocumentContractAmendment> {
    const {
      status, counterparty_name, counterparty_taxpayer_id, value, currency,
      start_date, end_date, auto_renew, renewal_term_months, notice_period_days,
      owner_id, metadata, external_references, parent_document_id, relation_type, updated_at,
    } = input;
    return this.http.put(paths.item(accountId, documentId), {
      status, counterparty_name, counterparty_taxpayer_id, value, currency,
      start_date, end_date, auto_renew, renewal_term_months, notice_period_days,
      owner_id, metadata,
      external_references: external_references?.map(({ system, id }) => ({ system, id }))
        ?? external_references,
      parent_document_id, relation_type, updated_at,
    });
  }

  /**
   * `GET /accounts/{accountId}/documents/{documentId}/contract/related` —
   * the root {@link DocumentContract} and all its amendments, from either
   * the root document or any linked instrument. No request body.
   */
  related(accountId: string, documentId: string): Promise<DocumentContract> {
    return this.http.get(`${paths.item(accountId, documentId)}/related`);
  }

  /**
   * `POST /accounts/{accountId}/documents/{documentId}/contract/renew` —
   * start the next term; returns {@link DocumentContract}. Send the current
   * `term` or a later explicit `end_date` so repeats cannot renew twice.
   * Optional `value: null` clears the value; `updated_at` guards against stale
   * writes. An expired contract can reopen; a terminated one returns `400`.
   * The transport never retries this mutation automatically.
   */
  async renew(accountId: string, documentId: string, input: RenewContractInput): Promise<DocumentContract> {
    const { end_date, value, term, updated_at } = input;
    if (!(typeof end_date === "string" && end_date.trim())
      && !(typeof term === "number" && Number.isInteger(term) && term >= 1)) {
      throw new ConfigurationError("Contract renewal requires the current term or a new end_date");
    }
    return this.http.post(`${paths.item(accountId, documentId)}/renew`, {
      end_date, value, term, updated_at,
    });
  }

  /**
   * `POST /accounts/{accountId}/documents/{documentId}/contract/terminate`
   * — close the contract and stop its lifecycle alerts; returns
   * {@link DocumentContract}. Optional `{ reason, updated_at }`; reason is
   * recorded in the activity event. Does not cancel the signing document.
   */
  async terminate(
    accountId: string,
    documentId: string,
    input: TerminateContractInput = {},
  ): Promise<DocumentContract> {
    const { reason, updated_at } = input;
    return this.http.post(`${paths.item(accountId, documentId)}/terminate`, { reason, updated_at });
  }
}
