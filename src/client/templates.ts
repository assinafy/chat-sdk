/**
 * Templates resource — reusable document templates that can be instantiated
 * into new documents with a pre-defined set of fields and signer slots.
 *
 * @see https://api.assinafy.com.br/v1/docs
 */

import { withQuery, type HttpClient } from "./http.js";
import { pageQuery } from "./internal.js";
import type {
  CostEstimate,
  CreateDocumentFromTemplateInput,
  Document,
  Page,
  Template,
  TemplateCostSignerInput,
} from "./types.js";

const paths = {
  collection: (accountId: string) => `/accounts/${encodeURIComponent(accountId)}/templates`,
  item: (accountId: string, templateId: string) =>
    `/accounts/${encodeURIComponent(accountId)}/templates/${encodeURIComponent(templateId)}`,
  instantiate: (accountId: string, templateId: string) =>
    `/accounts/${encodeURIComponent(accountId)}/templates/${encodeURIComponent(templateId)}/documents`,
  estimate: (accountId: string, templateId: string) =>
    `/accounts/${encodeURIComponent(accountId)}/templates/${encodeURIComponent(templateId)}/documents/estimate-cost`,
};

/** Query accepted by {@link TemplatesResource.list}: `search`, `sort`, `page`, `per-page`. */
export interface ListTemplatesQuery {
  /** @deprecated Not part of the list-templates operation; ignored. */
  status?: string;
  search?: string;
  /** @deprecated Not part of the list-templates operation; ignored. */
  tags?: string | string[];
  sort?: string;
  page?: number;
  perPage?: number;
}

/** Templates and template instantiation (`client.templates`). */
export class TemplatesResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * `GET /accounts/{accountId}/templates` — the account's templates. Query
   * sent: `search`, `sort`, `page`, `per-page`. Response: `Page<Template>`.
   */
  async list(accountId: string, query: ListTemplatesQuery = {}): Promise<Page<Template>> {
    return this.http.getPage<Template>(
      withQuery(paths.collection(accountId), {
        search: query.search,
        sort: query.sort,
        ...pageQuery(query.page, query.perPage),
      }),
    );
  }

  /**
   * `GET /accounts/{accountId}/templates/{templateId}` (live, but not in the
   * published OpenAPI document) — one {@link Template}. Unlike {@link list}, the detail response
   * includes `default_document_tags` and the full page/field/role layout.
   */
  get(accountId: string, templateId: string): Promise<Template> {
    return this.http.get<Template>(paths.item(accountId, templateId));
  }

  /**
   * `POST /accounts/{accountId}/templates/{templateId}/documents` — create a
   * document from a template.
   *
   * Request sent: `{ signers: [{ role_id, id?, email?, name?, whatsapp_phone_number?, verification_method?,
   * notification_methods?, step? }], editor_fields?: [{ field_id, value }],
   * name?, message?, expires_at?, tags? }`. Bind every Signer role; CopyReceiver
   * bindings are optional and Editor roles use only `editor_fields`. Send a
   * signer `id` or `email`; `id` wins when both are supplied. Email reuses an
   * account signer or creates one using `name` and `whatsapp_phone_number`. A
   * keyed `editor_fields` object (deprecated) is sent as the array form.
   * Response: the new {@link Document}.
   */
  async instantiate(
    accountId: string,
    templateId: string,
    input: CreateDocumentFromTemplateInput,
  ): Promise<Document> {
    const { signers, editor_fields, name, message, expires_at, tags } = input;
    return this.http.post<Document>(paths.instantiate(accountId, templateId), {
      signers: signers.map(({ role_id, id, email, name, whatsapp_phone_number, verification_method, notification_methods, step }) => ({
        role_id,
        id,
        email,
        name,
        whatsapp_phone_number,
        verification_method,
        notification_methods,
        step,
      })),
      editor_fields:
        editor_fields === undefined || Array.isArray(editor_fields)
          ? editor_fields?.map(({ field_id, value }) => ({ field_id, value }))
          : Object.entries(editor_fields).map(([field_id, value]) => ({ field_id, value: String(value) })),
      name,
      message,
      expires_at,
      tags,
    });
  }

  /**
   * `POST /accounts/{accountId}/templates/{templateId}/documents/estimate-cost`
   * — price a template instantiation without creating the document. Request:
   * `{ signers: [{ role_id, verification_method?, notification_methods? }] }`
   * (an array is wrapped). Response: {@link CostEstimate}.
   */
  async estimateCost(
    accountId: string,
    templateId: string,
    input: { signers: TemplateCostSignerInput[] } | TemplateCostSignerInput[],
  ): Promise<CostEstimate> {
    const signers = Array.isArray(input) ? input : input.signers;
    return this.http.post<CostEstimate>(paths.estimate(accountId, templateId), {
      signers: signers.map(({ role_id, verification_method, notification_methods }) => ({
        role_id, verification_method, notification_methods,
      })),
    });
  }
}
