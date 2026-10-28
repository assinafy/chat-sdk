/**
 * Field-definition resource.
 *
 * Field definitions describe signer-entered values used by collect
 * assignments. The validation endpoints check values against a definition
 * with the workspace's credentials (API key or bearer token).
 *
 * @see https://api.assinafy.com.br/v1/docs
 */

import { withQuery, type HttpClient } from "./http.js";
import { ConfigurationError } from "./errors.js";
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

  /**
   * `POST /accounts/{accountId}/fields` — create a field definition.
   * Request sent: `{ name, type, regex?, is_required? }`. Response:
   * {@link FieldDefinition}.
   */
  async create(accountId: string, input: CreateFieldInput): Promise<FieldDefinition> {
    const { name, type, regex, is_required } = input;
    return this.http.post<FieldDefinition>(paths.collection(accountId), { name, type, regex, is_required });
  }

  /**
   * `GET /accounts/{accountId}/fields` — list field definitions. Query:
   * `include_inactive`, `include_standard`. Response: `Page<FieldDefinition>`.
   */
  list(accountId: string, query: ListFieldsQuery = {}): Promise<Page<FieldDefinition>> {
    return this.http.getPage<FieldDefinition>(
      withQuery(paths.collection(accountId), {
        include_inactive: query.include_inactive,
        include_standard: query.include_standard,
      }),
    );
  }

  /** `GET /accounts/{accountId}/fields/{fieldId}` — one {@link FieldDefinition}. */
  get(accountId: string, fieldId: string): Promise<FieldDefinition> {
    return this.http.get<FieldDefinition>(paths.item(accountId, fieldId));
  }

  /**
   * `PUT /accounts/{accountId}/fields/{fieldId}` — update a field definition.
   * Request sent: `{ name?, regex?, is_active? }`; omitted fields are left
   * unchanged. Response: {@link FieldDefinition}.
   */
  async update(accountId: string, fieldId: string, input: UpdateFieldInput): Promise<FieldDefinition> {
    const { name, regex, is_active } = input;
    return this.http.put<FieldDefinition>(paths.item(accountId, fieldId), { name, regex, is_active });
  }

  /** `DELETE /accounts/{accountId}/fields/{fieldId}` — the API rejects fields already used by documents. */
  async remove(accountId: string, fieldId: string): Promise<void> {
    await this.http.delete<unknown>(paths.item(accountId, fieldId));
  }

  /**
   * `POST /accounts/{accountId}/fields/{fieldId}/validate` — validate one
   * value with the workspace's credentials. Request: `{ value }`. Response:
   * `{ type, success, error_message }`.
   *
   * The operation does not accept a signer access code: passing
   * `options.accessCode` rejects with {@link ConfigurationError} instead of
   * silently validating with the workspace's credentials.
   */
  async validate(
    accountId: string,
    fieldId: string,
    value: unknown,
    options: WorkspaceOnlyOptions = {},
  ): Promise<FieldValidationResult> {
    rejectAccessCode(options);
    return this.http.post<FieldValidationResult>(paths.validate(accountId, fieldId), { value });
  }

  /**
   * `POST /accounts/{accountId}/fields/validate-multiple` — validate several
   * values with the workspace's credentials. Request: `[{ field_id, value }]`.
   * Response: `[{ field_id, type, success, error_message }]`. Rejects
   * `options.accessCode` like {@link validate}.
   */
  async validateMultiple(
    accountId: string,
    entries: ValidateFieldEntry[],
    options: WorkspaceOnlyOptions = {},
  ): Promise<FieldValidationResult[]> {
    rejectAccessCode(options);
    return this.http.post<FieldValidationResult[]>(
      paths.validateMultiple(accountId), entries.map(({ field_id, value }) => ({ field_id, value })),
    );
  }

  /** `GET /field-types` — supported field types: `[{ type, name }]`. */
  listTypes(): Promise<FieldType[]> {
    return this.http.get<FieldType[]>(paths.types());
  }
}

/** Options of the field validation methods. */
interface WorkspaceOnlyOptions {
  /**
   * @deprecated Field validation authenticates with the workspace's
   * credentials only; a signer access code is rejected.
   */
  accessCode?: string;
}

function rejectAccessCode(options: WorkspaceOnlyOptions): void {
  if (options.accessCode !== undefined) {
    throw new ConfigurationError(
      "Field validation uses the workspace's credentials and does not accept a signer access code",
    );
  }
}
