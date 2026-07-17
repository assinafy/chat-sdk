/**
 * Accounts resource — workspace accounts (organizations): profile, theme, logo.
 *
 * An account is the top-level container every other resource is scoped to. The
 * authenticated principal (API key or bearer token) may belong to one or more
 * accounts; {@link AccountsResource.list} enumerates them.
 *
 * @see https://api.assinafy.com.br/v1/docs
 */

import { HttpClient } from "./http.js";
import { toBlobPart } from "./internal.js";
import type {
  Account,
  AccountTheme,
  CreateAccountInput,
  DeleteAccountInput,
  UpdateAccountInput,
} from "./types.js";

const paths = {
  collection: () => `/accounts`,
  item: (accountId: string) => `/accounts/${encodeURIComponent(accountId)}`,
  theme: (accountId: string) => `/accounts/${encodeURIComponent(accountId)}/theme`,
  logo: (accountId: string) => `/accounts/${encodeURIComponent(accountId)}/logo`,
};

/** Input for uploading an account logo via multipart/form-data. */
export interface UploadAccountLogoInput {
  filename: string;
  body: Blob | ArrayBuffer | Uint8Array;
  contentType?: string;
}

/** CRUD + branding for workspace accounts. */
export class AccountsResource {
  constructor(private readonly http: HttpClient) {}

  /** List the workspace accounts the authenticated principal belongs to. */
  list(): Promise<Account[]> {
    return this.http.get<Account[]>(paths.collection());
  }

  /** Create a new workspace account owned by the authenticated user. */
  create(input: CreateAccountInput): Promise<Account> {
    return this.http.post<Account>(paths.collection(), input);
  }

  /** Fetch a single workspace account by id. */
  get(accountId: string): Promise<Account> {
    return this.http.get<Account>(paths.item(accountId));
  }

  /** Update a workspace account's profile. */
  update(accountId: string, input: UpdateAccountInput): Promise<Account> {
    return this.http.put<Account>(paths.item(accountId), input);
  }

  /**
   * Delete a workspace account.
   *
   * By default the API responds `400` when the workspace has an active paid
   * subscription. Pass `{ force: true }` to cancel any active paid subscription
   * automatically and delete immediately.
   */
  async remove(accountId: string, options: DeleteAccountInput = {}): Promise<void> {
    const init: RequestInit =
      options.force === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify({ force: options.force }) };
    await this.http.delete<unknown>(paths.item(accountId), init);
  }

  /** Get the account theme (branding name, colors, and logo URL). */
  getTheme(accountId: string): Promise<AccountTheme> {
    return this.http.get<AccountTheme>(paths.theme(accountId));
  }

  /** Download the account logo as an image `Response`. */
  downloadLogo(accountId: string): Promise<Response> {
    return this.http.rawRequest(paths.logo(accountId));
  }

  /** Upload or replace the account logo image. */
  async uploadLogo(accountId: string, input: UploadAccountLogoInput): Promise<void> {
    const form = new FormData();
    const blob =
      input.body instanceof Blob
        ? input.body
        : new Blob([toBlobPart(input.body)], { type: input.contentType ?? "image/png" });
    form.append("file", blob, input.filename);
    await this.http.request<unknown>(paths.logo(accountId), { method: "POST", body: form });
  }

  /** Delete the account logo. */
  async deleteLogo(accountId: string): Promise<void> {
    await this.http.delete<unknown>(paths.logo(accountId));
  }
}
