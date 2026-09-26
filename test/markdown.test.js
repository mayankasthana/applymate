import { test } from "node:test";
import assert from "node:assert/strict";

import { renderMarkdown, renderDocument } from "../src/services/markdown.js";

test("headings map to h1..h6", () => {
  const html = renderMarkdown("# One\n## Two\n###### Six");
  assert.ok(html.includes("<h1>One</h1>"));
  assert.ok(html.includes("<h2>Two</h2>"));
  assert.ok(html.includes("<h6>Six</h6>"));
});

test("paragraphs wrap consecutive lines; blank lines split them", () => {
  const html = renderMarkdown("first line\nsecond line\n\nthird line");
  assert.ok(html.includes("<p>first line\nsecond line</p>"));
  assert.ok(html.includes("<p>third line</p>"));
});

test("inline styles: bold, italic, code", () => {
  const html = renderMarkdown("**bold** and *italic* and `code`");
  assert.ok(html.includes("<strong>bold</strong>"));
  assert.ok(html.includes("<em>italic</em>"));
  assert.ok(html.includes("<code>code</code>"));
});

test("links render with href; javascript: urls are neutralized", () => {
  const html = renderMarkdown("[site](https://ok.example.com) and [bad](javascript:alert(1))");
  assert.ok(html.includes('href="https://ok.example.com"'));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes("bad"));
});

test("raw HTML in source is escaped, never executed", () => {
  const html = renderMarkdown('hello <script>alert(1)</script> & <img src=x onerror=alert(2)>');
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&amp;"));
});

test("unordered and ordered lists render as ul/ol with li", () => {
  const html = renderMarkdown("- alpha\n- beta\n\n1. one\n2. two");
  assert.ok(html.includes("<ul>"));
  assert.ok(html.includes("<li>alpha</li>"));
  assert.ok(html.includes("<ol>"));
  assert.ok(html.includes("<li>two</li>"));
  assert.ok(html.indexOf("<ul>") < html.indexOf("<ol>"));
});

test("code fences render as pre>code with escaped content", () => {
  const html = renderMarkdown("```\nconst x = \"<b>\";\n```");
  assert.ok(html.includes("<pre><code>"));
  assert.ok(html.includes("&quot;&lt;b&gt;&quot;") || html.includes('"&lt;b&gt;"'));
  assert.ok(!/<pre><code>const x = "<b>"/.test(html));
});

test("hr and blockquote render", () => {
  const html = renderMarkdown("above\n\n---\n\n> quoted words");
  assert.ok(html.includes("<hr>"));
  assert.ok(html.includes("<blockquote>quoted words</blockquote>"));
});

test("renderDocument wraps a full standalone page with the title", () => {
  const html = renderDocument("# Résumé\n\nBody", { title: "Tailored Resume" });
  assert.ok(html.toLowerCase().startsWith("<!doctype html>"));
  assert.ok(html.includes("<title>Tailored Resume</title>"));
  assert.ok(html.includes("<h1>Résumé</h1>"));
  assert.ok(html.includes("</html>"));
});
