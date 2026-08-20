/**
 * Templates resource — reusable document templates that can be instantiated
 * into new documents with a pre-defined set of fields and signer slots.
 *
 * @see https://api.assinafy.com.br/v1/docs
 */

import { withQuery, type HttpClient } from "./http.js";
import { csv } from "./internal.js";
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

export interface ListTemplatesQuery {
  status?: string;
  search?: string;
  tags?: string | string[];
  sort?: string;
  page?: number;
  perPage?: number;
}

export class TemplatesResource {
  constructor(private readonly http: HttpClient) {}

  /** List all templates available under the account. */
  list(accountId: string, query: ListTemplatesQuery = {}): Promise<Page<Template>> {
    return this.http.getPage<Template>(
      withQuery(paths.collection(accountId), {
        status: query.status,
        search: query.search,
        tags: csv(query.tags),
        sort: query.sort,
        page: query.page,
        "per-page": query.perPage,
      }),
    );
  }

  /**
   * Fetch a single template by id. Unlike {@link list}, the detail response
   * includes `default_document_tags` and the full page/field/role layout.
   */
  get(accountId: string, templateId: string): Promise<Template> {
    return this.http.get<Template>(paths.item(accountId, templateId));
  }

  /** Instantiate a template into a new document with concrete signers. */
  instantiate(
    accountId: string,
    templateId: string,
    input: CreateDocumentFromTemplateInput,
  ): Promise<Document> {
    return this.http.post<Document>(paths.instantiate(accountId, templateId), input);
  }

  /**
   * Estimate what instantiating a template will cost for a given set of
   * signers, without actually creating the document.
   */
  estimateCost(
    accountId: string,
    templateId: string,
    input: { signers: TemplateCostSignerInput[] } | TemplateCostSignerInput[],
  ): Promise<CostEstimate> {
    const body = Array.isArray(input) ? { signers: input } : input;
    return this.http.post<CostEstimate>(paths.estimate(accountId, templateId), body);
  }
}
