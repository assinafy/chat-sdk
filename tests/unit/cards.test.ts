import { describe, it, expect } from "vitest";
import {
  Card,
  Text,
  Heading,
  Divider,
  LinkButton,
  Button,
  Fields,
  Actions,
  Section,
  Table,
  Select,
  RadioSelect,
  DocumentPreview,
  SignerStatus,
  Children,
  renderText,
  renderMarkdown,
  renderHtml,
} from "../../src/cards/index.js";

describe("capitalized card builders", () => {
  it("builds a card with mixed children", () => {
    const message = Card({
      title: "Hello",
      subtitle: "world",
      children: Children(
        Heading(2, "Title"),
        Text("body"),
        Divider(),
        Section({ label: "Group", children: [Text("inside")] }),
        Fields([{ label: "Status", value: "pending" }]),
        Actions([
          LinkButton({ label: "Open", url: "https://example.com" }),
          Button({ id: "cancel", label: "Cancel", style: "danger" }),
        ]),
        Table({ headers: ["A", "B"], rows: [["1", "2"]] }),
        Select({ id: "sel", label: "Choose", options: [{ label: "A", value: "a" }] }),
        RadioSelect({ id: "rad", options: [{ label: "B", value: "b" }] }),
        DocumentPreview({ documentId: "d1", name: "Contract.pdf", status: "pending_signature" }),
        SignerStatus([{ name: "Alice", email: "a@x", completed: false }]),
      ),
    });
    expect(message.type).toBe("card");
    expect(message.children).toHaveLength(11);
  });

  it("Children() filters out falsy values", () => {
    const out = Children(Text("a"), null, false, undefined, Text("b"));
    expect(out.map((c) => (c as { type: string }).type)).toEqual(["text", "text"]);
  });

  it("lowercase aliases still work (backwards compatibility)", async () => {
    const { card, text } = await import("../../src/cards/index.js");
    const c = card({ children: [text("hi")] });
    expect(c.type).toBe("card");
  });
});

describe("renderers", () => {
  const sample = Card({
    title: "Doc",
    subtitle: "for signature",
    children: [
      Heading(2, "Contract.pdf"),
      Text("Please sign."),
      Divider(),
      Actions([LinkButton({ label: "Sign", url: "https://example.com/sign" })]),
      SignerStatus([
        { name: "Alice", email: "a@x", completed: true },
        { name: "Bob", email: "b@x", completed: false },
      ]),
    ],
  });

  it("renders plain text", () => {
    const out = renderText(sample);
    expect(out).toContain("DOC");
    expect(out).toContain("for signature");
    expect(out).toContain("Please sign.");
    expect(out).toContain("Sign: https://example.com/sign");
    expect(out).toContain("[x] Alice <a@x>");
    expect(out).toContain("[ ] Bob <b@x>");
  });

  it("renders markdown", () => {
    const out = renderMarkdown(sample);
    expect(out).toContain("## Doc");
    expect(out).toContain("[Sign](https://example.com/sign)");
    expect(out).toContain("- [x] Alice <a@x>");
  });

  it("renders html with escaping", () => {
    const xss = Card({ children: [Text("<script>")] });
    const out = renderHtml(xss);
    expect(out).toContain("&lt;script&gt;");
    expect(out).not.toContain("<script>");
  });

  it("neutralizes dangerous URL schemes in html href/src (XSS)", () => {
    const dangerous = Card({
      children: [
        Actions([LinkButton({ label: "x", url: "javascript:alert(1)" })]),
        LinkButton({ label: "y", url: "JaVaScRiPt:alert(2)" }),
        DocumentPreview({
          documentId: "d",
          name: "n",
          status: "pending_signature",
          thumbnailUrl: "data:text/html,<script>",
          signingUrl: "https://ok.example/sign",
        }),
      ],
    });
    const out = renderHtml(dangerous);
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("data:text/html");
    expect(out).toContain('href="#"');
    // Legitimate https URLs are preserved.
    expect(out).toContain('href="https://ok.example/sign"');
  });

  it("keeps safe http/https/mailto URLs intact", () => {
    const safe = Card({ children: [Actions([LinkButton({ label: "mail", url: "mailto:a@x.com" })])] });
    expect(renderHtml(safe)).toContain('href="mailto:a@x.com"');
  });

  it("renders tables in markdown", () => {
    const t = Card({
      children: [Table({ headers: ["A", "B"], rows: [["1", "2"]], align: ["left", "right"] })],
    });
    const md = renderMarkdown(t);
    expect(md).toContain("| A | B |");
    expect(md).toContain("| --- | ---: |");
    expect(md).toContain("| 1 | 2 |");
  });

  it("escapes pipes and newlines in markdown table cells", () => {
    const t = Card({
      children: [Table({ headers: ["A|x", "B"], rows: [["line1\nline2", "a | b"]] })],
    });
    const md = renderMarkdown(t);
    expect(md).toContain("| A\\|x | B |");
    expect(md).toContain("| line1<br>line2 | a \\| b |");
  });
});
