/**
 * Field-definition resource.
 *
 * Field definitions describe signer-entered values used by collect
 * assignments. The API also exposes validation endpoints so signer UIs can
 * validate single or multiple field values before submitting a signature.
 *
 * @see https://api.assinafy.com.br/v1/docs
 */

import { withQuery, type HttpClient } from "./http.js";
import type {
  CreateFieldInput,
  FieldDefinition,
  FieldType,
  FieldValidationResult,
  ListFieldsQuery,
  Page,
  UpdateFieldInput,
  ValidateFieldEntry,
} from "./types.js";

const paths = {
  collection: (accountId: string) => `/accounts/${encodeURIComponent(accountId)}/fields`,
  item: (accountId: string, fieldId: string) =>
    `/accounts/${encodeURIComponent(accountId)}/fields/${encodeURIComponent(fieldId)}`,
  validate: (accountId: string, fieldId: string) =>
    `/accounts/${encodeURIComponent(accountId)}/fields/${encodeURIComponent(fieldId)}/validate`,
  validateMultiple: (accountId: string) =>
    `/accounts/${encodeURIComponent(accountId)}/fields/validate-multiple`,
  types: () => "/field-types",
};

/** Account-scoped field-definition endpoints. */
export class FieldsResource {
  constructor(private readonly http: HttpClient) {}

  /** Create a field definition. */
  create(accountId: string, input: CreateFieldInput): Promise<FieldDefinition> {
    return this.http.post<FieldDefinition>(paths.collection(accountId), input);
  }

  /** List field definitions, optionally including inactive or standard fields. */
  list(accountId: string, query: ListFieldsQuery = {}): Promise<Page<FieldDefinition>> {
    return this.http.getPage<FieldDefinition>(
      withQuery(paths.collection(accountId), {
        include_inactive: query.include_inactive,
        include_standard: query.include_standard,
        search: query.search,
        sort: query.sort,
        page: query.page,
        "per-page": query.perPage,
      }),
    );
  }

  /** Fetch one field definition by id. */
  get(accountId: string, fieldId: string): Promise<FieldDefinition> {
    return this.http.get<FieldDefinition>(paths.item(accountId, fieldId));
  }

  /** Update a field definition. Omitted fields are left unchanged. */
  update(accountId: string, fieldId: string, input: UpdateFieldInput): Promise<FieldDefinition> {
    return this.http.put<FieldDefinition>(paths.item(accountId, fieldId), input);
  }

  /** Delete a field definition. The API rejects fields already used by documents. */
  async remove(accountId: string, fieldId: string): Promise<void> {
    await this.http.delete<unknown>(paths.item(accountId, fieldId));
  }

  /** Validate one value against a field definition. */
  validate(
    accountId: string,
    fieldId: string,
    value: unknown,
    options: { accessCode?: string } = {},
  ): Promise<FieldValidationResult> {
    return this.http.post<FieldValidationResult>(
      withQuery(paths.validate(accountId, fieldId), {
        "signer-access-code": options.accessCode,
      }),
      { value },
    );
  }

  /** Validate multiple values in one request. */
  validateMultiple(
    accountId: string,
    entries: ValidateFieldEntry[],
    options: { accessCode?: string } = {},
  ): Promise<FieldValidationResult[]> {
    return this.http.post<FieldValidationResult[]>(
      withQuery(paths.validateMultiple(accountId), {
        "signer-access-code": options.accessCode,
      }),
      entries,
    );
  }

  /** List all supported field types. */
  listTypes(): Promise<FieldType[]> {
    return this.http.get<FieldType[]>(paths.types());
  }
}
