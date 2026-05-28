/**
 * LLM tool definitions for the Assinafy API.
 *
 * `createChatTools(client)` returns an array of provider-agnostic tool
 * descriptors that expose the most common Assinafy operations as
 * JSON-schema-typed tools. The shape is compatible with both Anthropic's
 * `messages.create({ tools })` and OpenAI's `chat.completions` tool-calling.
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
  AssignmentSignerInput,
  CreateAssignmentInput,
  CreateFieldInput,
  CreateSignerInput,
  DocumentStatusCode,
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
  /** Run the tool with validated arguments. */
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

  const tools: ChatTool[] = [
    schemaTool({
      name: "list_signers",
      description: "List signers under an account, with optional search.",
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          search: { type: "string", description: "Substring filter for full name or email." },
          page: { type: "integer", minimum: 1 },
          perPage: { type: "integer", minimum: 1, maximum: 200 },
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
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          signerId: { type: "string" },
        },
        required: accountIdRequired ? ["accountId", "signerId"] : ["signerId"],
      },
      execute: async (args: { accountId?: string; signerId: string }) =>
        client.signers.get(accountIdOrDefault(args.accountId), args.signerId),
    }),

    schemaTool({
      name: "update_signer",
      description: "Update a signer's name, email, or WhatsApp number.",
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          signerId: { type: "string" },
          full_name: { type: "string" },
          email: { type: "string", format: "email" },
          whatsapp_phone_number: { type: "string" },
        },
        required: accountIdRequired ? ["accountId", "signerId"] : ["signerId"],
      },
      execute: async (args: UpdateSignerInput & { accountId?: string; signerId: string }) =>
        client.signers.update(accountIdOrDefault(args.accountId), args.signerId, {
          full_name: args.full_name,
          email: args.email,
          whatsapp_phone_number: args.whatsapp_phone_number,
        }),
    }),

    schemaTool({
      name: "delete_signer",
      description: "Delete a signer by id.",
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          signerId: { type: "string" },
        },
        required: accountIdRequired ? ["accountId", "signerId"] : ["signerId"],
      },
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
          tags: {
            description: "Tag id(s) to filter by.",
            anyOf: [{ type: "string" }, { type: "array", items: { type: "string" } }],
          },
          sort: { type: "string", description: "Sort string accepted by the API, e.g. `-created_at`." },
          page: { type: "integer", minimum: 1 },
          perPage: { type: "integer", minimum: 1, maximum: 200 },
        },
        required: accountIdRequired ? ["accountId"] : [],
      },
      execute: async (args: ListDocumentsQuery & { accountId?: string }) =>
        client.documents.list(accountIdOrDefault(args.accountId), {
          status: args.status as DocumentStatusCode | DocumentStatusCode[] | undefined,
          search: args.search,
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
            items: { type: "string" },
            description: "Legacy signer ID list. Prefer `signers` for new integrations.",
          },
          signerIds: {
            type: "array",
            items: { type: "string" },
            description: "Deprecated alias for `signer_ids`.",
          },
          signers: {
            type: "array",
            items: ASSIGNMENT_SIGNER_SCHEMA,
            description: "Existing signer configurations. For creation, each entry must include `id`.",
          },
          entries: {
            type: "array",
            items: { type: "object", additionalProperties: true },
            description: "Collect-method field placement entries.",
          },
          message: { type: "string" },
          expires_at: { type: "string", format: "date-time" },
          copy_receivers: { type: "array", items: { type: "string" } },
        },
        required: ["documentId", "method"],
      },
      execute: async (args: CreateAssignmentInput & { documentId: string; method: AssignmentMethod }) =>
        client.assignments.create(args.documentId, {
          method: args.method,
          signer_ids: args.signer_ids,
          signerIds: args.signerIds,
          signers: args.signers,
          entries: args.entries,
          message: args.message,
          expires_at: args.expires_at,
          copy_receivers: args.copy_receivers,
        }),
    }),

    schemaTool({
      name: "estimate_assignment_cost",
      description: "Estimate the cost of an assignment without creating it.",
      schema: {
        type: "object",
        properties: {
          documentId: { type: "string" },
          method: { type: "string", enum: ["virtual", "collect"] },
          signers: { type: "array", items: ASSIGNMENT_SIGNER_SCHEMA },
          signer_ids: { type: "array", items: { type: "string" } },
          entries: {
            type: "array",
            items: { type: "object", additionalProperties: true },
            description: "Collect-method field placement entries.",
          },
        },
        required: ["documentId", "method"],
      },
      execute: async (args: {
        documentId: string;
        method: AssignmentMethod;
        signers?: AssignmentSignerInput[];
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
          page: { type: "integer" },
          perPage: { type: "integer" },
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
          signers: { type: "array", items: TEMPLATE_SIGNER_SCHEMA },
          tags: { type: "array", items: { type: "string" } },
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
      }) =>
        client.templates.instantiate(accountIdOrDefault(args.accountId), args.templateId, {
          name: args.name,
          message: args.message,
          signers: args.signers,
          tags: args.tags,
          expires_at: args.expires_at,
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
      description: "Replace the tags attached to a document with the given tag names.",
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          documentId: { type: "string" },
          tags: {
            type: "array",
            items: { type: "string" },
            description: "Tag names. Unknown names are created by the API.",
          },
          tagIds: {
            type: "array",
            items: { type: "string" },
            description: "Deprecated alias for `tags`.",
          },
        },
        required: accountIdRequired
          ? ["accountId", "documentId", "tags"]
          : ["documentId", "tags"],
      },
      execute: async (args: { accountId?: string; documentId: string; tags?: string[]; tagIds?: string[] }) =>
        client.tags.setForDocument(accountIdOrDefault(args.accountId), args.documentId, args.tags ?? args.tagIds ?? []),
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
          search: { type: "string" },
          page: { type: "integer", minimum: 1 },
          perPage: { type: "integer", minimum: 1, maximum: 200 },
        },
        required: accountIdRequired ? ["accountId"] : [],
      },
      execute: async (args: ListFieldsQuery & { accountId?: string }) =>
        client.fields.list(accountIdOrDefault(args.accountId), {
          include_inactive: args.include_inactive,
          include_standard: args.include_standard,
          search: args.search,
          page: args.page,
          perPage: args.perPage,
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
          regex: { type: "string" },
          is_required: { type: "boolean" },
          is_active: { type: "boolean" },
        },
        required: accountIdRequired ? ["accountId", "type", "name"] : ["type", "name"],
      },
      execute: async (args: CreateFieldInput & { accountId?: string }) =>
        client.fields.create(accountIdOrDefault(args.accountId), {
          type: args.type,
          name: args.name,
          regex: args.regex,
          is_required: args.is_required,
          is_active: args.is_active,
        }),
    }),

    schemaTool({
      name: "get_field",
      description: "Fetch one field definition by id.",
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          fieldId: { type: "string" },
        },
        required: accountIdRequired ? ["accountId", "fieldId"] : ["fieldId"],
      },
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
          type: { type: "string" },
          name: { type: "string" },
          regex: { type: ["string", "null"] },
          is_required: { type: "boolean" },
          is_active: { type: "boolean" },
        },
        required: accountIdRequired ? ["accountId", "fieldId"] : ["fieldId"],
      },
      execute: async (args: UpdateFieldInput & { accountId?: string; fieldId: string }) =>
        client.fields.update(accountIdOrDefault(args.accountId), args.fieldId, {
          type: args.type,
          name: args.name,
          regex: args.regex,
          is_required: args.is_required,
          is_active: args.is_active,
        }),
    }),

    schemaTool({
      name: "delete_field",
      description: "Delete a field definition. The API rejects fields already used by documents.",
      schema: {
        type: "object",
        properties: {
          accountId: accountIdSchema,
          fieldId: { type: "string" },
        },
        required: accountIdRequired ? ["accountId", "fieldId"] : ["fieldId"],
      },
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
          page: { type: "integer", minimum: 1 },
          perPage: { type: "integer", minimum: 1, maximum: 200 },
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
        "Ask Assinafy to deliver a fresh public access token to a recipient (e.g. resend the signature link).",
      schema: {
        type: "object",
        properties: {
          documentId: { type: "string" },
          recipient: { type: "string" },
          channel: { type: "string", enum: ["email", "whatsapp"] },
        },
        required: ["documentId", "recipient", "channel"],
      },
      execute: async (args: { documentId: string; recipient: string; channel: "email" | "whatsapp" }) =>
        client.documents.sendPublicToken(args.documentId, {
          recipient: args.recipient,
          channel: args.channel,
        }),
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

const TEMPLATE_SIGNER_SCHEMA = {
  type: "object",
  properties: {
    role_id: { type: "string" },
    id: { type: "string", description: "Existing signer id." },
    step: { type: "integer", minimum: 1 },
    verification_method: { type: "string" },
    notification_methods: { type: "array", items: { type: "string" } },
  },
  required: ["role_id"],
} as const;

const ASSIGNMENT_SIGNER_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", description: "Existing signer id." },
    step: { type: "integer", minimum: 1 },
    verification_method: { type: "string" },
    notification_methods: { type: "array", items: { type: "string" } },
  },
  required: [],
} as const;

/** Helper that builds a {@link ChatTool} from a JSON schema. */
function schemaTool<TArgs, TResult>(input: {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  execute: (args: TArgs) => Promise<TResult>;
}): ChatTool<TArgs, TResult> {
  return {
    name: input.name,
    description: input.description,
    input_schema: input.schema,
    parameters: input.schema,
    execute: input.execute,
  };
}
