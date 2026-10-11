import { test } from "node:test";
import assert from "node:assert/strict";

import { linkifyChatHtml } from "../src/services/linkify.ts";
import { UI_HTML } from "../src/server-ui.ts";

test("plain text and markup are only escaped", () => {
  const out = linkifyChatHtml("say <b>hi</b> & <script>alert(1)</script>");
  assert.ok(!out.includes("<b>"), "no raw tags may survive");
  assert.ok(!out.includes("<script"), "script tags must not survive");
  assert.equal(out, "say &lt;b&gt;hi&lt;/b&gt; &amp; &lt;script&gt;alert(1)&lt;/script&gt;");
});

test("http(s) urls become anchors that open in a new tab", () => {
  const out = linkifyChatHtml("Review at http://127.0.0.1:4388 — say go");
  assert.ok(out.startsWith("Review at "), "text before the link stays text");
  assert.ok(out.includes(
    '<a href="http://127.0.0.1:4388" target="_blank" rel="noopener noreferrer">http://127.0.0.1:4388</a>'
  ));
  assert.ok(out.includes(" — say go"), "the sentence around the link stays text");
});

test("query strings survive; sentence punctuation stays outside the link", () => {
  const out = linkifyChatHtml("see https://x.io/a?b=1&c=2. then stop");
  assert.ok(out.includes('href="https://x.io/a?b=1&amp;c=2"'), "the & must be attribute-escaped");
  assert.ok(
    out.includes(">https://x.io/a?b=1&amp;c=2</a>. then"),
    "display keeps the & (escaped), the period stays out"
  );
  assert.ok(out.endsWith(". then stop"));
});

test("a closing paren is kept only when the url's parens balance", () => {
  const kept = linkifyChatHtml("wiki: http://en.wikipedia.org/wiki/Foo_(bar)");
  assert.ok(kept.includes('href="http://en.wikipedia.org/wiki/Foo_(bar)"'));

  const trimmed = linkifyChatHtml("see (http://x.io/a).");
  assert.ok(trimmed.includes('href="http://x.io/a"'), "unbalanced ) belongs to the prose");
  assert.ok(trimmed.startsWith("see ("), "leading paren stays text");
  assert.ok(trimmed.endsWith(")."), "trailing ). stays text");
});

test("workspace file paths open in the sandboxed artifact viewer", () => {
  const out = linkifyChatHtml(
    "PDF: workspace/applications/app-1fei/Candidate_Resume.pdf (2-page A4)"
  );
  assert.ok(out.includes('target="_blank"'), "artifact links open beside the board, not over it");
  assert.ok(out.includes('href="/api/artifact?path=applications%2Fapp-1fei%2FCandidate_Resume.pdf"'));
  assert.ok(out.includes("(2-page A4)"), "the parenthetical stays text");
});

test("paths without a servable extension stay plain text", () => {
  const dir = linkifyChatHtml("look in workspace/applications/app-1fei/");
  assert.ok(!dir.includes("/api/artifact"), "directories must not link");

  const noext = linkifyChatHtml("it is in workspace/jobs/j-1/Some File");
  assert.ok(!noext.includes("/api/artifact"), "a whitespace-cut path must not link");

  const trimmed = linkifyChatHtml("filed at workspace/applications/app-xjli/notes.md.");
  assert.ok(trimmed.includes('href="/api/artifact?path=applications%2Fapp-xjli%2Fnotes.md"'));
  assert.ok(trimmed.endsWith("."), "the sentence period stays text");
});

test("only application ids the board knows become open buttons", () => {
  const out = linkifyChatHtml("app-1fei is ready, app-xxxx is not, app-1fei again", ["app-1fei"]);
  assert.equal(out.split('<button class="applink" data-app="app-1fei">app-1fei</button>').length - 1, 2);
  assert.ok(out.includes("app-xxxx"), "an unknown id must stay text");

  assert.ok(!linkifyChatHtml("app-1fei mentioned with no board").includes("<button"),
    "without the known-id list nothing is linked");
  assert.ok(!linkifyChatHtml("the app-store case").includes("<button"),
    "prose that merely looks like an id must stay text");

  const upper = linkifyChatHtml("APP-1FEI", ["app-1fei"]);
  assert.ok(upper.includes('data-app="app-1fei"'), "matching is case-insensitive");
});

test("urls, paths and app ids can all appear in one message", () => {
  const out = linkifyChatHtml(
    "app-cv7s ready at http://127.0.0.1:4388 — draft: workspace/applications/app-cv7s/cover-letter.md",
    ["app-cv7s"]
  );
  assert.ok(out.includes('data-app="app-cv7s"'));
  assert.ok(out.includes('href="http://127.0.0.1:4388"'));
  assert.ok(out.includes('href="/api/artifact?path=applications%2Fapp-cv7s%2Fcover-letter.md"'));
});

test("the injected source is safe to embed in the UI template and script", () => {
  const src = linkifyChatHtml.toString();
  assert.ok(!src.includes("${"), "a ${ would interpolate inside UI_HTML's template literal");
  assert.ok(!src.toLowerCase().includes("</script"), "a </script would close the script element early");
  assert.ok(!src.includes("<!--"), "comment-openers destabilize inline script parsing");
});

test("the review UI embeds and wires the linkifier", () => {
  assert.ok(UI_HTML.includes("function linkifyChatHtml"), "the function source must be injected");
  assert.match(UI_HTML, /linkifyChatHtml\(m\.text/, "chat bubbles must render through it");
  assert.match(UI_HTML, /bindAppTags\(log\)/, "app buttons in chat must open the sheet");
});
