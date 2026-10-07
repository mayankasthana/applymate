import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { request } from "node:http";
import type { Server } from "node:http";

import { runServer } from "../src/server.ts";
import { UI_HTML } from "../src/server-ui.ts";
import { saveConfig, type Config } from "../src/config.ts";
import { makeServices } from "../src/workspace.ts";
import { withTmpDir } from "./helpers.ts";

/** GET with a forged Host header — how a rebinding attack would arrive. */
function getWithHost(base: string, host: string, path = "/api/state"): Promise<{ status: number; body: string }> {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const req = request(
      { host: url.hostname, port: url.port, path, method: "GET", headers: { host } },
      (res) => {
        let body = "";
        res.on("data", (c: Buffer) => (body += c.toString("utf8")));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

interface Running {
  server: Server;
  base: string;
  config: Config;
}

async function startServer(root: string): Promise<Running> {
  const config = await saveConfig(root, {});
  const server = await runServer({ config, port: 0, log: () => {} });
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { server, base: `http://127.0.0.1:${port}`, config };
}

function stop(server: Server): void {
  server.closeAllConnections();
  server.close();
}

/** Run `fn` with a server; always stops it, even when fn throws. */
async function withServer(fn: (running: Running) => Promise<void>): Promise<void> {
  await withTmpDir(async (root) => {
    const running = await startServer(root);
    try {
      await fn(running);
    } finally {
      stop(running.server);
    }
  });
}

test("serves the UI page on / and binds to loopback", async () => {
  await withServer(async ({ server, base }) => {
    const addr = server.address();
    assert.equal(typeof addr === "object" && addr ? addr.address : "?", "127.0.0.1");
    const res = await fetch(base + "/");
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Aja/);
    assert.match(html, /api\/state/);
  });
});

// The UI is one embedded <script> inside a template literal, so a quote typed
// wrong there compiles cleanly and then dies at runtime, leaving the page stuck
// on "loading…" with no build error anywhere. Parse it here instead.
test("the embedded UI script is syntactically valid JavaScript", () => {
  const script = UI_HTML.match(/<script>([\s\S]*)<\/script>/);
  assert.ok(script, "UI_HTML must contain a <script> block");
  assert.doesNotThrow(
    () => new Function(script![1]!),
    "embedded UI script has a syntax error",
  );
});

test("chat: POST from the UI, GET by cursor, visible to the agent", async () => {
  await withServer(async ({ base, config }) => {
    const post = await fetch(base + "/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "find me product companies" }),
    });
    assert.equal(post.status, 201);

    const feed = (await (await fetch(base + "/api/chat?since=0")).json()) as { from: string; text: string }[];
    assert.equal(feed.length, 1);
    assert.equal(feed[0]!.from, "user");

    const services = makeServices(config);
    const polled = await services.chat.poll({ since: 0, waitMs: 0 });
    assert.equal(polled.length, 1);
    assert.equal(polled[0]!.text, "find me product companies");
  });
});

test("state endpoint exposes pipeline, prefs and missing preferences", async () => {
  await withServer(async ({ base }) => {
    await fetch(base + "/api/prefs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "companyType", value: "product-based" }),
    });
    await fetch(base + "/api/prefs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "candidateName", value: "Priya" }),
    });
    const state = (await (await fetch(base + "/api/state")).json()) as {
      pipeline: Record<string, unknown[]>;
      missingPreferences: string[];
      preferences: { key: string; value: unknown }[];
    };
    assert.ok(typeof state.pipeline === "object");
    // stored keys are normalized ("companytype"); recommended list keeps display form
    assert.ok(!state.missingPreferences.includes("companyType"));
    assert.ok(state.missingPreferences.includes("salaryFloor"));
    const stored = state.preferences.find((p) => p.key === "companytype");
    assert.equal(stored!.value, "product-based");
    // the candidate's name roundtrips under its normalized key (UI greets by it)
    assert.ok(!state.missingPreferences.includes("candidateName"));
    const storedName = state.preferences.find((p) => p.key === "candidatename");
    assert.equal(storedName!.value, "Priya");
  });
});

test("state endpoint filters the pipeline through ?q= (req id, company, terms)", async () => {
  await withServer(async ({ base, config }) => {
    const services = makeServices(config);
    const adtech = await services.pipeline.addJob({
      company: "Example Retail Co",
      title: "Staff Software Engineer — Advertising",
      description: "ad servers",
      url: "https://walmart.example/job/STAFF--SOFTWARE-ENGINEER_R-2646399",
    });
    const other = await services.pipeline.addJob({ company: "InMobi", title: "Staff Engineer I", description: "ads" });
    const adtechApp = await services.pipeline.startApplication(adtech.id);
    const otherApp = await services.pipeline.startApplication(other.id);

    const idsFor = async (q: string) => {
      const state = (await (await fetch(base + "/api/state?q=" + encodeURIComponent(q))).json()) as {
        pipeline: Record<string, { id: string }[]>;
      };
      return Object.values(state.pipeline).flat().map((a) => a.id).sort();
    };

    // req number lives in the posting URL
    assert.deepEqual(await idsFor("R-2646399"), [adtechApp.id]);
    // company + free term, case-insensitive
    assert.deepEqual(await idsFor("inmobi"), [otherApp.id]);
    assert.deepEqual(await idsFor("advertising"), [adtechApp.id]);
    // AND semantics and the no-match case
    assert.deepEqual(await idsFor("walmart staff"), [adtechApp.id]);
    assert.deepEqual(await idsFor("inmobi walmart"), []);
  });
});

test("application endpoint joins job details", async () => {
  await withServer(async ({ base, config }) => {
    const services = makeServices(config);
    const job = await services.pipeline.addJob({ company: "Acme", title: "SRE", description: "Kafka" });
    const app = await services.pipeline.startApplication(job.id);
    const res = await fetch(base + `/api/application/${app.id}`);
    const body = (await res.json()) as { jobId: string; job: { company: string } };
    assert.equal(body.jobId, job.id);
    assert.equal(body.job.company, "Acme");
  });
});

test("state and application endpoints surface outreach/referral status", async () => {
  await withServer(async ({ base, config }) => {
    const services = makeServices(config);
    const job = await services.pipeline.addJob({ company: "Acme", title: "SRE", description: "Kafka" });
    const app = await services.pipeline.startApplication(job.id);
    await services.outreach.log({ target: "Jane Referrer", targetRole: "referrer", channel: "dm", appId: app.id, company: "Acme" });
    await services.outreach.log({ target: "Stray Note", targetRole: "other", channel: "email" });

    const state = (await (await fetch(base + "/api/state")).json()) as {
      outreach: { appId: string | null; targetRole: string; state: string }[];
    };
    assert.equal(state.outreach.length, 2);
    const linked = state.outreach.find((m) => m.appId === app.id);
    assert.equal(linked!.targetRole, "referrer");
    assert.equal(linked!.state, "awaiting-reply");

    const detail = (await (await fetch(base + `/api/application/${app.id}`)).json()) as {
      outreach: { target: string; state: string }[];
    };
    assert.equal(detail.outreach.length, 1);
    assert.equal(detail.outreach[0]!.target, "Jane Referrer");
  });
});

test("state endpoint aggregates actions: overdue decisions, follow-ups due, staged apps, upcoming", async () => {
  await withServer(async ({ base, config }) => {
    const services = makeServices(config);
    const job = await services.pipeline.addJob({ company: "Acme", title: "SRE", description: "Kafka" });
    const app = await services.pipeline.startApplication(job.id);
    // walk to ready: matched -> tailoring -> ready (gates on a resume artifact)
    await services.pipeline.move(app.id, "matched");
    await services.pipeline.move(app.id, "tailoring");
    await services.pipeline.attachArtifact(app.id, "resume", "applications/x/resume.md");
    await services.pipeline.move(app.id, "ready");
    // an overdue decision and an upcoming one
    await services.reminders.add({ title: "old fallback", dueAt: "2020-01-01", appId: app.id }, { now: "2019-12-01T00:00:00.000Z" });
    await services.reminders.add({ title: "future clock", dueAt: "2099-01-01", appId: app.id }, { now: "2019-12-01T00:00:00.000Z" });
    // a follow-up past its 4–5 day window
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
    await services.outreach.log({ target: "Jane Referrer", targetRole: "referrer", channel: "dm", appId: app.id }, { now: tenDaysAgo });

    const state = (await (await fetch(base + "/api/state")).json()) as {
      actions: {
        dueReminders: { title: string; overdueDays: number }[];
        upcomingReminders: { title: string }[];
        dueFollowUps: { target: string; state: string }[];
        staged: { id: string; company: string; wait: { kind: string; label: string; detail: string } }[];
      };
    };
    assert.deepEqual(state.actions.dueReminders.map((r) => r.title), ["old fallback"]);
    assert.ok(state.actions.dueReminders[0]!.overdueDays > 0);
    assert.deepEqual(state.actions.upcomingReminders.map((r) => r.title), ["future clock"]);
    assert.equal(state.actions.dueFollowUps.length, 1);
    assert.equal(state.actions.dueFollowUps[0]!.target, "Jane Referrer");
    assert.equal(state.actions.dueFollowUps[0]!.state, "follow-up-due");
    assert.ok(state.actions.staged.some((s) => s.id === app.id && s.company === "Acme"));
    // the staged app carries the reason it is waiting: Jane Referrer's ask is
    // 10 days old with no reply, so the card names the idle referral ask
    const stagedApp = state.actions.staged.find((s) => s.id === app.id)!;
    assert.equal(stagedApp.wait.kind, "referral");
    assert.equal(stagedApp.wait.label, "referral ask idle");
    assert.match(stagedApp.wait.detail, /Jane Referrer/);
  });
});

test("state endpoint filters and sorts through query parameters", async () => {
  await withServer(async ({ base, config }) => {
    const services = makeServices(config);
    const strong = await services.pipeline.addJob({ company: "Zeta", title: "Staff Engineer", description: "kafka" });
    const weak = await services.pipeline.addJob({ company: "Alpha", title: "Engineer II", description: "kafka" });
    const strongApp = await services.pipeline.startApplication(strong.id);
    const weakApp = await services.pipeline.startApplication(weak.id);
    await services.pipeline.setMatch(strongApp.id, { score: 91 });
    await services.pipeline.setMatch(weakApp.id, { score: 55 });

    const state = async (q: string) =>
      (await (await fetch(base + "/api/state" + q)).json()) as {
        pipeline: Record<string, { id: string }[]>;
        board: { total: number; shown: number; sort: string; minScore: number };
      };

    const shown = async (q: string) => Object.values((await state(q)).pipeline).flat().map((a) => a.id).sort();

    assert.deepEqual(await shown("?minScore=80"), [strongApp.id]);
    assert.deepEqual(await shown("?sort=company"), [strongApp.id, weakApp.id].sort());
    assert.deepEqual(await shown("?status=discovered"), [strongApp.id, weakApp.id].sort());
    assert.deepEqual(await shown("?status=ready"), []);
    assert.deepEqual(await shown("?q=zeta"), [strongApp.id]);

    // Junk parameters narrow nothing instead of erroring.
    assert.equal((await state("?minScore=abc&pursuit=purple&sort=sideways")).board.shown, 2);

    const unfiltered = await state("");
    assert.equal(unfiltered.board.total, 2);
    assert.equal(unfiltered.board.shown, 2);
    assert.equal(unfiltered.board.sort, "recent");
    const filtered = await state("?minScore=80");
    assert.equal(filtered.board.total, 2, "the total is the whole board, not the view");
    assert.equal(filtered.board.shown, 1);
    assert.equal(filtered.board.minScore, 80);
  });
});

test("state endpoint sorts a lane by pay, without ranking currencies against each other", async () => {
  await withServer(async ({ base, config }) => {
    const services = makeServices(config);
    const usd = await services.pipeline.addJob({ company: "Euro Co", title: "Staff", description: "kafka" });
    const inr = await services.pipeline.addJob({ company: "India Co", title: "Staff", description: "kafka" });
    const none = await services.pipeline.addJob({ company: "Quiet Co", title: "Staff", description: "kafka" });
    const usdApp = await services.pipeline.startApplication(usd.id);
    const inrApp = await services.pipeline.startApplication(inr.id);
    const noneApp = await services.pipeline.startApplication(none.id);
    await services.pipeline.setJobComp(usd.id, { low: 200_000, high: 260_000, currency: "USD", basis: "posted" });
    await services.pipeline.setJobComp(inr.id, { low: 8_000_000, high: 9_000_000, currency: "INR", basis: "posted" });

    const state = (await (await fetch(base + "/api/state?sort=pay")).json()) as {
      pipeline: { discovered: { id: string; pay: { label: string; basis: string | null } }[] };
    };
    // INR sorts before USD (currency alphabetical), and the card with no figure
    // is last rather than being treated as zero.
    assert.deepEqual(state.pipeline.discovered.map((c) => c.id), [inrApp.id, usdApp.id, noneApp.id]);
    assert.deepEqual(state.pipeline.discovered.map((c) => c.pay.label), ["₹80–90L", "$200–260K", "no pay figure"]);
    assert.deepEqual(state.pipeline.discovered.map((c) => c.pay.basis), ["posted", "posted", null]);
  });
});

test("pay filters split cards that have a figure from those that do not", async () => {
  await withServer(async ({ base, config }) => {
    const services = makeServices(config);
    const withPay = await services.pipeline.addJob({ company: "Paid Co", title: "Staff", description: "kafka" });
    const without = await services.pipeline.addJob({ company: "Quiet Co", title: "Staff", description: "kafka" });
    await services.pipeline.setJobComp(withPay.id, { low: 40_000, high: 50_000, currency: "GBP", basis: "posted" });
    await services.pipeline.startApplication(withPay.id);
    await services.pipeline.startApplication(without.id);

    const shown = async (q: string) => {
      const state = (await (await fetch(base + "/api/state" + q)).json()) as { pipeline: Record<string, { company: string }[]> };
      return Object.values(state.pipeline).flat().map((c) => c.company).sort();
    };
    assert.deepEqual(await shown("?pay=with"), ["Paid Co"]);
    assert.deepEqual(await shown("?pay=without"), ["Quiet Co"]);
    assert.deepEqual(await shown("?pay=with&minScore=50"), [], "filters combine");
  });
});

test("the floor is read from the candidate's own preference and compared in-currency only", async () => {
  await withServer(async ({ base, config }) => {
    const services = makeServices(config);
    await fetch(base + "/api/prefs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: "salaryFloor", value: "60 LPA (INR)" }),
    });
    const below = await services.pipeline.addJob({ company: "Low Co", title: "Staff", description: "kafka" });
    const usd = await services.pipeline.addJob({ company: "Dollar Co", title: "Staff", description: "kafka" });
    await services.pipeline.setJobComp(below.id, { low: 3_000_000, high: 4_000_000, currency: "INR", basis: "posted" });
    await services.pipeline.setJobComp(usd.id, { low: 200_000, high: 260_000, currency: "USD", basis: "posted" });
    await services.pipeline.startApplication(below.id);
    await services.pipeline.startApplication(usd.id);

    const state = (await (await fetch(base + "/api/state")).json()) as {
      floor: { amount: number; currency: string };
      pipeline: Record<string, { company: string; pay: { verdict: string; title: string } }[]>;
    };
    assert.deepEqual(state.floor, { amount: 6_000_000, currency: "INR", asText: "60 LPA (INR)" });
    const cards = Object.values(state.pipeline).flat();
    assert.equal(cards.find((c) => c.company === "Low Co")!.pay.verdict, "below");
    // Dollars are never ranked against a rupee floor without an exchange rate.
    assert.equal(cards.find((c) => c.company === "Dollar Co")!.pay.verdict, "unknown");
    assert.match(cards.find((c) => c.company === "Low Co")!.pay.title, /under your floor of 60 LPA \(INR\)/);

    const filtered = (await (await fetch(base + "/api/state?pay=below-floor")).json()) as {
      pipeline: Record<string, { company: string }[]>;
    };
    assert.deepEqual(Object.values(filtered.pipeline).flat().map((c) => c.company), ["Low Co"]);
  });
});

test("a job with no floor set reports no floor rather than a default one", async () => {
  await withServer(async ({ base, config }) => {
    const services = makeServices(config);
    const job = await services.pipeline.addJob({ company: "Acme", title: "SRE", description: "Kafka" });
    await services.pipeline.setJobComp(job.id, { low: 100_000, high: 120_000, currency: "USD", basis: "posted" });
    await services.pipeline.startApplication(job.id);
    const state = (await (await fetch(base + "/api/state")).json()) as {
      floor: null;
      pipeline: Record<string, { pay: { verdict: string } }[]>;
    };
    assert.equal(state.floor, null);
    assert.equal(Object.values(state.pipeline).flat()[0]!.pay.verdict, "no-floor");
  });
});

test("the application endpoint returns the pay figure with its source", async () => {
  await withServer(async ({ base, config }) => {
    const services = makeServices(config);
    const job = await services.pipeline.addJob({ company: "Acme", title: "SRE", description: "Kafka" });
    await services.pipeline.setJobComp(job.id, {
      low: 140_000,
      high: 210_000,
      currency: "USD",
      basis: "sourced",
      sourceUrl: "https://example.com/jobs/1",
      sourceName: "Example careers page",
      asText: "$140K - $210K",
    });
    const app = await services.pipeline.startApplication(job.id);
    const detail = (await (await fetch(base + `/api/application/${app.id}`)).json()) as {
      pay: { label: string; basis: string; url: string; title: string };
    };
    assert.equal(detail.pay.label, "$140–210K");
    assert.equal(detail.pay.basis, "sourced");
    assert.equal(detail.pay.url, "https://example.com/jobs/1");
    assert.match(detail.pay.title, /scraped from Example careers page/);
  });
});

test("the pay-request button queues a request for the agent, without inventing a figure", async () => {
  await withServer(async ({ base, config }) => {
    const services = makeServices(config);
    const job = await services.pipeline.addJob({ company: "Acme", title: "SRE", description: "Kafka" });
    const app = await services.pipeline.startApplication(job.id);

    const res = await fetch(base + "/api/pay-request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: job.id }),
    });
    assert.equal(res.status, 201);

    // The request lands in the queue the agent polls, naming the job.
    const feed = (await (await fetch(base + "/api/chat?since=0")).json()) as { from: string; text: string }[];
    assert.equal(feed.length, 1);
    assert.equal(feed[0]!.from, "user");
    assert.match(feed[0]!.text, /Acme/);
    assert.match(feed[0]!.text, /do not estimate/);

    // Asking does not fill in a number: the card still says there is none.
    const state = (await (await fetch(base + "/api/state")).json()) as {
      pipeline: Record<string, { id: string; comp: null }[]>;
    };
    assert.equal(Object.values(state.pipeline).flat().find((c) => c.id === app.id)!.comp, null);

    assert.equal(
      (await fetch(base + "/api/pay-request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) })).status,
      400
    );
    assert.equal(
      (await fetch(base + "/api/pay-request", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: "job-nope" }) })).status,
      404
    );
  });
});

test("the review UI ships the filter bar and the pay affordances", () => {
  // A cheap guard that the controls survive edits to the embedded page.
  for (const id of ["minScore", "pursuit", "stages", "payFilter", "sortBy", "viewReset", "floorHint"]) {
    assert.match(UI_HTML, new RegExp(`id="${id}"`), `the view bar must keep #${id}`);
  }
  assert.match(UI_HTML, /\/api\/pay-request/, "the sheet must offer to ask the agent for a figure");
  assert.match(UI_HTML, /localStorage/, "the chosen view survives a reload");
});

test("artifact endpoint renders workspace markdown and blocks path escape", async () => {
  await withServer(async ({ base, config }) => {
    const services = makeServices(config);
    await mkdir(join(services.paths.applications, "app-x"), { recursive: true });
    await writeFile(join(services.paths.applications, "app-x", "resume.md"), "# Tailored\n\nKafka heavy");
    await writeFile(join(config._root, "secret.txt"), "token");

    const ok = await fetch(base + "/api/artifact?path=" + encodeURIComponent("applications/app-x/resume.md"));
    const html = await ok.text();
    assert.match(html, /<h1>Tailored<\/h1>/);

    const evil = await fetch(base + "/api/artifact?path=" + encodeURIComponent("../secret.txt"));
    assert.equal(evil.status, 403);
  });
});

test("artifact endpoint serves evidence screenshots with an image content-type", async () => {
  await withServer(async ({ base, config }) => {
    const services = makeServices(config);
    const dir = join(services.paths.applications, "app-x", "evidence");
    await mkdir(dir, { recursive: true });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await writeFile(join(dir, "submit-screenshot.png"), png);

    const res = await fetch(base + "/api/artifact?path=" + encodeURIComponent("applications/app-x/evidence/submit-screenshot.png"));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^image\/png/);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), png);
  });
});

test("html artifacts render as pages, sandboxed away from the UI origin", async () => {
  await withServer(async ({ base, config }) => {
    const services = makeServices(config);
    const dir = join(services.paths.applications, "app-x", "evidence");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "jd-snapshot.html"), "<html><body><h1>JD page</h1><script>fetch('/api/state')</script></body></html>");

    const res = await fetch(base + "/api/artifact?path=" + encodeURIComponent("applications/app-x/evidence/jd-snapshot.html"));
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /^text\/html/);
    assert.equal(res.headers.get("content-security-policy"), "sandbox");
    const html = await res.text();
    assert.ok(html.includes("<h1>JD page</h1>"), "served raw, not escaped into a <pre>");
    assert.ok(html.includes('name="color-scheme"'), "light-canvas hint injected for dark-mode review browsers");
  });
});

test("raw email evidence renders as a mail viewer, not a markdown blob", async () => {
  await withServer(async ({ base, config }) => {
    const services = makeServices(config);
    const dir = join(services.paths.applications, "app-x", "evidence");
    await mkdir(dir, { recursive: true });
    const email = [
      "Delivered-To: mayank@example.com",
      "Received: by mx.google.com with SMTP id abc;",
      "From: Acme HR <no-reply@example.com>",
      "To: mayank@example.com",
      "Subject: Your job application status",
      "Content-type: text/plain; charset=utf-8",
      "",
      "We are moving forward with other candidates.",
    ].join("\n");
    await writeFile(join(dir, "20261006T080604-rejection-email-kpr0.txt"), email);

    const res = await fetch(base + "/api/artifact?path=" + encodeURIComponent("applications/app-x/evidence/20261006T080604-rejection-email-kpr0.txt"));
    const html = await res.text();
    assert.ok(html.includes("Your job application status"), "subject surfaces in the header card");
    assert.ok(html.includes("We are moving forward with other candidates."), "body renders");
    assert.ok(html.includes("<details>"), "raw headers stay on the page");
  });
});

test("discard endpoint closes an application and keeps it visible on the board", async () => {
  await withServer(async ({ base, config }) => {
    const services = makeServices(config);
    const job = await services.pipeline.addJob({ company: "Acme", title: "SRE", description: "Kafka" });
    const app = await services.pipeline.startApplication(job.id);

    const res = await fetch(base + "/api/discard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: app.id }),
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { id: string; status: string };
    assert.equal(body.id, app.id);
    assert.equal(body.status, "closed");

    const stored = await services.pipeline.getApplication(app.id);
    assert.equal(stored.status, "closed");

    // the card stays visible, in the closed column of the pipeline board
    const state = (await (await fetch(base + "/api/state")).json()) as {
      pipeline: Record<string, { id: string }[]>;
    };
    assert.ok((state.pipeline.closed ?? []).some((a) => a.id === app.id));
  });
});

test("discard endpoint: unknown application 404s, missing id 400s", async () => {
  await withServer(async ({ base }) => {
    const unknown = await fetch(base + "/api/discard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "app-none" }),
    });
    assert.equal(unknown.status, 404);

    const noId = await fetch(base + "/api/discard", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(noId.status, 400);
  });
});

test("rejects non-loopback Host headers (DNS rebinding guard)", async () => {
  await withServer(async ({ base }) => {
    const port = new URL(base).port;
    const evil = await getWithHost(base, "evil.example.com");
    assert.equal(evil.status, 403);
    const rebound = await getWithHost(base, `evil.example.com:${port}`);
    assert.equal(rebound.status, 403);
    const ok = await getWithHost(base, `localhost:${port}`);
    assert.equal(ok.status, 200);
    const loopback = await getWithHost(base, `127.0.0.1:${port}`);
    assert.equal(loopback.status, 200);
  });
});

test("unknown api routes 404", async () => {
  await withServer(async ({ base }) => {
    const res = await fetch(base + "/api/nope");
    assert.equal(res.status, 404);
  });
});
