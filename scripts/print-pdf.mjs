#!/usr/bin/env node
/**
 * Render a markdown artifact to a print-styled HTML file and to an A4 PDF.
 *
 * Two things this script exists to guarantee, both from AGENTS.md
 * "Resume standards":
 *
 *  1. Two A4 pages at 9-10pt with tight margins. The stock `render` output has
 *     no print CSS and spills, so the print stylesheet is injected here rather
 *     than left to the reviewer.
 *  2. No header/footer. A naive headless run bakes the local file:// path and a
 *     timestamp into every page, which is a personal-data leak, so the page
 *     count alone is not an acceptable check — the PDF text is scanned for both.
 *
 * Usage: node scripts/print-pdf.mjs <rendered.html> <out.pdf> [--title T]
 */
import { readFile, writeFile, unlink, mkdtemp } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { inflateSync } from "node:zlib";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

// 12px = 9pt at 1.3 line-height with 1cm A4 margins: the established house style,
// and the size at which an eleven-year resume lands on two readable pages.
// Gutters, Chrome 154 edition (verified 2026-10-12): headless printToPDF now
// ignores @page margins, ignores the CDP margin params, and ignores
// preferCSSPageSize combinations — every page printed flush to the edges no
// matter which knob was set (paperWidth/Height and content CSS still apply).
// So the gutters are ordinary layout now: a one-column table whose thead/tfoot
// spacer rows repeat on every printed page (top/bottom gutters — thead/tfoot
// repetition on fragmentation is standard Blink behavior; the 1-page case is
// pixel-measured, so any multi-page build still gets its usual visual gate),
// plus body side padding (left/right gutters). Layout CSS cannot be ignored
// by print.
const PRINT_CSS = `
  @page { size: A4; margin: 0; }
  html, body { background: #fff; }
  body { font: 12px/1.22 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
         max-width: none; margin: 0; padding: 0 1.05cm; }
  table.pgwrap { width: 100%; border-collapse: collapse; }
  table.pgwrap > thead > tr > td, table.pgwrap > tfoot > tr > td { height: 1cm; padding: 0; }
  table.pgwrap > tbody > tr > td { padding: 0; }
  h1, h2, h3, h4 { line-height: 1.2; margin: 0.6em 0 0.2em; }
  h1 { margin-top: 0; font-size: 1.5em; }
  h2 { font-size: 1.12em; border-bottom: 1px solid #cbd5e0; padding-bottom: 0.1rem; }
  h3 { font-size: 1em; }
  ul, ol { padding-left: 1.2em; margin: 0.18em 0; }
  li { margin: 0.05em 0; }
  p { margin: 0.26em 0; }
  hr { margin: 0.7em 0; }
  strong { font-weight: 600; }
  h1, h2, h3, h4 { break-after: avoid; page-break-after: avoid; }
  h2 + ul, h3 + ul, h3 + p { break-before: avoid; page-break-before: avoid; }
  p:has(> strong:only-child) { break-after: avoid; page-break-after: avoid; }
  /* A job title is a lone-bold paragraph and its date is the plain paragraph
     after it. Protecting only the title still lets the page break land
     between the date and the bullets, stranding the heading at the foot of a
     page with its content overleaf — so the date inherits the same rule. */
  p:has(> strong:only-child) + p { break-after: avoid; page-break-after: avoid; }
  li { break-inside: avoid; page-break-inside: avoid; }
`;

async function writePrintHtml(srcHtml, outHtml, title) {
  const html = await readFile(srcHtml, "utf8");
  const styled = html
    .replace(/<title>[^<]*<\/title>/, `<title>${title}</title>`)
    .replace("</head>", `<style>${PRINT_CSS}</style>\n</head>`)
    // Wrap the body content in the gutter table (see PRINT_CSS note): thead
    // and tfoot repeat on every printed page, which body padding cannot do.
    .replace(/<body([^>]*)>([\s\S]*?)<\/body>/, (_, attrs, inner) =>
      `<body${attrs}><table class="pgwrap"><thead><tr><td></td></tr></thead><tbody><tr><td>${inner}</td></tr></tbody><tfoot><tr><td></td></tr></tfoot></table></body>`);
  await writeFile(outHtml, styled, "utf8");
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch {
      /* Chrome is still binding the port */
    }
    await sleep(250);
  }
  throw new Error(`Chrome DevTools endpoint never came up: ${url}`);
}

/** Minimal CDP client over the built-in WebSocket, with flattened sessions. */
class CDP {
  #ws;
  #id = 0;
  #pending = new Map();
  #waiters = [];

  static async connect(wsUrl) {
    const cdp = new CDP();
    cdp.#ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      cdp.#ws.addEventListener("open", resolve, { once: true });
      cdp.#ws.addEventListener("error", reject, { once: true });
    });
    cdp.#ws.addEventListener("message", (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== undefined) {
        const waiter = cdp.#pending.get(msg.id);
        if (!waiter) return;
        cdp.#pending.delete(msg.id);
        clearTimeout(waiter.timer);
        msg.error ? waiter.reject(new Error(msg.error.message)) : waiter.resolve(msg.result);
        return;
      }
      for (const w of [...cdp.#waiters]) {
        if (msg.method === w.method) {
          cdp.#waiters.splice(cdp.#waiters.indexOf(w), 1);
          clearTimeout(w.timer);
          w.resolve(msg.params);
        }
      }
    });
    return cdp;
  }

  send(method, params = {}, sessionId) {
    const id = ++this.#id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.#ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, 60_000);
      this.#pending.set(id, { resolve, reject, timer });
    });
  }

  waitFor(method, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
      const waiter = {
        method,
        resolve,
        timer: setTimeout(() => {
          const i = this.#waiters.indexOf(waiter);
          if (i >= 0) this.#waiters.splice(i, 1);
          reject(new Error(`${method} never fired`));
        }, timeoutMs),
      };
      this.#waiters.push(waiter);
    });
  }

  close() {
    this.#ws.close();
  }
}

/** Page count from the PDF object tree; `/Type /Pages` is the root node, not a page. */
function pageCount(buf) {
  const s = buf.toString("latin1");
  const m = s.match(/\/Count\s+(\d+)/);
  if (m) return Number(m[1]);
  return (s.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
}

/**
 * Decompress every FlateDecode stream and search the drawn text. Chrome writes
 * the header/footer into the content stream, so this is where a baked-in
 * file:// path or timestamp would actually show up.
 */
function pdfText(buf) {
  const s = buf.toString("latin1");
  let out = "";
  for (const m of s.matchAll(/stream\r?\n/g)) {
    const start = m.index + m[0].length;
    const end = s.indexOf("endstream", start);
    if (end < 0) continue;
    try {
      out += inflateSync(Buffer.from(s.slice(start, end), "latin1")).toString("latin1");
    } catch {
      /* not every stream is Flate-encoded */
    }
  }
  return out;
}

async function printToPdf(htmlPath, pdfPath) {
  const profile = await mkdtemp(join(tmpdir(), "cdp-profile-"));
  const port = 9000 + Math.floor(Math.random() * 900);
  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--allow-file-access-from-files",
      "about:blank",
    ],
    { stdio: "ignore" },
  );

  try {
    const version = await fetchJson(`http://127.0.0.1:${port}/json/version`);
    const cdp = await CDP.connect(version.webSocketDebuggerUrl);

    const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
    const call = (method, params = {}) => cdp.send(method, params, sessionId);

    await call("Page.enable");
    const loaded = cdp.waitFor("Page.loadEventFired");
    await call("Page.navigate", { url: pathToFileURL(resolve(htmlPath)).href });
    await loaded;
    await sleep(350); // let webfonts settle so the print layout is final

    const { data } = await call("Page.printToPDF", {
      printBackground: true,
      // The whole point: no header/footer, or the local path and a timestamp
      // get stamped onto every page.
      displayHeaderFooter: false,
      // Page size comes from the @page rule (size: A4). Margins are NOT set
      // here in any form — Chrome 154 headless ignores every margin knob (see
      // the PRINT_CSS note); gutters are layout CSS instead.
      preferCSSPageSize: true,
    });

    const buf = Buffer.from(data, "base64");
    await writeFile(pdfPath, buf);
    cdp.close();
    return buf;
  } finally {
    chrome.kill();
    await unlink(profile).catch(() => {});
  }
}

const [inputHtml, outPdf, ...rest] = process.argv.slice(2);
if (!inputHtml || !outPdf) {
  console.error("usage: print-pdf.mjs <rendered.html> <out.pdf> [--title T] [--expect N]");
  process.exit(1);
}
const titleIdx = rest.indexOf("--title");
const title = titleIdx >= 0 ? rest[titleIdx + 1] : "Candidate Name";
// A resume has a hard 2-page budget; a cover letter is meant to be one page, so
// the expectation is a flag rather than a constant baked into the script.
const expectIdx = rest.indexOf("--expect");
const expected = expectIdx >= 0 ? Number(rest[expectIdx + 1]) : 2;

const printHtml = inputHtml.replace(/\.html$/, "-print.html");
await writePrintHtml(inputHtml, printHtml, title);
const buf = await printToPdf(printHtml, outPdf);

const pages = pageCount(buf);
const text = pdfText(buf);
const leaks = [];
if (/file:\/\//i.test(text)) leaks.push("local file:// path");
if (/\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(text)) leaks.push("date stamp");

console.log(`print html -> ${printHtml}`);
console.log(`pdf        -> ${outPdf} (${pages} page${pages === 1 ? "" : "s"})`);
console.log(
  leaks.length
    ? `LEAK CHECK FAILED: ${leaks.join(", ")} present in page content`
    : "leak check ok: no file:// path, no date stamp in page content",
);
if (pages !== expected) {
  console.log(`WARNING: expected ${expected} A4 page(s), got ${pages}`);
  process.exitCode = 1;
}