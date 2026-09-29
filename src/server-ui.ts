/**
 * The review UI, embedded as one string so the server has zero static-file
 * plumbing. Vanilla JS: polls the chat queue every 2s, renders the pipeline
 * board, and surfaces missing preferences as inline forms — the "ask me and
 * remember it" loop, human side.
 */
export const UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aja — job pipeline & chat</title>
<style>
  :root { color-scheme: light; --ink:#1a202c; --muted:#718096; --line:#e2e8f0; --accent:#2b6cb0; --ok:#2f855a; }
  * { box-sizing: border-box; }
  body { margin:0; font:15px/1.5 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color:var(--ink); background:#f7fafc; }
  header { display:flex; align-items:baseline; gap:.6rem; padding:.9rem 1.2rem; background:#fff; border-bottom:1px solid var(--line); }
  header h1 { font-size:1.05rem; margin:0; }
  header .sub { color:var(--muted); font-size:.85rem; }
  main { display:grid; grid-template-columns: minmax(0,1fr) 380px; gap:1rem; padding:1rem; max-width:1200px; margin:0 auto; }
  @media (max-width: 900px){ main { grid-template-columns: 1fr; } }
  section.card { background:#fff; border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  section.card h2 { font-size:.8rem; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); margin:0; padding:.7rem 1rem; border-bottom:1px solid var(--line); }
  #prefs { grid-column: 1 / -1; }
  #prefs .row { display:flex; flex-wrap:wrap; gap:.5rem; padding:.7rem 1rem; align-items:center; }
  .chip { display:inline-flex; gap:.4rem; align-items:center; background:#ebf8ff; border:1px solid #bee3f8; border-radius:999px; padding:.15rem .3rem .15rem .7rem; font-size:.85rem; }
  .chip form { display:inline-flex; gap:.3rem; }
  .chip input { border:1px solid #bee3f8; border-radius:999px; padding:.15rem .6rem; font-size:.85rem; min-width:9rem; }
  .chip button, .btn { border:0; background:var(--accent); color:#fff; border-radius:999px; padding:.22rem .8rem; font-size:.85rem; cursor:pointer; }
  #board { display:grid; gap:1rem; padding:1rem; }
  .status h3 { font-size:.75rem; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:0 0 .4rem; }
  .job { border:1px solid var(--line); border-radius:8px; padding:.55rem .75rem; margin-bottom:.45rem; background:#fff; cursor:pointer; }
  .job:hover { border-color:var(--accent); }
  .job .t { font-weight:600; }
  .job .c { color:var(--muted); font-size:.85rem; }
  .job .req { display:inline-block; margin-left:.4rem; font-size:.75rem; color:var(--accent); text-decoration:none; border:1px solid var(--line); border-radius:999px; padding:0 .45rem; }
  .job .req:hover { border-color:var(--accent); }
  .score { float:right; font-size:.75rem; border-radius:999px; padding:.05rem .55rem; background:#edf2f7; }
  .score.strong { background:#c6f6d5; color:var(--ok); }
  .score.good { background:#feebc8; }
  .score.fair, .score.stretch { background:#fed7d7; }
  .ref { float:right; margin-right:.3rem; font-size:.75rem; border-radius:999px; padding:.05rem .55rem; background:#edf2f7; color:var(--muted); }
  .ref.yes { background:#c6f6d5; color:var(--ok); }
  .ref.no { background:#feebc8; color:#7b341e; }
  .job .discard { float:right; margin-left:.3rem; border:1px solid var(--line); background:none; color:var(--muted); border-radius:999px; width:1.35rem; height:1.35rem; font-size:.75rem; line-height:1; cursor:pointer; }
  .job .discard:hover { border-color:#e53e3e; color:#e53e3e; background:#fff5f5; }
  .ostate.follow-up-due { color:#c05621; font-weight:600; }
  .ostate.replied { color:var(--ok); }
  ul.outreach { margin:.3rem 0; padding-left:1.1rem; }
  ul.outreach li { margin:.2rem 0; }
  #chatlog { height:60vh; overflow-y:auto; padding:.8rem; display:flex; flex-direction:column; gap:.45rem; }
  .bubble { max-width:88%; padding:.5rem .75rem; border-radius:12px; white-space:pre-wrap; word-wrap:break-word; }
  .bubble.user { align-self:flex-end; background:var(--accent); color:#fff; border-bottom-right-radius:4px; }
  .bubble.agent { align-self:flex-start; background:#edf2f7; border-bottom-left-radius:4px; }
  .bubble .who { display:block; font-size:.7rem; opacity:.75; margin-bottom:.15rem; }
  #composer { display:flex; border-top:1px solid var(--line); }
  #composer input { flex:1; border:0; padding:.8rem .9rem; font:inherit; outline:none; }
  #composer button { border:0; background:var(--accent); color:#fff; padding:0 1.1rem; cursor:pointer; }
  #overlay { position:fixed; inset:0; background:rgba(26,32,44,.45); display:none; align-items:center; justify-content:center; }
  #overlay.open { display:flex; }
  #overlay .sheet { background:#fff; border-radius:12px; max-width:760px; width:92%; max-height:86vh; overflow:auto; padding:1.2rem 1.4rem; }
  #overlay h3 { margin:.1rem 0 .6rem; }
  #overlay .close { float:right; border:0; background:none; font-size:1.1rem; cursor:pointer; color:var(--muted); }
  .artifact { display:inline-block; margin:.25rem .5rem .25rem 0; }
  dl.meta { display:grid; grid-template-columns:auto 1fr; gap:.2rem .8rem; font-size:.9rem; }
  dl.meta dt { color:var(--muted); }
  dl.meta dd { margin:0; }
  .empty { color:var(--muted); padding:1rem; }
</style>
</head>
<body>
<header>
  <h1>Aja</h1><span class="sub" id="sub">job pipeline & chat — everything stays on this machine</span>
</header>
<main>
  <section class="card" id="prefs">
    <h2>Preferences the agent will ask about</h2>
    <div class="row" id="prefsRow"><span class="empty">all set ✓</span></div>
  </section>
  <section class="card">
    <h2>Pipeline</h2>
    <div id="board"><div class="empty">loading…</div></div>
  </section>
  <section class="card">
    <h2>Chat with Aja</h2>
    <div id="chatlog"></div>
    <form id="composer"><input id="say" placeholder="type a message; Enter sends" autocomplete="off"><button>Send</button></form>
  </section>
</main>
<div id="overlay"><div class="sheet"><button class="close" onclick="closeSheet()">✕</button><div id="sheetBody"></div></div></div>
<script>
const $ = (s) => document.querySelector(s);
let lastId = 0;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c]));

async function jget(u){ return (await fetch(u)).json(); }
async function jpost(u, body){ return (await fetch(u, {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify(body)})).json(); }

function scoreBadge(score, grade){
  if (score === null || score === undefined) return "";
  return '<span class="score ' + esc(grade||"") + '">' + esc(score) + '</span>';
}

async function refreshPrefs(){
  const state = await jget("/api/state");
  // keys are normalized ("candidatename"); greet the candidate by first name
  const nameRec = (state.preferences||[]).find((p) => p.key === "candidatename");
  if (nameRec && nameRec.value) $("#sub").textContent = String(nameRec.value) + " — job pipeline & chat — everything stays on this machine";
  const row = $("#prefsRow");
  const missing = state.missingPreferences || [];
  if (!missing.length){ row.innerHTML = '<span class="empty">all set ✓ — the agent reads these before hunting</span>'; return; }
  row.innerHTML = missing.map((k) =>
    '<span class="chip">' + esc(k) +
    '<form data-key="' + esc(k) + '"><input name="v" placeholder="your preference"><button>save</button></form></span>'
  ).join("");
  row.querySelectorAll("form").forEach((f) => f.addEventListener("submit", async (e) => {
    e.preventDefault();
    await jpost("/api/prefs", { key: f.dataset.key, value: f.querySelector("input").value });
    refreshPrefs();
  }));
}

const STATUS_ORDER = ["discovered","matched","tailoring","ready","submitted","interviewing","offer","rejected","closed"];
// appId → outreach messages linked to that application (from /api/state)
let outreachByApp = {};
// Discard shows only before real work attaches — after tailoring, closing a
// card is a conversation with Aja, not a button.
const DISCARDABLE = ["discovered", "matched"];

function refBadge(appId){
  const msgs = outreachByApp[appId] || [];
  const refs = msgs.filter((m) => m.targetRole === "referrer");
  if (refs.length) return '<span class="ref yes" title="referral outreach sent to ' + refs.length + ' people">refs ' + refs.length + '</span>';
  if (msgs.length) return '<span class="ref no" title="outreach sent, but no referral yet">no ref</span>';
  return '<span class="ref" title="no outreach logged for this application yet">no ref</span>';
}

function discardBtn(a){
  if (!DISCARDABLE.includes(a.status)) return "";
  return '<button class="discard" data-id="' + esc(a.id) + '" title="not interested — moves this role to Closed" onclick="event.stopPropagation()">✕</button>';
}

async function refreshBoard(){
  const state = await jget("/api/state");
  outreachByApp = {};
  for (const m of (state.outreach||[])) {
    if (!m.appId) continue;
    (outreachByApp[m.appId] = outreachByApp[m.appId] || []).push(m);
  }
  const board = state.pipeline || {};
  const html = STATUS_ORDER.filter((s) => (board[s]||[]).length).map((s) =>
    '<div class="status"><h3>' + esc(s) + '</h3>' +
    board[s].map((a) =>
      '<div class="job" data-id="' + esc(a.id) + '" data-job="' + esc(a.jobId) + '" onclick="openApp(\\'' + esc(a.id) + '\\')">' +
      scoreBadge(a.matchScore) +
      discardBtn(a) +
      refBadge(a.id) +
      '<div class="t">' + esc(a.company) + '</div>' +
      '<div class="c">' + esc(a.title) +
      (a.jobUrl ? ' <a class="req" target="_blank" rel="noopener" href="' + esc(a.jobUrl) + '" onclick="event.stopPropagation()" title="open the requisition page">req ↗</a>' : '') +
      '</div></div>'
    ).join("") + '</div>'
  ).join("");
  $("#board").innerHTML = html || '<div class="empty">no applications yet — ask Aja to find jobs</div>';
  $("#board").querySelectorAll("button.discard").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Discard this role? The card moves to Closed (a fresh application can be opened later for the same job).")) return;
    await jpost("/api/discard", { id: b.dataset.id });
    refreshBoard();
  }));
}

async function openApp(id){
  const app = await jget("/api/application/" + id);
  const job = app.job || {};
  const arts = Object.entries(app.artifacts || {}).filter(([,p]) => p)
    .map(([k,p]) => '<a class="artifact btn" target="_blank" href="/api/artifact?path=' + encodeURIComponent(p) + '">open ' + esc(k) + '</a>').join("");
  const evidence = (app.evidence||[]).map((e) =>
    '<a class="artifact btn" style="background:#dd6b20" target="_blank" href="/api/artifact?path=' + encodeURIComponent(e.path) + '" title="' + esc(e.at) + '">' + esc(e.kind) + '</a>'
  ).join("");
  const outreach = (app.outreach||[]);
  const outreachHtml = outreach.length
    ? '<h4>Outreach</h4><ul class="outreach">' + outreach.map((m) =>
        '<li><strong>' + esc(m.target) + '</strong> · ' + esc(m.targetRole) + ' · ' + esc(m.channel) +
        ' · <span class="ostate ' + esc(m.state) + '">' + esc(m.state) + '</span>' +
        ' · sent ' + esc(String(m.sentAt).slice(0, 10)) +
        (m.note ? ' — ' + esc(m.note) : '') + '</li>'
      ).join("") + '</ul>'
    : '<p class="empty">no outreach or referral logged for this application yet</p>';
  $("#sheetBody").innerHTML =
    '<h3>' + esc(job.company||"?") + ' — ' + esc(job.title||"?") + '</h3>' +
    '<dl class="meta">' +
    '<dt>status</dt><dd>' + esc(app.status) + '</dd>' +
    '<dt>match</dt><dd>' + (app.matchScore ?? job.matchScore ?? "not scored") + '</dd>' +
    '<dt>posting</dt><dd>' + (job.url
      ? '<a target="_blank" rel="noopener" href="' + esc(job.url) + '">open requisition ↗</a>'
      : '-') + '</dd>' +
    '<dt>resume source</dt><dd>' + esc(app.resumeRef || "-") + '</dd>' +
    '<dt>submitted</dt><dd>' + (app.submittedAt
      ? esc(app.submittedAt) + (app.submissionPortal ? ' via ' + esc(app.submissionPortal) : '') + (app.submissionConfirmation ? ' · conf ' + esc(app.submissionConfirmation) : '')
      : 'not yet') + '</dd>' +
    '</dl>' +
    (evidence ? '<h4>Evidence</h4>' + evidence : '') +
    outreachHtml +
    (arts ? '<h4>Artifacts</h4>' + arts : '<p class="empty">no artifacts yet</p>') +
    '<h4>Job description</h4><pre style="white-space:pre-wrap">' + esc(job.description||"") + '</pre>';
  $("#overlay").classList.add("open");
}
async function rescore(jobId){
  await jpost("/api/match", { jobId });
  closeSheet(); refreshBoard();
}
function closeSheet(){ $("#overlay").classList.remove("open"); }

function bubble(m){
  const div = document.createElement("div");
  div.className = "bubble " + m.from;
  div.innerHTML = '<span class="who">' + m.from + '</span>' + esc(m.text);
  return div;
}
async function refreshChat(){
  const msgs = await jget("/api/chat?since=" + lastId);
  const log = $("#chatlog");
  for (const m of msgs){ log.appendChild(bubble(m)); lastId = Math.max(lastId, m.id); }
  if (msgs.length) log.scrollTop = log.scrollHeight;
}

$("#composer").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("#say");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  await jpost("/api/chat", { text });
  refreshChat();
});

refreshPrefs(); refreshBoard(); refreshChat();
setInterval(refreshChat, 2000);
setInterval(refreshBoard, 10000);
</script>
</body>
</html>
`;
