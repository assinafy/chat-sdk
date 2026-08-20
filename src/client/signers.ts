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
  constructor(private readonly http: HttpClient) {}

  /** List signers for the given account, optionally filtered by `search`. */
  list(accountId: string, query: ListSignersQuery = {}): Promise<Page<Signer>> {
    return this.http.getPage<Signer>(
      withQuery(paths.collection(accountId), {
        search: query.search,
        sort: query.sort,
        page: query.page,
        "per-page": query.perPage,
      }),
    );
  }

  /** Convenience: page through every signer. Lazy via async iterator. */
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

  /** Create a new signer under the given account. */
  create(accountId: string, input: CreateSignerInput): Promise<Signer> {
    return this.http.post<Signer>(paths.collection(accountId), input);
  }

  /** Fetch a single signer by id. */
  get(accountId: string, signerId: string): Promise<Signer> {
    return this.http.get<Signer>(paths.item(accountId, signerId));
  }

  /** Update a signer. All fields are optional. */
  update(accountId: string, signerId: string, input: UpdateSignerInput): Promise<Signer> {
    return this.http.put<Signer>(paths.item(accountId, signerId), input);
  }

  /** Delete a signer. Returns `void`. */
  async remove(accountId: string, signerId: string): Promise<void> {
    await this.http.delete<unknown>(paths.item(accountId, signerId));
  }

  /**
   * Public flow: confirm/update signer data using a `signer-access-code`.
   * Used by the embeddable signer UI before the signer signs.
   *
   * The documented body fields are `full_name`, `email`, and `government_id`.
   * To accept the terms of use, call {@link SignatureResource.acceptTerms}.
   */
  confirmDataForDocument(
    documentId: string,
    accessCode: string,
    input: SignerSelfConfirmDataInput,
  ): Promise<Signer> {
    return this.http.put<Signer>(
      withQuery(paths.selfConfirmData(documentId), { "signer-access-code": accessCode }),
      input,
    );
  }
}
