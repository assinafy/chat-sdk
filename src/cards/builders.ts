/**
 * Ergonomic builders for {@link CardElement}s.
 *
 * The capitalized helpers (`Card`, `Text`, `Divider`, `LinkButton`, …) are
 * the canonical API. Lowercase aliases (`card`, `text`, …) are kept for
 * backwards compatibility and brevity in tests.
 *
 * ```ts
 * import { Card, Heading, Text, Divider, LinkButton, Button, Actions } from "@assinafy/chat-sdk/cards";
 *
 * const message = Card({
 *   title: "Document sent",
 *   children: [
 *     Heading(2, "Contract.pdf"),
 *     Text("Sent to bill@febacapital.com for signature."),
 *     Divider(),
 *     Actions([
 *       LinkButton({ label: "Open", url: doc.signing_url! }),
 *       Button({ id: "remind", label: "Remind", style: "secondary" }),
 *     ]),
 *   ],
 * });
 * ```
 */

import type {
  ActionButton,
  ActionsBlock,
  Card as CardShape,
  CardElement,
  DividerBlock,
  DocumentPreview as DocumentPreviewShape,
  FieldsBlock,
  HeadingBlock,
  ImageBlock,
  LinkButton as LinkButtonShape,
  RadioSelectBlock,
  SectionBlock,
  SelectBlock,
  SelectOption,
  SignerStatus as SignerStatusShape,
  TableBlock,
  TextBlock,
} from "./types.js";

// ---------------------------------------------------------------------------
// Canonical capitalized helpers.
// ---------------------------------------------------------------------------

export function Card(input: Omit<CardShape, "type">): CardShape {
  return { type: "card", ...input };
}

export function Text(content: string, options: { markdown?: boolean } = {}): TextBlock {
  return { type: "text", content, ...options };
}

/** Alias of {@link Text}. */
export const CardText = Text;

export function Heading(level: 1 | 2 | 3, content: string): HeadingBlock {
  return { type: "heading", level, content };
}

export function Divider(): DividerBlock {
  return { type: "divider" };
}

export function Section(input: Omit<SectionBlock, "type">): SectionBlock {
  return { type: "section", ...input };
}

export function Fields(entries: FieldsBlock["fields"]): FieldsBlock {
  return { type: "fields", fields: entries };
}

export function LinkButton(input: Omit<LinkButtonShape, "type">): LinkButtonShape {
  return { type: "link-button", ...input };
}

export function Button(input: Omit<ActionButton, "type">): ActionButton {
  return { type: "button", ...input };
}

export function Actions(children: ActionsBlock["children"]): ActionsBlock {
  return { type: "actions", children };
}

export function Image(input: Omit<ImageBlock, "type">): ImageBlock {
  return { type: "image", ...input };
}

export function Table(input: Omit<TableBlock, "type">): TableBlock {
  return { type: "table", ...input };
}

export function Select(input: Omit<SelectBlock, "type">): SelectBlock {
  return { type: "select", ...input };
}

export function RadioSelect(input: Omit<RadioSelectBlock, "type">): RadioSelectBlock {
  return { type: "radio-select", ...input };
}

export function Option(input: SelectOption): SelectOption {
  return input;
}

export function DocumentPreview(input: Omit<DocumentPreviewShape, "type">): DocumentPreviewShape {
  return { type: "document-preview", ...input };
}

export function SignerStatus(signers: SignerStatusShape["signers"]): SignerStatusShape {
  return { type: "signer-status", signers };
}

/** Compose children, filtering out null/undefined/false. */
export function Children(...items: Array<CardElement | null | undefined | false>): CardElement[] {
  return items.filter((x): x is CardElement => Boolean(x));
}

// ---------------------------------------------------------------------------
// Lowercase aliases (kept for backwards compatibility + brevity in tests).
// ---------------------------------------------------------------------------

export const card = Card;
export const text = Text;
export const heading = Heading;
export const divider = Divider;
export const section = Section;
export const fields = Fields;
export const linkButton = LinkButton;
export const button = Button;
export const actions = Actions;
export const image = Image;
export const table = Table;
export const select = Select;
export const radioSelect = RadioSelect;
export const option = Option;
export const documentPreview = DocumentPreview;
export const signerStatus = SignerStatus;
export const children = Children;
