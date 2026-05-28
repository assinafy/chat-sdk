/**
 * Card primitives + builders + renderers, re-exported in a flat namespace.
 *
 * `Card`, `LinkButton`, `DocumentPreview`, and `SignerStatus` are deliberately
 * exposed as **both** a type (the object shape) and a value (a builder
 * function). TypeScript keeps type and value namespaces separate, so the
 * merged declarations below let callers write either `import { Card }`
 * (the builder) or `import type { Card }` (the type) and get what they expect.
 */

// Types — re-exported via aliases that we'll merge with the builders below.
export type {
  CardElement,
  TextBlock,
  HeadingBlock,
  DividerBlock,
  SectionBlock,
  FieldsBlock,
  ActionButton,
  ActionsBlock,
  ImageBlock,
  TableBlock,
  SelectBlock,
  SelectOption,
  RadioSelectBlock,
  MessageBody,
} from "./types.js";
export { isCard } from "./types.js";

import type {
  Card as CardType,
  LinkButton as LinkButtonType,
  DocumentPreview as DocumentPreviewType,
  SignerStatus as SignerStatusType,
} from "./types.js";
import {
  Card as CardBuilder,
  LinkButton as LinkButtonBuilder,
  DocumentPreview as DocumentPreviewBuilder,
  SignerStatus as SignerStatusBuilder,
} from "./builders.js";

// Merge: each name resolves to the type or the value depending on context.
export type Card = CardType;
export const Card = CardBuilder;
export type LinkButton = LinkButtonType;
export const LinkButton = LinkButtonBuilder;
export type DocumentPreview = DocumentPreviewType;
export const DocumentPreview = DocumentPreviewBuilder;
export type SignerStatus = SignerStatusType;
export const SignerStatus = SignerStatusBuilder;

// All other builders re-exported as values only (no type collision).
export {
  Text,
  CardText,
  Heading,
  Divider,
  Section,
  Fields,
  Button,
  Actions,
  Image,
  Table,
  Select,
  RadioSelect,
  Option,
  Children,
  card,
  text,
  heading,
  divider,
  section,
  fields,
  linkButton,
  button,
  actions,
  image,
  table,
  select,
  radioSelect,
  option,
  documentPreview,
  signerStatus,
  children,
} from "./builders.js";

// Renderers.
export { renderText, renderMarkdown, renderHtml } from "./render.js";
