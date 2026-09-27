import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { runCommand } from "../src/cli.ts";
import { withTmpDir } from "./helpers.ts";

interface Collector {
  text: string;
  write: (s: string) => void;
}

function collector(): Collector {
  const out = { text: "", write: (s: string) => { out.text += s; } };
  return out;
}

async function run(argv: string[], root: string) {
  const stdout = collector();
  const stderr = collector();
  const code = await runCommand(argv, { rootDir: root, stdout, stderr });
  return { code, stdout: stdout.text, stderr: stderr.text };
}

test("init scaffolds config and workspace, idempotently", async () => {
  await withTmpDir(async (root) => {
    const first = await run(["init"], root);
    assert.equal(first.code, 0);
    await readFile(join(root, "applymate.config.json"));
    const second = await run(["init"], root);
    assert.equal(second.code, 0);
  });
});

test("config set/get roundtrips through the CLI", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    const set = await run(["config", "set", "chatPort", "5050"], root);
    assert.equal(set.code, 0);
    const get = await run(["config", "get", "chatPort"], root);
    assert.match(get.stdout, /5050/);
  });
});

test("job add/list/show with a description file", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    const jdPath = join(root, "tmp-jd.md");
    await writeFile(jdPath, "# Senior Backend Engineer at Acme\n\nKafka, Go, Kubernetes.");
    const add = await run(["job", "add", "--company", "Acme Corp", "--title", "Senior Backend Engineer", "--file", jdPath], root);
    assert.equal(add.code, 0);
    const jobId = add.stdout.match(/job-[a-z0-9-]+/)?.[0];
    assert.ok(jobId, `expected job id in output: ${add.stdout}`);

    const list = await run(["job", "list", "--json"], root);
    const jobs = JSON.parse(list.stdout) as { company: string }[];
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0]!.company, "Acme Corp");

    const show = await run(["job", "show", jobId!], root);
    assert.match(show.stdout, /Kafka, Go, Kubernetes/);
  });
});

test("job add without any description errors", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    const res = await run(["job", "add", "--company", "A", "--title", "B"], root);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /description/i);
  });
});

test("job match scores against the dossier and gates app start", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    const dossier = join(root, "fixtures", "dossier");
    await mkdir(dossier, { recursive: true });
    await writeFile(join(dossier, "master-resume.md"), "# Me\n\nKafka streaming, Go services, Kubernetes fleets, Terraform on AWS.");
    await run(["config", "set", "dossierDir", dossier], root);
    await run(["dossier", "index"], root);

    const jdPath = join(root, "jd.md");
    await writeFile(jdPath, "Kafka Go Kubernetes Terraform AWS.");
    const add = await run(["job", "add", "--company", "Initech", "--title", "Platform Engineer", "--file", jdPath], root);
    const jobId = add.stdout.match(/job-[a-z0-9-]+/)![0]!;

    const match = await run(["job", "match", jobId!], root);
    assert.equal(match.code, 0);
    assert.match(match.stdout, /match score/i);

    // a weak job is gated...
    const weakPath = join(root, "weak.md");
    await writeFile(weakPath, "Cold-calling sales role, door to door soap sales.");
    const weakAdd = await run(["job", "add", "--company", "SoapCo", "--title", "Sales", "--file", weakPath], root);
    const weakId = weakAdd.stdout.match(/job-[a-z0-9-]+/)![0]!;
    await run(["job", "match", weakId!], root);
    const gated = await run(["app", "start", weakId!], root);
    assert.equal(gated.code, 1);
    assert.match(gated.stderr, /relevance floor/i);

    // ...unless forced
    const forced = await run(["app", "start", weakId!, "--force"], root);
    assert.equal(forced.code, 0);
  });
});

test("app start/move/list/pipeline flow", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    const jdPath = join(root, "jd.md");
    await writeFile(jdPath, "Kafka Go");
    const add = await run(["job", "add", "--company", "Globex", "--title", "SRE", "--file", jdPath], root);
    const jobId = add.stdout.match(/job-[a-z0-9-]+/)![0]!;

    const start = await run(["app", "start", jobId!], root);
    const appId = start.stdout.match(/app-[a-z0-9]+/)?.[0];
    assert.ok(appId);

    const move = await run(["app", "move", appId!, "matched", "--note", "looks good"], root);
    assert.equal(move.code, 0);

    const list = await run(["app", "list", "--status", "matched", "--json"], root);
    assert.equal((JSON.parse(list.stdout) as unknown[]).length, 1);

    const pipeline = await run(["pipeline"], root);
    assert.match(pipeline.stdout, /Globex/);
    assert.match(pipeline.stdout, /matched/);
  });
});

test("dossier index and search against a fixture dossier", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    const dossier = join(root, "fixtures", "dossier");
    await mkdir(dossier, { recursive: true });
    await writeFile(join(dossier, "master-resume.md"), "# Me\n\nKafka streaming, Go services, Kubernetes fleets.");
    await run(["config", "set", "dossierDir", dossier], root);

    const idx = await run(["dossier", "index"], root);
    assert.equal(idx.code, 0);
    assert.match(idx.stdout, /1 files?/);

    const search = await run(["dossier", "search", "kubernetes fleets"], root);
    assert.match(search.stdout, /master-resume\.md/);

    const files = await run(["dossier", "files", "--json"], root);
    assert.equal((JSON.parse(files.stdout) as unknown[]).length, 1);
  });
});

test("prefs and answers: the ask-and-remember loop via CLI", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);

    const missing = await run(["prefs", "missing"], root);
    assert.match(missing.stdout, /companyType/);

    await run(["prefs", "set", "companyType", "product-based", "--source", "chat"], root);
    const get = await run(["prefs", "get", "companyType"], root);
    assert.match(get.stdout, /product-based/);

    const missing2 = await run(["prefs", "missing"], root);
    assert.ok(!missing2.stdout.includes("companyType"));

    await run(["answers", "set", "Are you authorized to work in the US?", "Yes"], root);
    const recalled = await run(["answers", "get", "are you authorized to work in the us"], root);
    assert.match(recalled.stdout, /^Yes$/m);
  });
});

test("chat send/poll/reply/log loop", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    await run(["chat", "send", "--", "Please tailor Acme next"], root);
    const poll = await run(["chat", "poll", "--json"], root);
    const msgs = JSON.parse(poll.stdout) as { text: string }[];
    assert.equal(msgs.length, 1);
    assert.equal(msgs[0]!.text, "Please tailor Acme next");

    const reply = await run(["chat", "reply", "--", "On it, right away."], root);
    assert.equal(reply.code, 0);

    const log = await run(["chat", "log", "--json"], root);
    assert.equal((JSON.parse(log.stdout) as unknown[]).length, 2);
  });
});

test("evidence trail: job evidence before, submit evidence + timestamp after", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    const shot = join(root, "posting.png");
    await writeFile(shot, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    const add = await run(
      ["job", "add", "--company", "Vercel", "--title", "Platform Engineer", "--desc", "Kafka Go", "--url", "https://vercel.com/careers/123"],
      root
    );
    const jobId = add.stdout.match(/job-[a-z0-9-]+/)![0]!;

    const ev = await run(
      ["job", "evidence", jobId!, shot, "--kind", "jd-screenshot", "--url", "https://vercel.com/careers/123", "--at", "2026-09-27T09:00:00.000Z"],
      root
    );
    assert.equal(ev.code, 0);
    const show = await run(["job", "show", jobId!], root);
    assert.match(show.stdout, /evidence \[jd-screenshot\] jobs\//);
    assert.match(show.stdout, /vercel\.com\/careers\/123/);

    // open the application and walk it to ready
    const start = await run(["app", "start", jobId!], root);
    const appId = start.stdout.match(/app-[a-z0-9]+/)?.[0];
    assert.ok(appId);
    await run(["app", "move", appId!, "matched"], root);
    await run(["app", "move", appId!, "tailoring"], root);
    await run(["app", "artifact", appId!, "resume", `applications/${appId}/resume.md`], root);
    await run(["app", "move", appId!, "ready"], root);

    // from ready, `app submitted` records time, portal and confirmation
    const submitted = await run(
      ["app", "submitted", appId!, "--portal", "Greenhouse", "--confirmation", "GH-777", "--at", "2026-09-27T18:42:00.000Z"],
      root
    );
    assert.equal(submitted.code, 0);
    assert.match(submitted.stdout, /2026-09-27T18:42:00\.000Z/);
    assert.match(submitted.stdout, /Greenhouse/);
    assert.match(submitted.stdout, /GH-777/);

    // submit-page screenshot
    const submitShot = join(root, "submit.png");
    await writeFile(submitShot, shot);
    const ev2 = await run(["app", "evidence", appId!, submitShot, "--kind", "submit-screenshot"], root);
    assert.equal(ev2.code, 0);

    const appShow = await run(["app", "show", appId!], root);
    assert.match(appShow.stdout, /submitted: 2026-09-27T18:42:00\.000Z via Greenhouse \(confirmation GH-777\)/);
    assert.match(appShow.stdout, /evidence \[submit-screenshot\]/);
  });
});

test("app submitted from an early status is refused (status machine)", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    const add = await run(["job", "add", "--company", "A", "--title", "B", "--desc", "C"], root);
    const jobId = add.stdout.match(/job-[a-z0-9-]+/)![0]!;
    const start = await run(["app", "start", jobId!], root);
    const appId = start.stdout.match(/app-[a-z0-9]+/)?.[0];
    const res = await run(["app", "submitted", appId!], root);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /illegal status transition/);
  });
});

test("render writes a standalone html file (single-word command + args)", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    const md = join(root, "doc.md");
    await writeFile(md, "# Hello\n\nWorld");
    const outPath = join(root, "doc.html");
    const res = await run(["render", md, "--out", outPath], root);
    assert.equal(res.code, 0);
    const html = await readFile(outPath, "utf8");
    assert.match(html, /<!doctype html>/i);
    assert.match(html, /<h1>Hello<\/h1>/);
  });
});

test("unknown command exits 1 with usage help", async () => {
  await withTmpDir(async (root) => {
    const res = await run(["frobnicate"], root);
    assert.equal(res.code, 1);
    assert.match(res.stderr, /usage/i);
  });
});

test("help lists commands", async () => {
  await withTmpDir(async (root) => {
    const res = await run(["help"], root);
    assert.equal(res.code, 0);
    assert.match(res.stdout, /job add/);
    assert.match(res.stdout, /chat poll/);
    assert.match(res.stdout, /prefs missing/);
  });
});
