import { describe, it, expect, vi } from "vitest";
import { createChatTools, runTool, toAiMessages, defaultSystemPrompt } from "../../src/ai/index.js";
import type { AssinafyClient } from "../../src/client/index.js";

function fakeClient(): AssinafyClient {
  return {
    accountId: "acct",
    signers: {
      list: vi.fn().mockResolvedValue({
        data: [{ id: "s1", full_name: "Alice" }],
        pagination: { currentPage: 1, pageCount: 1, perPage: 50, totalCount: 1 },
      }),
      create: vi.fn().mockResolvedValue({ id: "s2", full_name: "Bob" }),
    },
    documents: {
      list: vi.fn().mockResolvedValue({
        data: [{ id: "d1" }],
        pagination: { currentPage: 1, pageCount: 1, perPage: 50, totalCount: 1 },
      }),
      get: vi.fn().mockResolvedValue({ id: "d1" }),
      statuses: vi.fn().mockResolvedValue([{ code: "uploading", deletable: false }]),
      activities: vi.fn().mockResolvedValue([]),
      sendPublicToken: vi.fn().mockResolvedValue({ document: { id: "d1", name: "D", page_count: "1" } }),
      verify: vi.fn().mockResolvedValue({ id: "d1" }),
    },
    fields: {
      list: vi.fn().mockResolvedValue({
        data: [{ id: "f1", name: "Text", type: "text" }],
        pagination: { currentPage: 1, pageCount: 1, perPage: 50, totalCount: 1 },
      }),
      create: vi.fn().mockResolvedValue({ id: "f2", name: "Text", type: "text" }),
      get: vi.fn().mockResolvedValue({ id: "f1", name: "Text", type: "text" }),
      update: vi.fn().mockResolvedValue({ id: "f1", name: "Text 2", type: "text" }),
      remove: vi.fn().mockResolvedValue(undefined),
      validate: vi.fn().mockResolvedValue({ type: "text", success: true, error_message: "" }),
      validateMultiple: vi.fn().mockResolvedValue([{ field_id: "f1", success: true, error_message: "" }]),
      listTypes: vi.fn().mockResolvedValue([{ type: "text", name: "Text" }]),
    },
    assignments: {
      create: vi.fn().mockResolvedValue({ id: "a1" }),
      estimateCost: vi.fn().mockResolvedValue({ total: 100, currency: "BRL" }),
    },
    templates: {
      list: vi.fn().mockResolvedValue({
        data: [{ id: "t1", name: "T" }],
        pagination: { currentPage: 1, pageCount: 1, perPage: 50, totalCount: 1 },
      }),
      instantiate: vi.fn().mockResolvedValue({ id: "d2" }),
    },
    tags: {
      list: vi.fn().mockResolvedValue({
        data: [{ id: "tag1", name: "x" }],
        pagination: { currentPage: 1, pageCount: 1, perPage: 50, totalCount: 1 },
      }),
      create: vi.fn().mockResolvedValue({ id: "tag2", name: "x" }),
      setForDocument: vi.fn().mockResolvedValue([{ id: "tag1", name: "x" }]),
    },
    webhooks: {
      getSubscription: vi.fn().mockResolvedValue(null),
      updateSubscription: vi.fn().mockResolvedValue({
        events: ["document_ready"],
        is_active: true,
        url: "https://example.com/webhook",
        email: "ops@example.com",
      }),
      inactivate: vi.fn().mockResolvedValue({ is_active: false }),
      listEventTypes: vi.fn().mockResolvedValue([{ id: "document_ready", description: "ready" }]),
      listDispatches: vi.fn().mockResolvedValue({
        data: [],
        pagination: { currentPage: 1, pageCount: 1, perPage: 50, totalCount: 0 },
      }),
      retryDispatch: vi.fn().mockResolvedValue({ id: "wh1", delivered: true }),
    },
  } as unknown as AssinafyClient;
}

describe("createChatTools", () => {
  it("ships every documented tool", () => {
    const tools = createChatTools(fakeClient());
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain("list_signers");
    expect(names).toContain("create_signer");
    expect(names).toContain("get_signer");
    expect(names).toContain("update_signer");
    expect(names).toContain("delete_signer");
    expect(names).toContain("list_documents");
    expect(names).toContain("get_document");
    expect(names).toContain("delete_document");
    expect(names).toContain("document_activities");
    expect(names).toContain("create_assignment");
    expect(names).toContain("estimate_assignment_cost");
    expect(names).toContain("instantiate_template");
    expect(names).toContain("list_templates");
    expect(names).toContain("list_tags");
    expect(names).toContain("create_tag");
    expect(names).toContain("tag_document");
    expect(names).toContain("list_fields");
    expect(names).toContain("create_field");
    expect(names).toContain("get_field");
    expect(names).toContain("update_field");
    expect(names).toContain("delete_field");
    expect(names).toContain("validate_field");
    expect(names).toContain("validate_fields");
    expect(names).toContain("list_field_types");
    expect(names).toContain("get_webhook_subscription");
    expect(names).toContain("update_webhook_subscription");
    expect(names).toContain("inactivate_webhook_subscription");
    expect(names).toContain("list_webhook_event_types");
    expect(names).toContain("list_webhook_dispatches");
    expect(names).toContain("retry_webhook_dispatch");
    expect(names).toContain("send_public_token");
    expect(names).toContain("verify_document");
    expect(names).toContain("list_document_statuses");
  });

  it("each tool has input_schema and parameters that point to the same object", () => {
    const tools = createChatTools(fakeClient());
    for (const t of tools) {
      expect(t.input_schema).toBe(t.parameters);
    }
  });

  it("filters by include / exclude", () => {
    const client = fakeClient();
    const onlyRead = createChatTools(client, { include: ["list_signers", "get_document"] });
    expect(onlyRead.map((t) => t.name).sort()).toEqual(["get_document", "list_signers"]);
    const noDelete = createChatTools(client, { exclude: ["delete_signer", "delete_document"] });
    expect(noDelete.find((t) => t.name === "delete_signer")).toBeUndefined();
    expect(noDelete.find((t) => t.name === "delete_document")).toBeUndefined();
  });

  it("runTool dispatches by name and resolves the client call", async () => {
    const client = fakeClient();
    const tools = createChatTools(client);
    const result = await runTool(tools, "list_signers", { search: "Alice" });
    expect((client.signers.list as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("acct", {
      search: "Alice",
      page: undefined,
      perPage: undefined,
    });
    expect(result).toEqual({
      data: [{ id: "s1", full_name: "Alice" }],
      pagination: { currentPage: 1, pageCount: 1, perPage: 50, totalCount: 1 },
    });
  });

  it("create_signer respects default accountId", async () => {
    const client = fakeClient();
    const tools = createChatTools(client);
    await runTool(tools, "create_signer", { full_name: "Bob", email: "b@example.com" });
    expect((client.signers.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith("acct", {
      full_name: "Bob",
      email: "b@example.com",
      whatsapp_phone_number: undefined,
    });
  });

  it("runTool rejects unknown tool names", async () => {
    const tools = createChatTools(fakeClient());
    await expect(runTool(tools, "no_such_tool", {})).rejects.toThrow(/unknown tool/);
  });
});

describe("toAiMessages", () => {
  it("converts incoming messages into chat-shaped messages", () => {
    const ai = toAiMessages(
      [
        {
          id: "m1",
          threadId: "t",
          text: "hi",
          author: { id: "u1", displayName: "Alice" },
          isMention: false,
          sentAt: new Date(),
          raw: null,
        },
        {
          id: "m2",
          threadId: "t",
          text: "hi back",
          author: { id: "bot" },
          isMention: false,
          sentAt: new Date(),
          raw: null,
        },
      ],
      "bot",
    );
    expect(ai).toEqual([
      { role: "user", content: "hi", name: "Alice" },
      { role: "assistant", content: "hi back", name: undefined },
    ]);
  });

  it("summarizes attachments", () => {
    const ai = toAiMessages([
      {
        id: "m1",
        threadId: "t",
        text: "see attached",
        author: { id: "u1" },
        isMention: false,
        sentAt: new Date(),
        attachments: [{ filename: "x.pdf", contentType: "application/pdf", url: "https://x" }],
        raw: null,
      },
    ]);
    expect(ai[0]!.content).toContain("Attachments:");
    expect(ai[0]!.content).toContain("x.pdf");
  });

  it("sanitizes display names to the charset OpenAI accepts for `name`", () => {
    const ai = toAiMessages([
      {
        id: "m1",
        threadId: "t",
        text: "hi",
        author: { id: "u1", displayName: "Test User (Acct #2)" },
        isMention: false,
        sentAt: new Date(),
        raw: null,
      },
      {
        id: "m2",
        threadId: "t",
        text: "yo",
        author: { id: "u2", displayName: "***" },
        isMention: false,
        sentAt: new Date(),
        raw: null,
      },
    ]);
    expect(ai[0]!.name).toBe("Test_User_Acct_2");
    expect(/^[a-zA-Z0-9_-]+$/.test(ai[0]!.name!)).toBe(true);
    expect(ai[1]!.name).toBeUndefined();
  });
});

describe("defaultSystemPrompt", () => {
  it("includes the bot name", () => {
    expect(defaultSystemPrompt("My Bot")).toContain("My Bot");
  });
});
