/**
 * examples/ai-bot.ts
 *
 * Demonstrates the AI tool-calling layer with the chat-sdk.dev pattern:
 * factory adapter + MemoryStateAdapter + capitalized card helpers, plus
 * Anthropic's tool-calling loop driving the Assinafy client.
 *
 * Run with:
 *   ANTHROPIC_API_KEY=... npx tsx examples/ai-bot.ts "Show me my pending documents"
 *
 * NOTE: `@anthropic-ai/sdk` is not a dependency of this SDK — the import
 * lives only in this example. Install it in your own project if you want to
 * use this pattern.
 */

import {
  Chat,
  AssinafyClient,
  createMemoryAdapter,
  MemoryStateAdapter,
  createChatTools,
  runTool,
  defaultSystemPrompt,
} from "../src/index.js";

import Anthropic from "@anthropic-ai/sdk";

async function main(): Promise<void> {
  const client = AssinafyClient.fromEnv();
  const tools = createChatTools(client);
  const memory = createMemoryAdapter();
  const chat = new Chat({
    userName: "Assinafy",
    adapters: { memory },
    state: new MemoryStateAdapter(),
    client,
  });

  const anthropic = new Anthropic();

  chat.onFallback(async (thread, msg) => {
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: msg.text }];
    while (true) {
      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        system: defaultSystemPrompt("Assinafy"),
        tools: tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool.InputSchema,
        })),
        messages,
      });

      const toolUses = response.content.filter((c) => c.type === "tool_use") as Anthropic.ToolUseBlock[];
      const textParts = response.content.filter((c) => c.type === "text") as Anthropic.TextBlock[];

      if (toolUses.length === 0) {
        await thread.post(textParts.map((t) => t.text).join("\n"));
        return;
      }

      messages.push({ role: "assistant", content: response.content });
      const toolResults: Anthropic.ToolResultBlockParam[] = [];
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
