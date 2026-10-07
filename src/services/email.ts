/**
 * Viewer for raw RFC-822 email evidence — the full dumps (every Received,
 * DKIM, ARC header) saved from the mail client, which render unreadable if
 * pushed through the markdown renderer.
 *
 * The page shows a From/To/Subject/Date card, the decoded body (HTML bodies
 * inside a sandboxed iframe, plain text pre-wrapped), and collapses the raw
 * headers into a <details> so the proof stays on the page without burying
 * the message.
 *
 * Escape-first like the markdown renderer: header values and text bodies are
 * HTML-escaped; a decoded HTML body only ever runs inside
 * <iframe sandbox="allow-same-origin"> — no scripts execute, and forms are
 * blocked, so an untrusted email cannot act in the UI's origin.
 */

import { escapeHtml } from "./markdown.ts";

/** Headers only a real RFC-822 dump carries — the discriminator against
 *  hand-typed drafts ("To:/Subject:") and extracted email text. */
const RFC822_ONLY_HEADER = /^(received|delivered-to|x-received|return-path|message-id|mime-version|dkim-signature|arc-seal|arc-message-signature|arc-authentication-results|x-mailer)$/i;

const DISPLAY_HEADERS = ["from", "to", "cc", "date", "subject"] as const;

export function looksLikeRfc822(text: string): boolean {
  const source = String(text ?? "").replace(/^\uFEFF/, "");
  const firstLineEnd = source.indexOf("\n");
  const firstLine = (firstLineEnd === -1 ? source : source.slice(0, firstLineEnd)).trimEnd();
  if (!/^[A-Za-z0-9-]+:\s/.test(firstLine)) return false;
  const headerEnd = source.search(/\r?\n\r?\n/);
  const headerBlock = headerEnd === -1 ? source : source.slice(0, headerEnd);
  return headerBlock.split(/\r?\n/).some((line) => {
    const m = line.match(/^([A-Za-z0-9-]+):/);
    return !!m && RFC822_ONLY_HEADER.test(m[1]!);
  });
}

interface ParsedHeaders {
  /** lowercase name → first value, unfolded */
  map: Map<string, string>;
  /** the raw block, kept verbatim for the collapsed <details> */
  raw: string;
}

function parseHeaders(block: string): ParsedHeaders {
  const map = new Map<string, string>();
  let currentName = "";
  for (const line of block.split(/\r?\n/)) {
    if (/^[ \t]/.test(line) && currentName) {
      map.set(currentName, `${map.get(currentName) ?? ""} ${line.trim()}`);
      continue;
    }
    const m = line.match(/^([A-Za-z0-9-]+):\s*(.*)$/);
    if (!m) continue;
    currentName = m[1]!.toLowerCase();
    if (!map.has(currentName)) map.set(currentName, m[2]!);
  }
  return { map, raw: block };
}

function contentTypeParams(value: string | undefined): { type: string; params: Record<string, string> } {
  const parts = String(value ?? "").split(";");
  const type = (parts[0] ?? "").trim().toLowerCase() || "text/plain";
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const m = p.match(/^\s*([A-Za-z0-9-]+)\s*=\s*(.*)$/);
    if (!m) continue;
    const v = m[2]!.trim();
    params[m[1]!.toLowerCase()] = v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v;
  }
  return { type, params };
}

function bufferCharsetDecode(bytes: Buffer, charset: string): string {
  const cs = charset.toLowerCase();
  if (cs === "iso-8859-1" || cs === "latin1" || cs === "windows-1252" || cs === "cp1252") {
    return bytes.toString("latin1");
  }
  return bytes.toString("utf8");
}

function decodeQuotedPrintable(text: string): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch !== "=") {
      bytes.push(ch.charCodeAt(0) & 0xff);
      continue;
    }
    const next = text[i + 1];
    if (next === "\r" || next === "\n") {
      i += next === "\r" && text[i + 2] === "\n" ? 2 : 1; // soft line break
      continue;
    }
    const hex = text.slice(i + 1, i + 3);
    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(parseInt(hex, 16));
      i += 2;
      continue;
    }
    bytes.push(0x3d); // stray '='
  }
  return Buffer.from(bytes);
}

function decodeBody(payload: string, transferEncoding: string, charset: string): string {
  const enc = transferEncoding.trim().toLowerCase();
  if (enc === "quoted-printable") return bufferCharsetDecode(decodeQuotedPrintable(payload), charset);
  if (enc === "base64") return bufferCharsetDecode(Buffer.from(payload.replace(/\s+/g, ""), "base64"), charset);
  return payload;
}

interface BodyCandidate {
  html: string | null;
  text: string | null;
}

/** Extract the best displayable body: text/html preferred, text/plain fallback. */
function extractBody(headers: ParsedHeaders, payload: string, depth: number): BodyCandidate {
  const { type, params } = contentTypeParams(headers.map.get("content-type"));
  if (type.startsWith("multipart/") && params.boundary && depth < 4) {
    const result: BodyCandidate = { html: null, text: null };
    for (const part of splitMultipart(payload, params.boundary)) {
      const headerEnd = part.search(/\r?\n\r?\n/);
      if (headerEnd === -1) continue;
      const partHeaders = parseHeaders(part.slice(0, headerEnd));
      const partBody = part.slice(headerEnd).replace(/^\r?\n\r?\n/, "");
      const inner = extractBody(partHeaders, partBody, depth + 1);
      result.html ??= inner.html;
      result.text ??= inner.text;
      if (result.html) break;
    }
    return result;
  }
  const decoded = decodeBody(payload, headers.map.get("content-transfer-encoding") ?? "", params.charset ?? "utf-8");
  if (type === "text/html") return { html: decoded, text: null };
  if (type.startsWith("text/")) return { html: null, text: decoded };
  return { html: null, text: null };
}

function splitMultipart(body: string, boundary: string): string[] {
  const parts: string[] = [];
  let current: string[] | null = null;
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === `--${boundary}` || trimmed === `--${boundary}--`) {
      if (current) parts.push(current.join("\n"));
      current = trimmed === `--${boundary}` ? [] : null;
    } else if (current) {
      current.push(line);
    }
  }
  if (current && current.length) parts.push(current.join("\n"));
  return parts;
}

/**
 * Standalone email viewer page. HTML bodies run in a sandboxed iframe that
 * the page auto-sizes; plain bodies render pre-wrapped. Raw headers stay one
 * click away in a <details>.
 */
export function renderEmailHtml(raw: string, { title = "Email" }: { title?: string } = {}): string {
  const source = String(raw ?? "").replace(/^\uFEFF/, "");
  const headerEnd = source.search(/\r?\n\r?\n/);
  const headerBlock = headerEnd === -1 ? source : source.slice(0, headerEnd);
  const body = headerEnd === -1 ? "" : source.slice(headerEnd).replace(/^\r?\n\r?\n/, "");
  const headers = parseHeaders(headerBlock);
  const { html, text } = headerEnd === -1 ? { html: null, text: null } : extractBody(headers, body, 0);

  const subject = headers.map.get("subject") ?? "(no subject)";
  const cardRows = DISPLAY_HEADERS.filter((h) => headers.map.has(h))
    .map((h) => `<div class="hdr"><span class="k">${h}</span><span class="v">${escapeHtml(headers.map.get(h))}</span></div>`)
    .join("\n");

  let bodyHtml: string;
  if (html !== null) {
    // The review browser may run dark mode; an email that declares no
    // background would render dark-on-dark. The hint goes in first, so the
    // email's own CSS (later in the cascade) still wins.
    const lightHint = '<meta name="color-scheme" content="light"><style>html{background:#fff}</style>';
    bodyHtml = `<iframe class="mail-frame" sandbox="allow-same-origin" srcdoc="${escapeHtml(lightHint + html)}" title="email body"></iframe>`;
  } else {
    const shown = text ?? body;
    bodyHtml = `<div class="mail-body">${escapeHtml(shown)}</div>`;
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject === "(no subject)" ? title : subject)}</title>
<style>
  :root { color-scheme: light; }
  html { background: #fff; }
  body { font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
         max-width: 52rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; color: #1a202c; }
  .card { background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px;
          padding: 0.9rem 1.1rem; margin-bottom: 1.5rem; }
  .subject { font-size: 1.15rem; font-weight: 650; margin: 0 0 0.6rem; }
  .hdr { display: flex; gap: 0.6rem; font-size: 0.92rem; line-height: 1.5; }
  .hdr .k { flex: 0 0 4.5rem; color: #718096; text-transform: capitalize; }
  .hdr .v { word-break: break-word; }
  .mail-frame { width: 100%; min-height: 20rem; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; }
  .mail-body { white-space: pre-wrap; overflow-wrap: break-word; }
  details { margin-top: 2rem; font-size: 0.85rem; }
  details summary { cursor: pointer; color: #4a5568; }
  details pre { background: #f7fafc; border: 1px solid #e2e8f0; border-radius: 8px;
                padding: 0.9rem 1.1rem; overflow-x: auto; font-size: 0.78rem; line-height: 1.45; }
</style>
</head>
<body>
<div class="card">
  <p class="subject">${escapeHtml(subject)}</p>
  ${cardRows}
</div>
${bodyHtml}
<details>
  <summary>Full raw headers (proof)</summary>
  <pre>${escapeHtml(headers.raw)}</pre>
</details>
<script>
  (function () {
    var frame = document.querySelector("iframe.mail-frame");
    if (!frame) return;
    function resize() {
      try {
        var h = frame.contentDocument.documentElement.scrollHeight;
        frame.style.height = Math.max(320, h + 24) + "px";
      } catch (e) { /* opaque frame: keep min-height */ }
    }
    frame.addEventListener("load", function () { resize(); setTimeout(resize, 1200); });
  })();
</script>
</body>
</html>
`;
}
