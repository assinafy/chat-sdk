/**
 * Helpers for converting chat history into the prompt format expected by
 * LLM SDKs (Anthropic + OpenAI). Provider-agnostic.
 */

import type { IncomingMessage } from "../adapters/base.js";

/** A neutral message envelope mirroring the OpenAI / Anthropic shape. */
export interface AiMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  /** Used when role === "tool" — id of the tool-call the result belongs to. */
  tool_call_id?: string;
  /** Optional name (sender display name or tool name). */
  name?: string;
}

/**
 * Convert a list of {@link IncomingMessage}s into LLM-shaped messages.
 *
 * - The bot's outbound messages should be supplied separately (typically the
 *   caller already tracks them per-thread in `state`); this helper only
 *   walks inbound history.
 * - Attachments are surfaced as a trailing line summarizing each one.
 */
export function toAiMessages(history: IncomingMessage[], botUserId?: string): AiMessage[] {
  return history.map<AiMessage>((m) => {
    const author = m.author ?? m.from;
    const isBot = botUserId !== undefined && author.id === botUserId;
    const summary = summarizeAttachments(m.attachments);
    const content = summary ? `${m.text}\n\n${summary}` : m.text;
    return {
      role: isBot ? "assistant" : "user",
      content,
      name: sanitizeName(author.displayName),
    };
  });
}

/**
 * Coerce a display name into the character set OpenAI accepts for the message
 * `name` field (`^[a-zA-Z0-9_-]+$`). Spaces and other disallowed characters
 * become underscores; an empty or all-invalid name returns `undefined` so the
 * field is omitted rather than sent as an invalid value. Anthropic ignores the
 * field, so this is safe for both providers.
 */
function sanitizeName(displayName: string | undefined): string | undefined {
  if (!displayName) return undefined;
  const safe = displayName.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "");
  return safe.length > 0 ? safe : undefined;
}

/**
 * Build a default system prompt for an Assinafy bot. Apps should treat this
 * as a starting point and customize it for their use case.
 */
export function defaultSystemPrompt(botName: string = "Assinafy"): string {
  return [
    `You are ${botName}, an assistant that helps users manage e-signature workflows on Assinafy.`,
    `You have access to tools that wrap the Assinafy API.`,
    `When the user asks you to do something, prefer calling a tool over speculating.`,
    `If a tool fails, summarize the error in plain language and suggest next steps.`,
    `Always confirm before destructive actions (delete, revoke, etc.).`,
  ].join(" ");
}

function summarizeAttachments(attachments: IncomingMessage["attachments"]): string | undefined {
  if (!attachments || attachments.length === 0) return undefined;
  return (
    `Attachments:\n` +
    attachments.map((a) => `- ${a.filename} (${a.contentType}): ${a.url}`).join("\n")
  );
}
