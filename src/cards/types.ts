/**
 * Card primitives — declarative descriptions of rich messages.
 *
 * The public builders use names such as Card, CardText, Section, Fields,
 * Button, Actions, LinkButton, Image, Divider, Table, Select, and
 * RadioSelect. Tagged union types use lowercase `type` strings so the
 * underlying object literals stay JSON-serializable and easy to construct by
 * hand:
 *
 * ```ts
 * await thread.post({
 *   card: {
 *     type: "card",
 *     title: "Order Confirmed",
 *     children: [
 *       { type: "text", content: "Your order #1234 has been shipped." },
 *       { type: "divider" },
 *       { type: "link-button", label: "Track Order", url: "https://example.com/track/1234" },
 *     ],
 *   },
 *   fallbackText: "Order #1234 confirmed",
 * });
 * ```
 *
 * Most callers will prefer the ergonomic builder functions exported from
 * `./builders.ts` (`Card`, `Text`, `Divider`, `LinkButton`, …).
 */

/** Any renderable card primitive. */
export type CardElement =
  | Card
  | TextBlock
  | HeadingBlock
  | DividerBlock
  | SectionBlock
  | FieldsBlock
  | LinkButton
  | ActionButton
  | ActionsBlock
  | ImageBlock
  | TableBlock
  | SelectBlock
  | RadioSelectBlock
  | DocumentPreview
  | SignerStatus;

/** Top-level card. Contains zero or more child elements. */
export interface Card {
  type: "card";
  title?: string;
  subtitle?: string;
  children: CardElement[];
  /** Optional accent color (hex). Adapters may ignore this. */
  accentColor?: string;
}

export interface TextBlock {
  type: "text";
  content: string;
  /** Hint to the renderer that the text contains markdown. */
  markdown?: boolean;
}

export interface HeadingBlock {
  type: "heading";
  level: 1 | 2 | 3;
  content: string;
}

export interface DividerBlock {
  type: "divider";
}

/** Groups related child elements with an optional label. */
export interface SectionBlock {
  type: "section";
  label?: string;
  children: CardElement[];
}

export interface FieldsBlock {
  type: "fields";
  fields: Array<{ label: string; value: string }>;
}

export interface LinkButton {
  type: "link-button";
  label: string;
  url: string;
  style?: "primary" | "secondary" | "danger";
}

/** Triggers an `onAction` event on the bot when clicked. */
export interface ActionButton {
  type: "button";
  /** Identifier delivered to `onAction` handlers. */
  id: string;
  label: string;
  /** Optional opaque payload echoed back to the handler. */
  value?: string;
  style?: "primary" | "secondary" | "danger";
  /** Free-form action discriminator some platforms support. */
  actionType?: string;
  /** Optional callback URL for platforms that support per-button callbacks. */
  callbackUrl?: string;
}

/** A horizontal group of buttons. */
export interface ActionsBlock {
  type: "actions";
  children: Array<ActionButton | LinkButton>;
}

export interface ImageBlock {
  type: "image";
  url: string;
  alt?: string;
}

export interface TableBlock {
  type: "table";
  headers: string[];
  rows: string[][];
  /** Per-column alignment. Length should match `headers.length` when set. */
  align?: Array<"left" | "center" | "right">;
}

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectBlock {
  type: "select";
  id: string;
  label?: string;
  placeholder?: string;
  options: SelectOption[];
}

export interface RadioSelectBlock {
  type: "radio-select";
  id: string;
  label?: string;
  options: SelectOption[];
}

/**
 * Convenience block for rendering a quick document summary. Adapters render
 * this however they like — typically title + status badge + thumbnail + link.
 */
export interface DocumentPreview {
  type: "document-preview";
  documentId: string;
  name: string;
  status: string;
  thumbnailUrl?: string;
  signingUrl?: string;
}

/** Compact list of signers and whether each has completed. */
export interface SignerStatus {
  type: "signer-status";
  signers: Array<{
    name: string;
    email?: string | null;
    completed: boolean;
  }>;
}

/**
 * What handlers can pass to {@link Thread.post}:
 *  - a plain string,
 *  - a {@link Card} directly,
 *  - or `{ text?, card?, fallbackText?, attachments? }`.
 */
export type MessageBody =
  | string
  | Card
  | {
      text?: string;
      card?: Card;
      fallbackText?: string;
      attachments?: Array<{ filename: string; contentType: string; url: string; size?: number }>;
    };

/** Type-guard utility. */
export function isCard(value: unknown): value is Card {
  return typeof value === "object" && value !== null && (value as { type?: string }).type === "card";
}
