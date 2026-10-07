import { test } from "node:test";
import assert from "node:assert/strict";

import { looksLikeRfc822, renderEmailHtml } from "../src/services/email.ts";

const RAW_EMAIL = [
  "Delivered-To: mayank@example.com",
  "Received: by mx.google.com with SMTP id abc123;",
  "        Tue, 6 Oct 2026 01:00:37 -0700 (PDT)",
  "From: \u201cAcme HR\u201d <no-reply@workflow.mail.acme.example>",
  "To: mayank@example.com",
  "Subject: Your job application status (Job number: 210781875)",
  "Date: Tue, 06 Oct 2026 08:00:34 +0000 (UTC)",
  "Message-id: <103a8a89@oracle.example>",
  "MIME-version: 1.0",
  "Content-type: text/html; charset=utf-8",
  "Content-transfer-encoding: quoted-printable",
  "",
  "<p>Thank you for your i=",
  "nterest. We=E2=80=99re moving forward with other candi=",
  "dates.</p>",
].join("\n");

test("raw RFC-822 dumps are recognized, other text is not", () => {
  assert.equal(looksLikeRfc822(RAW_EMAIL), true);
  // a hand-typed draft has To/Subject but none of the machine headers
  assert.equal(looksLikeRfc822("To:      tanya@example.com\nSubject: Resumes\n\nHi Tanya,\n"), false);
  // extracted email text (FROM:/DATE:/SUBJECT: pseudo-headers) is not a dump
  assert.equal(looksLikeRfc822("FROM: Recruiter <r@example.com>\nDATE: Thu\nSUBJECT: Invite\n\nHi Alex\n"), false);
  // prose and markdown never match
  assert.equal(looksLikeRfc822("# Tailored\n\nKafka heavy"), false);
  assert.equal(looksLikeRfc822("Experience:\n- Kafka\n- Flink"), false);
});

test("quoted-printable HTML body decodes into the sandboxed iframe", () => {
  const html = renderEmailHtml(RAW_EMAIL, { title: "evidence.txt" });
  assert.match(html, /<iframe[^>]*sandbox="allow-same-origin"[^>]*>/);
  assert.ok(html.includes("We\u2019re moving forward with other candidates."));
  assert.ok(!html.includes("=E2=80=99"), "quoted-printable escapes must be gone");
  assert.ok(!html.includes("i=\nnterest"), "soft line breaks must be gone");
  assert.ok(html.includes("Your job application status (Job number: 210781875)"));
  assert.ok(html.includes("Acme HR"));
});

test("header card escapes hostile header values", () => {
  const hostile = RAW_EMAIL.replace("Subject: Your job application status (Job number: 210781875)", 'Subject: <script>alert("x")</script>');
  const html = renderEmailHtml(hostile, { title: "e.txt" });
  assert.ok(!html.includes("<script>alert"), "subject must be escaped");
  assert.ok(html.includes("&lt;script&gt;"));
});

test("plain-text bodies render as text, not an iframe", () => {
  const email = [
    "From: HR <hr@example.com>",
    "Subject: Interview invite",
    "Message-id: <abc@example.com>",
    "Content-type: text/plain; charset=utf-8",
    "",
    "Please join on Thursday.\nLine two — <b>not markup</b>.",
  ].join("\n");
  const html = renderEmailHtml(email, { title: "e.txt" });
  assert.ok(!html.includes("<iframe"), "text body must not go through an iframe");
  assert.ok(html.includes("Please join on Thursday."));
  assert.ok(html.includes("&lt;b&gt;not markup&lt;/b&gt;"), "body text must be escaped");
});

test("multipart/alternative prefers the HTML part", () => {
  const email = [
    "From: HR <hr@example.com>",
    "Subject: Multipart",
    "MIME-version: 1.0",
    'Content-type: multipart/alternative; boundary="bnd42"',
    "",
    "--bnd42",
    "Content-type: text/plain; charset=utf-8",
    "",
    "plain fallback",
    "--bnd42",
    "Content-type: text/html; charset=utf-8",
    "Content-transfer-encoding: quoted-printable",
    "",
    "<p>rich <b>version</b> R=2D24</p>",
    "--bnd42--",
  ].join("\n");
  const html = renderEmailHtml(email, { title: "e.txt" });
  assert.ok(html.includes("<iframe"), "html part renders in the iframe");
  // the iframe carries the decoded html as an escaped srcdoc attribute
  assert.ok(html.includes("rich &lt;b&gt;version&lt;/b&gt; R-24"), "html part decoded");
  assert.ok(html.includes("color-scheme"), "light-canvas hint for dark-mode review browsers");
  assert.ok(!html.includes("plain fallback</div>"), "plain alternative not the shown body");
});

test("full raw headers stay available in a collapsed block", () => {
  const html = renderEmailHtml(RAW_EMAIL, { title: "e.txt" });
  assert.match(html, /<details>/);
  assert.ok(html.includes("Delivered-To: mayank@example.com"));
  assert.ok(html.includes("Received: by mx.google.com"));
});
