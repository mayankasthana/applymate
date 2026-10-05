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

/** Add a job whose description is `text`, and return its id. */
async function addJob(root: string, text: string): Promise<string> {
  const add = await run(["job", "add", "--company", "Acme", "--title", "Staff Engineer", "--desc", text], root);
  assert.equal(add.code, 0, add.stderr);
  return add.stdout.match(/job-[a-z0-9-]+/)![0]!;
}

test("job pay reads a figure out of the posting text and shows it back", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    const id = await addJob(root, "Compensation: base salary $140K - $210K per year.");

    const none = await run(["job", "pay", id], root);
    assert.match(none.stdout, /no pay figure on file/);

    const extract = await run(["job", "pay", id, "--extract"], root);
    assert.equal(extract.code, 0);
    assert.match(extract.stdout, /\$140–210K/);
    assert.match(extract.stdout, /stated in the posting/);

    const show = await run(["job", "pay", id, "--json"], root);
    const comp = JSON.parse(show.stdout) as { low: number; high: number; currency: string; basis: string };
    assert.deepEqual([comp.low, comp.high, comp.currency, comp.basis], [140_000, 210_000, "USD", "posted"]);
  });
});

test("job pay --extract records nothing when the text states no figure", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    const id = await addJob(root, "We raised $50M Series B and employ 400 people across 12 offices.");
    const res = await run(["job", "pay", id, "--extract"], root);
    assert.equal(res.code, 1);
    assert.match(res.stdout, /no pay figure found/i);
    assert.match(res.stdout, /do not estimate|Nothing was recorded/);
    const show = await run(["job", "pay", id, "--json"], root);
    assert.equal(JSON.parse(show.stdout), null);
  });
});

test("job pay --extract lists every band and takes the one the agent picks", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    const id = await addJob(root, "Backend Engineer (India) ₹25L - ₹55L INR. Other jobs at Acme: SDR $60K - $65K.");
    const res = await run(["job", "pay", id, "--extract"], root);
    assert.equal(res.code, 0);
    assert.match(res.stdout, /2 pay bands/);
    assert.match(res.stdout, /₹25–55L/);

    const second = await run(["job", "pay", id, "--extract", "--pick", "2"], root);
    assert.equal(second.code, 0);
    const show = await run(["job", "pay", id, "--json"], root);
    assert.equal((JSON.parse(show.stdout) as { currency: string }).currency, "USD");

    const bad = await run(["job", "pay", id, "--extract", "--pick", "9"], root);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /out of range/);
  });
});

test("a figure typed by hand must name the source it was read from", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    const id = await addJob(root, "Kafka, Go.");

    const noSource = await run(["job", "pay", id, "--low", "200000", "--high", "260000", "--currency", "USD"], root);
    assert.equal(noSource.code, 1);
    assert.match(noSource.stderr, /--source is required/);

    const ok = await run(
      ["job", "pay", id, "--low", "200000", "--high", "260000", "--currency", "USD",
       "--source", "https://example.com/jobs/1", "--source-name", "Example careers page"],
      root
    );
    assert.equal(ok.code, 0, ok.stderr);
    assert.match(ok.stdout, /\$200–260K/);

    const noCurrency = await run(
      ["job", "pay", id, "--low", "200000", "--high", "260000", "--currency", "dollars", "--source", "https://example.com/1"],
      root
    );
    assert.equal(noCurrency.code, 1);
  });
});

test("job pay --clear removes the figure and the card falls back to none", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    const id = await addJob(root, "base salary $140K - $210K");
    await run(["job", "pay", id, "--extract"], root);
    const clear = await run(["job", "pay", id, "--clear"], root);
    assert.equal(clear.code, 0);
    assert.match(clear.stdout, /cleared/);
    assert.equal(JSON.parse((await run(["job", "pay", id, "--json"], root)).stdout), null);
  });
});

test("job pay --extract reads a saved page snapshot with --file", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    const id = await addJob(root, "The range is listed on the page, not in this text.");
    const page = join(root, "page.html");
    await writeFile(page, "<html><body>Pay transparency: base salary €93,280.00 - €139,920.00 per year</body></html>");
    const res = await run(["job", "pay", id, "--extract", "--file", page], root);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /€93\.3–139\.9K/);
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

test("app pursuit records the conversion verdict; board and show surface it", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    const jdPath = join(root, "jd.md");
    await writeFile(jdPath, "Kafka Go");
    const add = await run(["job", "add", "--company", "Globex", "--title", "SRE", "--file", jdPath], root);
    const jobId = add.stdout.match(/job-[a-z0-9-]+/)![0]!;
    const start = await run(["app", "start", jobId], root);
    const appId = start.stdout.match(/app-[a-z0-9]+/)![0]!;

    const set = await run(["app", "pursuit", appId, "amber", "--note", "referral required"], root);
    assert.equal(set.code, 0);
    assert.match(set.stdout, /amber/);

    // board shows the verdict next to the match score
    const board = await run(["pipeline"], root);
    assert.match(board.stdout, /\[amber\]/);

    const show = await run(["app", "show", appId], root);
    assert.match(show.stdout, /pursuit: amber/);
    assert.match(show.stdout, /referral required/);

    const asJson = await run(["app", "show", appId, "--json"], root);
    const detail = JSON.parse(asJson.stdout) as { pursuit: { verdict: string; note: string } };
    assert.equal(detail.pursuit.verdict, "amber");
    assert.equal(detail.pursuit.note, "referral required");

    const bad = await run(["app", "pursuit", appId, "mauve"], root);
    assert.equal(bad.code, 1);
    assert.match(bad.stderr, /pursuit verdict/i);
  });
});

test("pipeline and app show surface referral/outreach status", async () => {
  await withTmpDir(async (root) => {
    await run(["init"], root);
    const jdPath = join(root, "jd.md");
    await writeFile(jdPath, "Kafka Go");
    const add = await run(["job", "add", "--company", "Globex", "--title", "SRE", "--file", jdPath], root);
    const jobId = add.stdout.match(/job-[a-z0-9-]+/)![0]!;
    const start = await run(["app", "start", jobId], root);
    const appId = start.stdout.match(/app-[a-z0-9]+/)![0]!;

    // before any outreach: the board says the role has no referral yet
    const bare = await run(["pipeline"], root);
    assert.match(bare.stdout, /\[no refs\]/);

    await run(["outreach", "log", "--target", "Jane", "--role", "referrer", "--channel", "dm", "--app", appId], root);

    const board = await run(["pipeline"], root);
    assert.match(board.stdout, /\[refs 1\]/);
    assert.ok(!board.stdout.includes("[no refs]"));

    const show = await run(["app", "show", appId], root);
    assert.match(show.stdout, /outreach \[referrer\] Jane · dm · awaiting-reply/);

    const asJson = await run(["app", "show", appId, "--json"], root);
    const detail = JSON.parse(asJson.stdout) as { outreach: { targetRole: string; state: string }[] };
    assert.equal(detail.outreach.length, 1);
    assert.equal(detail.outreach[0]!.targetRole, "referrer");

    const boardJson = await run(["pipeline", "--json"], root);
    const apps = Object.values(JSON.parse(boardJson.stdout) as Record<string, { referrals: number }[]>).flat();
    assert.equal(apps[0]!.referrals, 1);
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
