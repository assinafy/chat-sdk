/**
 * LLM tool definitions for the Assinafy API.
 *
 * `createChatTools(client)` returns an array of provider-agnostic tool
 * descriptors that expose the most common Assinafy operations as
 * JSON-schema-typed tools. The shape is compatible with both Anthropic's
 * Anthropic/OpenAI tool payloads after the small provider-specific reshape
 * shown in the package documentation.
 *
 * Each tool has:
 *  - `name`            — stable id you pass to the model
 *  - `description`     — natural-language summary the model uses to decide when to call it
 *  - `input_schema`    — JSON Schema describing the arguments (Anthropic style)
 *  - `parameters`      — alias of `input_schema` (OpenAI style)
 *  - `execute(args)`   — async function that runs the underlying API call and
 *                        returns a JSON-serializable result
 *
 * Apps run the loop themselves; this module never touches the LLM SDK
 * directly, keeping the chat-sdk free of LLM dependencies.
 */

import type { AssinafyClient } from "../client/index.js";
import type {
  AssignmentMethod,
  CreateAssignmentInput,
  CreateFieldInput,
  CreateSignerInput,
  DocumentStatusCode,
  EstimateAssignmentSignerInput,
  ListDocumentsQuery,
  ListFieldsQuery,
  ListSignersQuery,
  ListWebhookDispatchesQuery,
  TemplateSignerInput,
  UpdateFieldInput,
  UpdateSignerInput,
  ValidateFieldEntry,
  WebhookSubscriptionInput,
} from "../client/types.js";

/** Provider-agnostic tool descriptor. */
export interface ChatTool<TArgs = unknown, TResult = unknown> {
  name: string;
  description: string;
  /** Anthropic-style alias for `parameters`. */
  input_schema: Record<string, unknown>;
  /** OpenAI-style alias for `input_schema`. */
  parameters: Record<string, unknown>;
  /** Validate the arguments against `input_schema`, then run the API call. */
  execute(args: TArgs): Promise<TResult>;
}

/** Options for {@link createChatTools}. */
export interface CreateChatToolsOptions {
  /** Default account id used when an individual tool call doesn't specify one. */
  accountId?: string;
  /**
   * Restrict the toolset to specific tool names. Useful when you only want
   * to expose, say, read-only operations to the model.
   */
  include?: string[];
  /** Inverse of `include`. */
  exclude?: string[];
}

/**
 * Build the full toolset for an Assinafy client. The resulting array can be
 * passed straight into Anthropic's `tools` (or after a small `{ name, description, parameters }` reshape into OpenAI's).
 */
export function createChatTools(
  client: AssinafyClient,
  options: CreateChatToolsOptions = {},
): ChatTool[] {
  const defaultAccountId = options.accountId ?? client.accountId;
  const accountIdSchema = defaultAccountId
    ? { type: "string", description: "Account id. Optional — defaults to the configured account." }
    : { type: "string", description: "Account id." };
  const accountIdRequired = !defaultAccountId;
  const accountIdOrDefault = (input?: string): string => {
    const value = input ?? defaultAccountId;
    if (!value) throw new Error("accountId is required (no default configured)");
    return value;
  };
  const entityIdSchema = (id: string) => ({
    type: "object",
    properties: { accountId: accountIdSchema, [id]: { type: "string" } },
    required: accountIdRequired ? ["accountId", id] : [id],
  });

  const tools: ChatTool[] = [
    schemaTool({
      name: "list_signers",
      description: "List signers under an account, with optional search.",
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          search: { type: "string", description: "Substring filter for full name or email." },
          ...PAGINATION_SCHEMA,
        },
        required: accountIdRequired ? ["accountId"] : [],
      },
      execute: async (args: ListSignersQuery & { accountId?: string }) =>
        client.signers.list(accountIdOrDefault(args.accountId), {
          search: args.search,
          page: args.page,
          perPage: args.perPage,
        }),
    }),

    schemaTool({
      name: "create_signer",
      description: "Create a new signer under an account.",
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          full_name: { type: "string", description: "Full name of the signer." },
          email: { type: "string", format: "email" },
          whatsapp_phone_number: { type: "string", description: "E.164 phone, e.g. +5511999999999." },
        },
        required: accountIdRequired ? ["accountId", "full_name"] : ["full_name"],
      },
      execute: async (args: CreateSignerInput & { accountId?: string }) =>
        client.signers.create(accountIdOrDefault(args.accountId), {
          full_name: args.full_name,
          email: args.email,
          whatsapp_phone_number: args.whatsapp_phone_number,
        }),
    }),

    schemaTool({
      name: "get_signer",
      description: "Fetch a signer by id.",
      schema: entityIdSchema("signerId"),
      execute: async (args: { accountId?: string; signerId: string }) =>
        client.signers.get(accountIdOrDefault(args.accountId), args.signerId),
    }),

    schemaTool({
      name: "update_signer",
      description: "Update a signer's name, email, WhatsApp number, or government ID.",
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          signerId: { type: "string" },
          full_name: { type: "string" },
          email: { type: "string", format: "email" },
          whatsapp_phone_number: { type: "string" },
          government_id: { type: "string" },
        },
        required: accountIdRequired ? ["accountId", "signerId"] : ["signerId"],
      },
      execute: async (args: UpdateSignerInput & { accountId?: string; signerId: string }) =>
        client.signers.update(accountIdOrDefault(args.accountId), args.signerId, {
          full_name: args.full_name,
          email: args.email,
          whatsapp_phone_number: args.whatsapp_phone_number,
          government_id: args.government_id,
        }),
    }),

    schemaTool({
      name: "delete_signer",
      description: "Delete a signer by id.",
      schema: entityIdSchema("signerId"),
      execute: async (args: { accountId?: string; signerId: string }) => {
        await client.signers.remove(accountIdOrDefault(args.accountId), args.signerId);
        return { ok: true };
      },
    }),

    schemaTool({
      name: "list_documents",
      description: "List documents under an account, with optional status/search/tag filters.",
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          status: {
            description: "Single status code or array of codes.",
            anyOf: [
              { type: "string", enum: DOCUMENT_STATUS_CODES },
              { type: "array", items: { type: "string", enum: DOCUMENT_STATUS_CODES } },
            ],
          },
          search: { type: "string" },
          method: { type: "string", enum: ["virtual", "collect"] },
          tags: {
            description: "Tag id(s) to filter by.",
            anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
          },
          sort: { type: "string", enum: ["name", "updated_at"] },
          ...PAGINATION_SCHEMA,
        },
        required: accountIdRequired ? ["accountId"] : [],
      },
      execute: async (args: ListDocumentsQuery & { accountId?: string }) =>
        client.documents.list(accountIdOrDefault(args.accountId), {
          status: args.status as DocumentStatusCode | DocumentStatusCode[] | undefined,
          search: args.search,
          method: args.method,
          tags: args.tags,
          sort: args.sort,
          page: args.page,
          perPage: args.perPage,
        }),
    }),

    schemaTool({
      name: "get_document",
      description: "Fetch a document by id, including its assignment, pages, and signers.",
      schema: {
        type: "object",
        properties: { documentId: { type: "string" } },
        required: ["documentId"],
      },
      execute: async (args: { documentId: string }) => client.documents.get(args.documentId),
    }),

    schemaTool({
      name: "delete_document",
      description: "Delete a document. Only succeeds if the document's current status is `deletable`.",
      schema: {
        type: "object",
        properties: { documentId: { type: "string" } },
        required: ["documentId"],
      },
      execute: async (args: { documentId: string }) => {
        await client.documents.remove(args.documentId);
        return { ok: true };
      },
    }),

    schemaTool({
      name: "document_activities",
      description: "Get the activity log (signed events, notifications, declines, …) for a document.",
      schema: {
        type: "object",
        properties: { documentId: { type: "string" } },
        required: ["documentId"],
      },
      execute: async (args: { documentId: string }) => client.documents.activities(args.documentId),
    }),

    schemaTool({
      name: "rename_document",
      description:
        "Rename a document. Only allowed before any assignment exists (status `uploaded`/`metadata_ready`).",
      schema: {
        type: "object",
        properties: { documentId: { type: "string" }, name: { type: "string" } },
        required: ["documentId", "name"],
      },
      execute: async (args: { documentId: string; name: string }) =>
        client.documents.rename(args.documentId, args.name),
    }),

    schemaTool({
      name: "search_documents",
      description:
        "Lightweight document search under an account (compact results; cheaper than list_documents).",
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          search: { type: "string" },
          status: {
            anyOf: [
              { type: "string", enum: DOCUMENT_STATUS_CODES },
              { type: "array", items: { type: "string", enum: DOCUMENT_STATUS_CODES } },
            ],
          },
          ...PAGINATION_SCHEMA,
        },
        required: accountIdRequired ? ["accountId"] : [],
      },
      execute: async (args: {
        accountId?: string;
        search?: string;
        status?: DocumentStatusCode | DocumentStatusCode[];
        page?: number;
        perPage?: number;
      }) =>
        client.documents.search(accountIdOrDefault(args.accountId), {
          search: args.search,
          status: args.status,
          page: args.page,
          perPage: args.perPage,
        }),
    }),

    schemaTool({
      name: "list_document_statuses",
      description: "List the canonical document status codes the API recognizes.",
      schema: { type: "object", properties: {}, required: [] },
      execute: async () => client.documents.statuses(),
    }),

    schemaTool({
      name: "create_assignment",
      description:
        "Assign one or more existing signers to a document, starting the signature flow. `method` is `virtual` or `collect`.",
      schema: {
        type: "object",
        properties: {
          documentId: { type: "string" },
          method: {
            type: "string",
            description: "Signature method.",
            enum: ["virtual", "collect"],
          },
          signer_ids: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
            description: "Legacy signer ID list. Prefer `signers` for new integrations.",
          },
          signerIds: {
            type: "array",
            minItems: 1,
            items: { type: "string" },
            description: "Deprecated alias for `signer_ids`.",
          },
          signers: {
            type: "array",
            minItems: 1,
            items: ASSIGNMENT_SIGNER_SCHEMA,
            description: "Existing signer configurations. For creation, each entry must include `id`.",
          },
          entries: {
            type: "array",
            items: ASSIGNMENT_ENTRY_SCHEMA,
            description: "Collect-method field placement entries.",
          },
          message: { type: "string" },
          expires_at: { type: "string", format: "date-time" },
          copy_receivers: { type: "array", items: { type: "string" } },
        },
        required: ["documentId", "method"],
        anyOf: [
          { required: ["signers"] },
          { required: ["signer_ids"] },
          { required: ["signerIds"] },
        ],
      },
      execute: async (args: CreateAssignmentInput & { documentId: string }) =>
        client.assignments.create(args.documentId, {
          method: args.method,
          signer_ids: args.signer_ids,
          signerIds: args.signerIds,
          signers: args.signers,
          entries: args.entries,
          message: args.message,
          expires_at: args.expires_at,
          copy_receivers: args.copy_receivers,
        } as CreateAssignmentInput),
    }),

    schemaTool({
      name: "estimate_assignment_cost",
      description: "Estimate the cost of an assignment without creating it.",
      schema: {
        type: "object",
        properties: {
          documentId: { type: "string" },
          method: { type: "string", enum: ["virtual", "collect"] },
          signers: { type: "array", minItems: 1, items: ESTIMATE_ASSIGNMENT_SIGNER_SCHEMA },
          signer_ids: { type: "array", minItems: 1, items: { type: "string" } },
          entries: {
            type: "array",
            items: ASSIGNMENT_ENTRY_SCHEMA,
            description: "Collect-method field placement entries.",
          },
        },
        required: ["documentId"],
      },
      execute: async (args: {
        documentId: string;
        method?: AssignmentMethod;
        signers?: EstimateAssignmentSignerInput[];
        signer_ids?: string[];
        entries?: CreateAssignmentInput["entries"];
      }) =>
        client.assignments.estimateCost(args.documentId, {
          method: args.method,
          signers: args.signers,
          signer_ids: args.signer_ids,
          entries: args.entries,
        }),
    }),

    schemaTool({
      name: "list_templates",
      description: "List the document templates available under an account.",
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          search: { type: "string" },
          ...PAGINATION_SCHEMA,
        },
        required: accountIdRequired ? ["accountId"] : [],
      },
      execute: async (args: {
        accountId?: string;
        search?: string;
        page?: number;
        perPage?: number;
      }) =>
        client.templates.list(accountIdOrDefault(args.accountId), {
          search: args.search,
          page: args.page,
          perPage: args.perPage,
        }),
    }),

    schemaTool({
      name: "instantiate_template",
      description:
        "Create a document from a template with the supplied signers. Returns the new document.",
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          templateId: { type: "string" },
          name: { type: "string" },
          message: { type: "string" },
          signers: { type: "array", minItems: 1, items: TEMPLATE_SIGNER_SCHEMA },
          tags: { type: "array", items: { type: "string" } },
          editor_fields: {
            type: "array",
            items: {
              type: "object",
              properties: { field_id: { type: "string" }, value: { type: "string" } },
              required: ["field_id", "value"],
            },
          },
          expires_at: { type: "string", format: "date-time" },
        },
        required: accountIdRequired ? ["accountId", "templateId", "signers"] : ["templateId", "signers"],
      },
      execute: async (args: {
        accountId?: string;
        templateId: string;
        name?: string;
        message?: string;
        signers: TemplateSignerInput[];
        tags?: string[];
        expires_at?: string;
        editor_fields?: Array<{ field_id: string; value: string }>;
      }) =>
        client.templates.instantiate(accountIdOrDefault(args.accountId), args.templateId, {
          name: args.name,
          message: args.message,
          signers: args.signers,
          tags: args.tags,
          expires_at: args.expires_at,
          editor_fields: args.editor_fields,
        }),
    }),

    schemaTool({
      name: "list_tags",
      description: "List tags under an account.",
      schema: {
        type: "object",
        properties: { accountId: accountIdSchema, search: { type: "string" } },
        required: accountIdRequired ? ["accountId"] : [],
      },
      execute: async (args: { accountId?: string; search?: string }) =>
        client.tags.list(accountIdOrDefault(args.accountId), args.search),
    }),

    schemaTool({
      name: "create_tag",
      description: "Create a new tag.",
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          name: { type: "string" },
          color: { type: "string", description: "Hex color code, e.g. #ff8800." },
        },
        required: accountIdRequired ? ["accountId", "name"] : ["name"],
      },
      execute: async (args: { accountId?: string; name: string; color?: string }) =>
        client.tags.create(accountIdOrDefault(args.accountId), { name: args.name, color: args.color }),
    }),

    schemaTool({
      name: "tag_document",
      description: "Replace the tags attached to a document with the given tag IDs.",
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          documentId: { type: "string" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Alternate tag input alias.",
          },
          tagIds: {
            type: "array",
            items: { type: "string" },
            description: "Current API tag IDs.",
          },
        },
        required: accountIdRequired ? ["accountId", "documentId"] : ["documentId"],
        anyOf: [{ required: ["tagIds"] }, { required: ["tags"] }],
      },
      execute: async (args: { accountId?: string; documentId: string; tags?: string[]; tagIds?: string[] }) =>
        client.tags.setForDocument(accountIdOrDefault(args.accountId), args.documentId, args.tagIds ?? args.tags ?? []),
    }),

    schemaTool({
      name: "list_fields",
      description: "List field definitions under an account.",
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          include_inactive: { type: "boolean" },
          include_standard: { type: "boolean" },
        },
        required: accountIdRequired ? ["accountId"] : [],
      },
      execute: async (args: ListFieldsQuery & { accountId?: string }) =>
        client.fields.list(accountIdOrDefault(args.accountId), {
          include_inactive: args.include_inactive,
          include_standard: args.include_standard,
        }),
    }),

    schemaTool({
      name: "create_field",
      description: "Create a reusable field definition under an account.",
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          type: { type: "string" },
          name: { type: "string" },
          regex: { type: ["string", "null"] },
          is_required: { type: "boolean" },
        },
        required: accountIdRequired ? ["accountId", "type", "name"] : ["type", "name"],
      },
      execute: async (args: CreateFieldInput & { accountId?: string }) =>
        client.fields.create(accountIdOrDefault(args.accountId), {
          type: args.type,
          name: args.name,
          regex: args.regex,
          is_required: args.is_required,
        }),
    }),

    schemaTool({
      name: "get_field",
      description: "Fetch one field definition by id.",
      schema: entityIdSchema("fieldId"),
      execute: async (args: { accountId?: string; fieldId: string }) =>
        client.fields.get(accountIdOrDefault(args.accountId), args.fieldId),
    }),

    schemaTool({
      name: "update_field",
      description: "Update a field definition.",
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          fieldId: { type: "string" },
          name: { type: "string" },
          regex: { type: ["string", "null"] },
          is_active: { type: "boolean" },
        },
        required: accountIdRequired ? ["accountId", "fieldId"] : ["fieldId"],
      },
      execute: async (args: UpdateFieldInput & { accountId?: string; fieldId: string }) =>
        client.fields.update(accountIdOrDefault(args.accountId), args.fieldId, {
          name: args.name,
          regex: args.regex,
          is_active: args.is_active,
        }),
    }),

    schemaTool({
      name: "delete_field",
      description: "Delete a field definition. The API rejects fields already used by documents.",
      schema: entityIdSchema("fieldId"),
      execute: async (args: { accountId?: string; fieldId: string }) => {
        await client.fields.remove(accountIdOrDefault(args.accountId), args.fieldId);
        return { ok: true };
      },
    }),

    schemaTool({
      name: "validate_field",
      description: "Validate one value against a field definition.",
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          fieldId: { type: "string" },
          value: {},
          accessCode: { type: "string", description: "Signer access code for public signer flows." },
        },
        required: accountIdRequired ? ["accountId", "fieldId", "value"] : ["fieldId", "value"],
      },
      execute: async (args: { accountId?: string; fieldId: string; value: unknown; accessCode?: string }) =>
        client.fields.validate(accountIdOrDefault(args.accountId), args.fieldId, args.value, {
          accessCode: args.accessCode,
        }),
    }),

    schemaTool({
      name: "validate_fields",
      description: "Validate multiple field values in one request.",
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          entries: {
            type: "array",
            items: {
              type: "object",
              properties: { field_id: { type: "string" }, value: {} },
              required: ["field_id", "value"],
            },
          },
          accessCode: { type: "string", description: "Signer access code for public signer flows." },
        },
        required: accountIdRequired ? ["accountId", "entries"] : ["entries"],
      },
      execute: async (args: { accountId?: string; entries: ValidateFieldEntry[]; accessCode?: string }) =>
        client.fields.validateMultiple(accountIdOrDefault(args.accountId), args.entries, {
          accessCode: args.accessCode,
        }),
    }),

    schemaTool({
      name: "list_field_types",
      description: "List supported field definition types.",
      schema: { type: "object", properties: {}, required: [] },
      execute: async () => client.fields.listTypes(),
    }),

    schemaTool({
      name: "get_webhook_subscription",
      description: "Get the current webhook subscription for an account.",
      schema: {
        type: "object",
        properties: { accountId: accountIdSchema },
        required: accountIdRequired ? ["accountId"] : [],
      },
      execute: async (args: { accountId?: string }) =>
        client.webhooks.getSubscription(accountIdOrDefault(args.accountId)),
    }),

    schemaTool({
      name: "update_webhook_subscription",
      description: "Create or replace the webhook subscription for an account.",
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          events: { type: "array", items: { type: "string" } },
          is_active: { type: "boolean" },
          url: { type: "string", format: "uri" },
          email: { type: "string", format: "email" },
        },
        required: accountIdRequired
          ? ["accountId", "events", "is_active", "url", "email"]
          : ["events", "is_active", "url", "email"],
      },
      execute: async (args: WebhookSubscriptionInput & { accountId?: string }) =>
        client.webhooks.updateSubscription(accountIdOrDefault(args.accountId), {
          events: args.events,
          is_active: args.is_active,
          url: args.url,
          email: args.email,
        }),
    }),

    schemaTool({
      name: "inactivate_webhook_subscription",
      description: "Inactivate the current webhook subscription without deleting its settings.",
      schema: {
        type: "object",
        properties: { accountId: accountIdSchema },
        required: accountIdRequired ? ["accountId"] : [],
      },
      execute: async (args: { accountId?: string }) =>
        client.webhooks.inactivate(accountIdOrDefault(args.accountId)),
    }),

    schemaTool({
      name: "list_webhook_event_types",
      description: "List webhook event types supported by the API.",
      schema: { type: "object", properties: {}, required: [] },
      execute: async () => client.webhooks.listEventTypes(),
    }),

    schemaTool({
      name: "list_webhook_dispatches",
      description: "List webhook delivery attempts for an account.",
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          event: { type: "string" },
          delivered: { type: "boolean" },
          from: { type: "integer" },
          to: { type: "integer" },
          ...PAGINATION_SCHEMA,
        },
        required: accountIdRequired ? ["accountId"] : [],
      },
      execute: async (args: ListWebhookDispatchesQuery & { accountId?: string }) =>
        client.webhooks.listDispatches(accountIdOrDefault(args.accountId), {
          event: args.event,
          delivered: args.delivered,
          from: args.from,
          to: args.to,
          page: args.page,
          perPage: args.perPage,
        }),
    }),

    schemaTool({
      name: "retry_webhook_dispatch",
      description: "Retry one webhook delivery attempt.",
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          dispatchId: { type: "string" },
        },
        required: accountIdRequired ? ["accountId", "dispatchId"] : ["dispatchId"],
      },
      execute: async (args: { accountId?: string; dispatchId: string }) =>
        client.webhooks.retryDispatch(accountIdOrDefault(args.accountId), args.dispatchId),
    }),

    schemaTool({
      name: "send_public_token",
      description:
        "Ask Assinafy to email a fresh public document access token.",
      schema: {
        type: "object",
        properties: {
          documentId: { type: "string" },
          email: { type: "string", format: "email" },
          recipient: { type: "string" },
          channel: { type: "string", enum: ["email", "whatsapp"] },
        },
        required: ["documentId"],
        anyOf: [{ required: ["email"] }, { required: ["recipient", "channel"] }],
      },
      execute: async (args: {
        documentId: string;
        email?: string;
        recipient?: string;
        channel?: "email" | "whatsapp";
      }) =>
        client.documents.sendPublicToken(
          args.documentId,
          args.email
            ? { email: args.email }
            : { recipient: args.recipient!, channel: args.channel! },
        ),
    }),

    schemaTool({
      name: "verify_document",
      description: "Verify a signed document by its signature hash. No auth required.",
      schema: {
        type: "object",
        properties: { signatureHash: { type: "string" } },
        required: ["signatureHash"],
      },
      execute: async (args: { signatureHash: string }) => client.documents.verify(args.signatureHash),
    }),

    schemaTool({
      name: "list_accounts",
      description: "List the workspace accounts the authenticated principal belongs to.",
      schema: { type: "object", properties: {}, required: [] },
      execute: async () => client.accounts.list(),
    }),
  ];

  const filtered = tools.filter((tool) => {
    if (options.include && !options.include.includes(tool.name)) return false;
    if (options.exclude && options.exclude.includes(tool.name)) return false;
    return true;
  });
  return filtered;
}

/** Dispatch a tool call returned by an LLM. */
export async function runTool(
  tools: ChatTool[],
  name: string,
  args: unknown,
): Promise<unknown> {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`runTool: unknown tool "${name}"`);
  return tool.execute(args);
}

const DOCUMENT_STATUS_CODES: DocumentStatusCode[] = [
  "uploading",
  "uploaded",
  "metadata_processing",
  "metadata_ready",
  "expired",
  "certificating",
  "certificated",
  "rejected_by_signer",
  "pending_signature",
  "rejected_by_user",
  "failed",
];

const PAGINATION_SCHEMA = {
  page: { type: "integer", minimum: 1 },
  perPage: { type: "integer", minimum: 1, maximum: 100 },
} as const;

const SIGNER_METHOD_PROPERTIES = {
  verification_method: { type: "string", enum: ["Email", "Whatsapp", "DigitalCertificate"] },
  notification_methods: { type: "array", items: { type: "string", enum: ["Email", "Whatsapp"] } },
} as const;

const ASSIGNMENT_SIGNER_PROPERTIES = {
  id: { type: "string", description: "Existing signer id." },
  step: { type: "integer", minimum: 1 },
  ...SIGNER_METHOD_PROPERTIES,
} as const;

const TEMPLATE_SIGNER_SCHEMA = {
  type: "object",
  properties: {
    role_id: { type: "string" },
    ...ASSIGNMENT_SIGNER_PROPERTIES,
  },
  required: ["role_id", "id"],
} as const;

const ASSIGNMENT_SIGNER_SCHEMA = {
  type: "object",
  properties: ASSIGNMENT_SIGNER_PROPERTIES,
  required: ["id"],
} as const;

const ESTIMATE_ASSIGNMENT_SIGNER_SCHEMA = {
  type: "object",
  properties: {
    id: ASSIGNMENT_SIGNER_PROPERTIES.id,
    ...SIGNER_METHOD_PROPERTIES,
  },
} as const;

const ASSIGNMENT_ENTRY_SCHEMA = {
  type: "object",
  properties: {
    page_id: { type: "string" },
    fields: {
      type: "array",
      items: {
        type: "object",
        properties: {
          signer_id: { type: "string" },
          field_id: { type: "string" },
          display_settings: {
            type: "object",
            properties: {
              left: { type: "number" },
              top: { type: "number" },
              width: { type: "number" },
              height: { type: "number" },
              fontSize: { type: "number" },
              fontFamily: { type: "string" },
              backgroundColor: { type: "string" },
            },
            required: ["left", "top", "width", "height", "fontSize"],
          },
        },
        required: ["signer_id", "field_id", "display_settings"],
      },
    },
  },
  required: ["page_id", "fields"],
} as const;

/** Helper that builds a {@link ChatTool} from a JSON schema. */
function schemaTool<TArgs, TResult>(input: {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  execute: (args: TArgs) => Promise<TResult>;
}): ChatTool<TArgs, TResult> {
  const schema = structuredClone(input.schema);
  return {
    name: input.name,
    description: input.description,
    input_schema: schema,
    parameters: schema,
    execute: async (args) => {
      assertSchema(schema, args, input.name);
      return input.execute(args);
    },
  };
}

function assertSchema(schema: Record<string, unknown>, value: unknown, path: string): void {
  const alternatives = schema.anyOf;
  if (Array.isArray(alternatives)) {
    const matches = alternatives.some((candidate) => {
      try {
        if (!isRecord(candidate)) return false;
        assertSchema(candidate, value, path);
        return true;
      } catch {
        return false;
      }
    });
    if (!matches) throw new TypeError(`${path}: arguments do not match any allowed shape`);
  }

  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (types.length && !types.some((type) => matchesType(type, value))) {
    throw new TypeError(`${path}: expected ${types.join(" or ")}`);
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    throw new TypeError(`${path}: expected one of ${schema.enum.join(", ")}`);
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      throw new TypeError(`${path}: must be at least ${schema.minimum}`);
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      throw new TypeError(`${path}: must be at most ${schema.maximum}`);
    }
  }

  if (typeof value === "string" && typeof schema.format === "string") {
    if (schema.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      throw new TypeError(`${path}: invalid email`);
    }
    if (schema.format === "uri") {
      try {
        new URL(value);
      } catch {
        throw new TypeError(`${path}: invalid URI`);
      }
    }
    if (schema.format === "date-time" && !Number.isFinite(Date.parse(value))) {
      throw new TypeError(`${path}: invalid date-time`);
    }
  }

  if (Array.isArray(value) && isRecord(schema.items)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      throw new TypeError(`${path}: must contain at least ${schema.minItems} item(s)`);
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      throw new TypeError(`${path}: must contain at most ${schema.maxItems} item(s)`);
    }
    value.forEach((item, index) => assertSchema(schema.items as Record<string, unknown>, item, `${path}[${index}]`));
  }

  if (isRecord(value)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (typeof key === "string" && (!(key in value) || value[key] === undefined)) {
        throw new TypeError(`${path}.${key}: required`);
      }
    }
    if (isRecord(schema.properties)) {
      for (const [key, propertySchema] of Object.entries(schema.properties)) {
        if (value[key] !== undefined && isRecord(propertySchema)) {
          assertSchema(propertySchema, value[key], `${path}.${key}`);
        }
      }
    }
  }
}

function matchesType(type: unknown, value: unknown): boolean {
  switch (type) {
    case "object": return isRecord(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "boolean": return typeof value === "boolean";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return typeof value === "number" && Number.isInteger(value);
    case "null": return value === null;
    default: return true;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
