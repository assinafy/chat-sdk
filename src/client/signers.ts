/**
 * Signer resource — represents a person who can be asked to sign a document.
 *
 * All account-scoped signer endpoints require either an API key or a bearer
 * token. The public signer-flow endpoints (self-lookup, accept-terms, post
 * signature image) are exposed via {@link SignatureResource} instead — they
 * take an unauthenticated `signer-access-code` query parameter.
 *
 * @see https://api.assinafy.com.br/v1/docs
 */

import { withQuery, type HttpClient } from "./http.js";
import { SignatureResource } from "./signature.js";
import { pageQuery, signerTransport, withAccessCode } from "./internal.js";
import type {
  CreateSignerInput,
  ListSignersQuery,
  Page,
  Signer,
  SignerSelfConfirmDataInput,
  UpdateSignerInput,
} from "./types.js";

/**
 * Build URLs for the signers resource. Kept as a small helper so the test
 * suite can verify URL shapes without going through the client.
 */
const paths = {
  collection: (accountId: string) => `/accounts/${encodeURIComponent(accountId)}/signers`,
  item: (accountId: string, signerId: string) =>
    `/accounts/${encodeURIComponent(accountId)}/signers/${encodeURIComponent(signerId)}`,
  selfConfirmData: (documentId: string) =>
    `/documents/${encodeURIComponent(documentId)}/signers/confirm-data`,
};

/** Authenticated CRUD for signers under a specific account. */
export class SignersResource {
  /** Credential-free transport for the signer-facing confirm-data operation. */
  private readonly signer: HttpClient;

  constructor(private readonly http: HttpClient) {
    this.signer = signerTransport(http);
  }

  /**
   * `GET /accounts/{accountId}/signers` — query `search`, `sort`, `page`,
   * `per-page`. Response: `Page<Signer>` (`{ resource, id, full_name, email,
   * whatsapp_phone_number, government_id, has_accepted_terms }`).
   */
  async list(accountId: string, query: ListSignersQuery = {}): Promise<Page<Signer>> {
    return this.http.getPage<Signer>(
      withQuery(paths.collection(accountId), {
        search: query.search,
        sort: query.sort,
        ...pageQuery(query.page, query.perPage),
      }),
    );
  }

  /** Page through every signer of {@link list} lazily (50 per request by default). */
  async *iterate(accountId: string, query: ListSignersQuery = {}): AsyncIterableIterator<Signer> {
    let page = query.page ?? 1;
    const perPage = query.perPage ?? 50;
    while (true) {
      const result = await this.list(accountId, { ...query, page, perPage });
      for (const signer of result.data) yield signer;
      if (page >= result.pagination.pageCount) return;
      page++;
    }
  }

  /**
   * `POST /accounts/{accountId}/signers` — request `{ full_name, email?,
   * whatsapp_phone_number?, government_id? }`. Response: the new {@link Signer}.
   */
  async create(accountId: string, input: CreateSignerInput): Promise<Signer> {
    const { full_name, email, whatsapp_phone_number, government_id } = input;
    return this.http.post<Signer>(paths.collection(accountId), { full_name, email, whatsapp_phone_number, government_id });
  }

  /** `GET /accounts/{accountId}/signers/{signerId}` — one {@link Signer}. */
  get(accountId: string, signerId: string): Promise<Signer> {
    return this.http.get<Signer>(paths.item(accountId, signerId));
  }

  /**
   * `PUT /accounts/{accountId}/signers/{signerId}` — request `{ full_name?,
   * email?, whatsapp_phone_number?, government_id? }`. Response: the updated
   * {@link Signer}.
   */
  async update(accountId: string, signerId: string, input: UpdateSignerInput): Promise<Signer> {
    const { full_name, email, whatsapp_phone_number, government_id } = input;
    return this.http.put<Signer>(paths.item(accountId, signerId), { full_name, email, whatsapp_phone_number, government_id });
  }

  /** `DELETE /accounts/{accountId}/signers/{signerId}` — resolves on success. */
  async remove(accountId: string, signerId: string): Promise<void> {
    await this.http.delete<unknown>(paths.item(accountId, signerId));
  }

  /**
   * `PUT /documents/{documentId}/signers/confirm-data` — the signer confirms
   * or updates their data before signing, authenticated by the access code
   * alone (a missing or blank code rejects before any request).
   *
   * Request sent: `{ full_name?, email?, government_id? }`. Response: the
   * {@link Signer} (`{ resource, id, full_name, email, whatsapp_phone_number,
   * government_id, has_accepted_terms }`).
   *
   * `has_accepted_terms: true` is not part of this operation: the SDK sends it
   * as a separate `PUT /signers/accept-terms` after the confirmation, which is
   * what digital-certificate signers need before `signature.signContext`.
   * `whatsapp_phone_number` is not accepted here and is ignored.
   */
  async confirmDataForDocument(
    documentId: string,
    accessCode: string,
    input: SignerSelfConfirmDataInput,
  ): Promise<Signer> {
    const { full_name, email, government_id, has_accepted_terms } = input;
    const signer = await this.signer.put<Signer>(
      withAccessCode(paths.selfConfirmData(documentId), accessCode),
      { full_name, email, government_id },
    );
    if (has_accepted_terms === true) await new SignatureResource(this.http).acceptTerms(accessCode);
    return signer;
  }
}
