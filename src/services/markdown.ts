/**
 * Minimal, safe markdown → HTML renderer for dossier/artifact review.
 *
 * Escape-first by construction: the source is HTML-escaped before any
 * markup is generated, so raw HTML in resumes can never execute. Supported
 * subset: headings, paragraphs, bold/italic/inline-code, http(s) links,
 * single-level lists, code fences, hr, blockquote.
 */

export function escapeHtml(text: unknown): string {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const INLINE_RULES: [RegExp, (...args: string[]) => string][] = [
  [/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, text, url) => `<a href="${url}">${text}</a>`],
  [/\*\*([^*]+)\*\*/g, (_m, t) => `<strong>${t}</strong>`],
  [/\*([^*]+)\*/g, (_m, t) => `<em>${t}</em>`],
  [/`([^`]+)`/g, (_m, t) => `<code>${t}</code>`],
];

function inline(text: string): string {
  let out = escapeHtml(text);
  for (const [re, fn] of INLINE_RULES) out = out.replace(re, fn as never);
  return out;
}

export function renderMarkdown(markdown: string | null | undefined): string {
  const lines = String(markdown ?? "").split(/\r?\n/);
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (/^\s*$/.test(line)) {
      i++;
      continue;
    }

    // fenced code block
    if (/^```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i]!)) {
        code.push(lines[i]!);
        i++;
      }
      i++; // closing fence (or EOF)
      out.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    // heading
    const heading = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1]!.length;
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      i++;
      continue;
    }

    // horizontal rule
    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      out.push("<hr>");
      i++;
      continue;
    }

    // blockquote
    if (/^>\s?/.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i]!)) {
        quote.push(lines[i]!.replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${inline(quote.join(" "))}</blockquote>`);
      continue;
    }

    // unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      out.push(`<ul>\n${items.map((t) => `<li>${inline(t)}</li>`).join("\n")}\n</ul>`);
      continue;
    }

    // ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i]!)) {
        items.push(lines[i]!.replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      out.push(`<ol>\n${items.map((t) => `<li>${inline(t)}</li>`).join("\n")}\n</ol>`);
      continue;
    }

    // paragraph: consume consecutive non-blank lines
    const para: string[] = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]!) && !/^(#{1,6}\s|```|>|\s*[-*+]\s|\s*\d+\.\s)/.test(lines[i]!)) {
      para.push(lines[i]!);
      i++;
    }
    out.push(`<p>${inline(para.join("\n"))}</p>`);
  }

  return out.join("\n");
}

/** Full standalone page (used by `axa render` and the review UI). */
export function renderDocument(markdown: string, { title = "Document" }: { title?: string } = {}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body { font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
         max-width: 52rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; color: #1a202c; }
  h1, h2, h3, h4 { line-height: 1.25; margin: 1.6em 0 0.5em; }
  h1 { margin-top: 0; font-size: 1.9rem; }
  h2 { font-size: 1.4rem; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.25rem; }
  a { color: #2b6cb0; }
  code { background: #edf2f7; padding: 0.1em 0.35em; border-radius: 4px; font-size: 0.92em; }
  pre { background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 0.9rem 1.1rem; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 1em 0; padding: 0.2em 1em; border-left: 4px solid #cbd5e0; color: #4a5568; }
  ul, ol { padding-left: 1.4em; }
  hr { border: none; border-top: 1px solid #e2e8f0; margin: 2em 0; }
</style>
</head>
<body>
${renderMarkdown(markdown)}
</body>
</html>
`;
}
