/**
 * examples/ai-bot.ts
 *
 * Demonstrates the AI tool-calling layer with the chat-sdk.dev pattern:
 * factory adapter + MemoryStateAdapter + capitalized card helpers, plus
 * Anthropic's tool-calling loop driving the Assinafy client.
 *
 * Run with:
 *   ASSINAFY_API_KEY=... ASSINAFY_ACCOUNT_ID=... ANTHROPIC_API_KEY=... \
 *     npx tsx examples/ai-bot.ts "Show me my pending documents"
 *
 * This example uses the native `fetch` available in Node 24, so it needs no
 * Anthropic SDK dependency.
 */

import {
  Chat,
  AssinafyClient,
  createMemoryAdapter,
  MemoryStateAdapter,
} from "../src/index.js";
import { createChatTools, defaultSystemPrompt, runTool, type ChatTool } from "../src/ai/index.js";

interface TextBlock {
  type: "text";
  text: string;
}

interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

type ContentBlock = TextBlock | ToolUseBlock;

interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

type Message = {
  role: "user" | "assistant";
  content: string | ContentBlock[] | ToolResultBlock[];
};

async function createMessage(
  apiKey: string,
  model: string,
  system: string,
  tools: ChatTool[],
  messages: Message[],
): Promise<{ content: ContentBlock[] }> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 1024,
      system,
      tools: tools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema,
      })),
      messages,
    }),
  });
  if (!response.ok) {
    throw new Error(`Anthropic API ${response.status}: ${await response.text()}`);
  }
  return response.json() as Promise<{ content: ContentBlock[] }>;
}

async function main(): Promise<void> {
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  if (!anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is required");
  if (!process.env.ASSINAFY_API_KEY && !process.env.ASSINAFY_ACCESS_TOKEN) {
    throw new Error("ASSINAFY_API_KEY or ASSINAFY_ACCESS_TOKEN is required");
  }
  if (!process.env.ASSINAFY_ACCOUNT_ID) throw new Error("ASSINAFY_ACCOUNT_ID is required");

  const client = AssinafyClient.fromEnv();
  const tools = createChatTools(client);
  const memory = createMemoryAdapter();
  const chat = new Chat({
    userName: "Assinafy",
    adapters: { memory },
    state: new MemoryStateAdapter(),
    client,
  });

  chat.onFallback(async (thread, msg) => {
    const messages: Message[] = [{ role: "user", content: msg.text }];
    while (true) {
      const response = await createMessage(
        anthropicApiKey,
        process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
        defaultSystemPrompt("Assinafy"),
        tools,
        messages,
      );

      const toolUses = response.content.filter((block): block is ToolUseBlock => block.type === "tool_use");
      const textParts = response.content.filter((block): block is TextBlock => block.type === "text");

      if (toolUses.length === 0) {
        await thread.post(textParts.map((t) => t.text).join("\n"));
        return;
      }

      messages.push({ role: "assistant", content: response.content });
      const toolResults: ToolResultBlock[] = [];
      for (const use of toolUses) {
        try {
          const out = await runTool(tools, use.name, use.input);
          toolResults.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(out) });
        } catch (err) {
          toolResults.push({
            type: "tool_result",
            tool_use_id: use.id,
            is_error: true,
            content: (err as Error).message,
          });
        }
      }
      messages.push({ role: "user", content: toolResults });
    }
  });

  await memory.receive({
    text: process.argv.slice(2).join(" ") || "List the documents that are currently pending signature.",
    isMention: true,
  });

  for (const m of memory.outbox) console.log(m.text ?? "[card omitted]");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
