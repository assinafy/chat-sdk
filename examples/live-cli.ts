/**
 * examples/live-cli.ts
 *
 * Tiny REPL — drives stdin through a Chat instance with the in-memory
 * adapter and prints the bot's responses on stdout. Useful for kicking the
 * tires on an integration without wiring up a real platform.
 *
 * Run with:
 *   ASSINAFY_API_KEY=... ASSINAFY_ACCOUNT_ID=... \
 *   ASSINAFY_BASE_URL=https://sandbox.assinafy.com.br/v1 \
 *     npx tsx examples/live-cli.ts
 */
import { createInterface } from "node:readline/promises";
import {
  Chat,
  AssinafyClient,
  createMemoryAdapter,
  MemoryStateAdapter,
  Card,
  Text,
  DocumentPreview,
  SignerStatus,
  renderText,
} from "../src/index.js";

async function main(): Promise<void> {
  if (!process.env.ASSINAFY_API_KEY && !process.env.ASSINAFY_ACCESS_TOKEN) {
    throw new Error("ASSINAFY_API_KEY or ASSINAFY_ACCESS_TOKEN is required");
  }
  const accountId = process.env.ASSINAFY_ACCOUNT_ID;
  if (!accountId) throw new Error("ASSINAFY_ACCOUNT_ID is required");

  const client = AssinafyClient.fromEnv();
  const memory = createMemoryAdapter();
  const chat = new Chat({
    userName: "Assinafy",
    adapters: { memory },
    state: new MemoryStateAdapter(),
    client,
  });

  chat.onCommand("docs", async (thread) => {
    const page = await client.documents.list(accountId, { perPage: 5 });
    await thread.post(
      Card({
        title: "Recent documents",
        children: page.data.map((d) =>
          DocumentPreview({
            documentId: d.id,
            name: d.name,
            status: d.status,
            signingUrl: d.signing_url ?? undefined,
          }),
        ),
      }),
    );
  });

  chat.onCommand("status", async (thread, msg) => {
    const id = msg.text.replace(/^[/!]status\s*/i, "").trim();
    if (!id) {
      await thread.post("Usage: `/status <document-id>`");
      return;
    }
    const doc = await client.documents.get(id);
    await thread.post(
      Card({
        title: "Document status",
        children: [
          Text(doc.name),
          SignerStatus(
            doc.assignment?.summary.signers.map((s) => ({
              name: s.full_name,
              email: s.email,
              completed: s.completed,
            })) ?? [],
          ),
        ],
      }),
    );
  });

  chat.onFallback(async (thread) => {
    await thread.post("Commands: /docs, /status <document-id>");
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  console.log("Type a command (e.g. `/docs`). Ctrl-C to exit.");
  while (true) {
    const line = (await rl.question("> ")).trim();
    if (!line) continue;
    const before = memory.sentCount;
    await memory.receive({ text: line });
    for (const out of memory.outbox.slice(before)) {
      if (out.text) console.log(out.text);
      if (out.card) console.log(renderText(out.card));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
