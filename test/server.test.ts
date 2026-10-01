import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { request } from "node:http";
import type { Server } from "node:http";

import { runServer } from "../src/server.ts";
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
        staged: { id: string; company: string }[];
      };
    };
    assert.deepEqual(state.actions.dueReminders.map((r) => r.title), ["old fallback"]);
    assert.ok(state.actions.dueReminders[0]!.overdueDays > 0);
    assert.deepEqual(state.actions.upcomingReminders.map((r) => r.title), ["future clock"]);
    assert.equal(state.actions.dueFollowUps.length, 1);
    assert.equal(state.actions.dueFollowUps[0]!.target, "Jane Referrer");
    assert.equal(state.actions.dueFollowUps[0]!.state, "follow-up-due");
    assert.ok(state.actions.staged.some((s) => s.id === app.id && s.company === "Acme"));
  });
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
