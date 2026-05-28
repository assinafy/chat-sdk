/**
 * Default renderers from {@link Card} primitives to text / markdown / HTML.
 *
 * Adapters can either:
 *  1. Use these directly for a generic format, or
 *  2. Implement a platform-native renderer (Slack Block Kit, Microsoft
 *     Adaptive Cards, etc.) walking the same primitives.
 */

import type { Card, CardElement } from "./types.js";

/** Render a card to plain text. Suitable for SMS, plain email, CLI. */
export function renderText(card: Card): string {
  const lines: string[] = [];
  if (card.title) lines.push(card.title.toUpperCase());
  if (card.subtitle) lines.push(card.subtitle);
  if (card.title || card.subtitle) lines.push("");
  for (const child of card.children) lines.push(renderElementText(child));
  return lines.join("\n").trim();
}

function renderElementText(el: CardElement): string {
  switch (el.type) {
    case "card":
      return renderText(el);
    case "heading":
      return `${"#".repeat(el.level)} ${el.content}`;
    case "text":
      return el.content;
    case "divider":
      return "------------------------------";
    case "section":
      return [el.label ? el.label.toUpperCase() : undefined, ...el.children.map(renderElementText)]
        .filter((x): x is string => Boolean(x))
        .join("\n");
    case "fields":
      return el.fields.map((f) => `${f.label}: ${f.value}`).join("\n");
    case "link-button":
      return `${el.label}: ${el.url}`;
    case "button":
      return `[${el.label}]`;
    case "actions":
      return el.children.map(renderElementText).join("  ");
    case "image":
      return el.alt ? `[image: ${el.alt}] ${el.url}` : `[image] ${el.url}`;
    case "table": {
      const rows = [el.headers, ...el.rows];
      return rows.map((r) => r.join("\t")).join("\n");
    }
    case "select":
      return `${el.label ?? "Select"}: ${el.options.map((o) => o.label).join(", ")}`;
    case "radio-select":
      return `${el.label ?? "Select one"}: ${el.options.map((o) => o.label).join(", ")}`;
    case "document-preview":
      return [
        `Document: ${el.name}`,
        `Status: ${el.status}`,
        el.signingUrl ? `Sign: ${el.signingUrl}` : undefined,
      ]
        .filter((x): x is string => Boolean(x))
        .join("\n");
    case "signer-status":
      return el.signers
        .map((s) => `${s.completed ? "[x]" : "[ ]"} ${s.name}${s.email ? ` <${s.email}>` : ""}`)
        .join("\n");
  }
}

/** Render a card to GitHub-flavored markdown. */
export function renderMarkdown(card: Card): string {
  const lines: string[] = [];
  if (card.title) lines.push(`## ${card.title}`);
  if (card.subtitle) lines.push(`_${card.subtitle}_`);
  if (card.title || card.subtitle) lines.push("");
  for (const child of card.children) lines.push(renderElementMarkdown(child));
  return lines.join("\n").trim();
}

function renderElementMarkdown(el: CardElement): string {
  switch (el.type) {
    case "card":
      return renderMarkdown(el);
    case "heading":
      return `${"#".repeat(el.level)} ${el.content}`;
    case "text":
      return el.content;
    case "divider":
      return "\n---\n";
    case "section":
      return [el.label ? `### ${el.label}` : undefined, ...el.children.map(renderElementMarkdown)]
        .filter((x): x is string => Boolean(x))
        .join("\n");
    case "fields":
      return el.fields.map((f) => `- **${f.label}:** ${f.value}`).join("\n");
    case "link-button":
      return `[${el.label}](${el.url})`;
    case "button":
      return `**[${el.label}]**`;
    case "actions":
      return el.children.map(renderElementMarkdown).join(" · ");
    case "image":
      return `![${el.alt ?? ""}](${el.url})`;
    case "table": {
      const header = `| ${el.headers.join(" | ")} |`;
      const sep = `| ${el.headers.map((_, i) => alignTo(el.align?.[i])).join(" | ")} |`;
      const rows = el.rows.map((r) => `| ${r.join(" | ")} |`).join("\n");
      return `${header}\n${sep}\n${rows}`;
    }
    case "select":
      return `**${el.label ?? "Select"}**: ${el.options.map((o) => o.label).join(", ")}`;
    case "radio-select":
      return `**${el.label ?? "Select one"}**: ${el.options.map((o) => o.label).join(", ")}`;
    case "document-preview":
      return [
        `**${el.name}**`,
        `Status: \`${el.status}\``,
        el.signingUrl ? `[Open document](${el.signingUrl})` : undefined,
      ]
        .filter((x): x is string => Boolean(x))
        .join("\n");
    case "signer-status":
      return el.signers
        .map((s) => `- [${s.completed ? "x" : " "}] ${s.name}${s.email ? ` <${s.email}>` : ""}`)
        .join("\n");
  }
}

function alignTo(a: "left" | "center" | "right" | undefined): string {
  switch (a) {
    case "center":
      return ":---:";
    case "right":
      return "---:";
    default:
      return "---";
  }
}

/** Render a card to a small, self-contained HTML fragment. */
export function renderHtml(card: Card): string {
  const parts: string[] = [];
  parts.push(`<div class="assinafy-card">`);
  if (card.title) parts.push(`<h2>${escapeHtml(card.title)}</h2>`);
  if (card.subtitle) parts.push(`<p class="subtitle">${escapeHtml(card.subtitle)}</p>`);
  for (const child of card.children) parts.push(renderElementHtml(child));
  parts.push(`</div>`);
  return parts.join("");
}

function renderElementHtml(el: CardElement): string {
  switch (el.type) {
    case "card":
      return renderHtml(el);
    case "heading":
      return `<h${el.level}>${escapeHtml(el.content)}</h${el.level}>`;
    case "text":
      return `<p>${escapeHtml(el.content)}</p>`;
    case "divider":
      return `<hr />`;
    case "section":
      return (
        `<section>` +
        (el.label ? `<h3>${escapeHtml(el.label)}</h3>` : "") +
        el.children.map(renderElementHtml).join("") +
        `</section>`
      );
    case "fields":
      return (
        `<dl>` +
        el.fields
          .map((f) => `<dt>${escapeHtml(f.label)}</dt><dd>${escapeHtml(f.value)}</dd>`)
          .join("") +
        `</dl>`
      );
    case "link-button":
      return `<a class="btn btn-${el.style ?? "primary"}" href="${escapeAttr(el.url)}">${escapeHtml(el.label)}</a>`;
    case "button":
      return `<button data-action-id="${escapeAttr(el.id)}"${el.value ? ` data-value="${escapeAttr(el.value)}"` : ""}>${escapeHtml(el.label)}</button>`;
    case "actions":
      return `<div class="actions">${el.children.map(renderElementHtml).join("")}</div>`;
    case "image":
      return `<img src="${escapeAttr(el.url)}" alt="${escapeAttr(el.alt ?? "")}" />`;
    case "table": {
      const head = `<thead><tr>${el.headers.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr></thead>`;
      const body =
        `<tbody>` +
        el.rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c)}</td>`).join("")}</tr>`).join("") +
        `</tbody>`;
      return `<table>${head}${body}</table>`;
    }
    case "select":
      return (
        `<label>${escapeHtml(el.label ?? "")}<select name="${escapeAttr(el.id)}"${el.placeholder ? ` placeholder="${escapeAttr(el.placeholder)}"` : ""}>` +
        el.options.map((o) => `<option value="${escapeAttr(o.value)}">${escapeHtml(o.label)}</option>`).join("") +
        `</select></label>`
      );
    case "radio-select":
      return (
        `<fieldset>${el.label ? `<legend>${escapeHtml(el.label)}</legend>` : ""}` +
        el.options
          .map(
            (o) =>
              `<label><input type="radio" name="${escapeAttr(el.id)}" value="${escapeAttr(o.value)}"> ${escapeHtml(o.label)}</label>`,
          )
          .join("") +
        `</fieldset>`
      );
    case "document-preview": {
      const thumb = el.thumbnailUrl
        ? `<img class="thumb" src="${escapeAttr(el.thumbnailUrl)}" alt="" />`
        : "";
      const link = el.signingUrl
        ? `<a class="btn btn-primary" href="${escapeAttr(el.signingUrl)}">Open</a>`
        : "";
      return `<div class="doc-preview">${thumb}<div class="meta"><strong>${escapeHtml(el.name)}</strong><span class="status">${escapeHtml(el.status)}</span>${link}</div></div>`;
    }
    case "signer-status":
      return (
        `<ul class="signers">` +
        el.signers
          .map(
            (s) =>
              `<li class="${s.completed ? "done" : "pending"}">${escapeHtml(s.name)}${s.email ? ` &lt;${escapeHtml(s.email)}&gt;` : ""}</li>`,
          )
          .join("") +
        `</ul>`
      );
  }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttr(input: string): string {
  return escapeHtml(input);
}
