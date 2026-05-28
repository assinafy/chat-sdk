/**
 * examples/basic-bot.ts
 *
 * Minimal bot wired to the in-memory adapter. Demonstrates the chat-sdk.dev
 * pattern: factory adapter, `MemoryStateAdapter`, capitalized card helpers,
 * `onCommand` for slash commands.
 *
 * Run with: `npx tsx examples/basic-bot.ts <document-id>`
 */

import {
  Chat,
  AssinafyClient,
  createMemoryAdapter,
  MemoryStateAdapter,
  Card,
  Divider,
  DocumentPreview,
  SignerStatus,
} from "../src/index.js";

async function main(): Promise<void> {
  const client = AssinafyClient.fromEnv();
  const memory = createMemoryAdapter();
  const chat = new Chat({
    userName: "Assinafy Bot",
    adapters: { memory },
    state: new MemoryStateAdapter(),
    client,
  });

  chat.onCommand("status", async (thread, msg) => {
    const id = msg.text.replace(/^\/status\s*/, "").trim();
    if (!id) {
      await thread.post("Usage: `/status <document-id>`");
      return;
    }
    try {
      const doc = await client.documents.get(id);
      await thread.post({
        card: Card({
          title: "Document status",
          children: [
            DocumentPreview({
              documentId: doc.id,
              name: doc.name,
              status: doc.status,
              signingUrl: doc.signing_url ?? undefined,
            }),
            Divider(),
            SignerStatus(
              doc.assignment?.summary.signers.map((s) => ({
                name: s.full_name,
                email: s.email,
                completed: s.completed,
              })) ?? [],
            ),
          ],
        }),
        fallbackText: `Document ${doc.name} — ${doc.status}`,
      });
    } catch (err) {
      await thread.post(`Could not load document: ${(err as Error).message}`);
    }
  });

  // Drive a synthetic conversation.
  await memory.receive({ text: "/status " + (process.argv[2] ?? "") });
  console.log("Outbox:");
  for (const m of memory.outbox) {
    console.log(JSON.stringify(m, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
