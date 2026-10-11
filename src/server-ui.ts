/**
 * The review UI, embedded as one string so the server has zero static-file
 * plumbing. Vanilla JS: polls the chat queue every 2s, renders the pipeline
 * board, and surfaces missing preferences as inline forms — the "ask me and
 * remember it" loop, human side.
 *
 * Design: the "Local Job Application Cockpit" direction — a dark, dense
 * operator surface with an icon rail, an oversized needs-you count borrowed
 * from the triage direction, kanban lanes, and chat on the right. Every
 * affordance here maps to something the toolbelt already exposes; the rail's
 * Learn and Settings entries are deliberately inert, because those run in the
 * CLI and have no API surface to back a view.
 */
import { linkifyChatHtml } from "./services/linkify.ts";

export const UI_HTML = `<!doctype html>
<html lang="en" data-theme="cockpit">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Aja — job pipeline &amp; chat</title>
<style>
  :root {
    color-scheme: dark;
    --canvas:#0d1117; --surface:#161b22; --raised:#21262d; --line:#30363d;
    --ink:#f0f6fc; --muted:#8b949e; --dim:#6e7681;
    --amber:#f59e0b; --amber-hi:#fbbf24; --amber-dim:#d97706;
    --emerald:#10b981; --rose:#ef4444;
    --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin:0; background:var(--canvas); color:var(--ink);
    font:13px/1.5 var(--sans);
    font-variant-numeric: tabular-nums;
    -webkit-font-smoothing: antialiased;
  }
  *, *::before, *::after { min-width: 0; }
  p, h1, h2, h3, h4, li, dd, dt, td, th, span, label, button, kbd, pre, a {
    overflow-wrap: anywhere;
  }
  img, svg { max-width: 100%; height: auto; }
  a { color: var(--amber-hi); }
  button { font: inherit; }
  .mono { font-family: var(--mono); }
  kbd {
    font:11px/1 var(--mono); background:var(--surface); border:1px solid var(--line);
    color:var(--muted); border-radius:3px; padding:3px 5px;
  }
  ::-webkit-scrollbar { width:10px; height:10px; }
  ::-webkit-scrollbar-thumb { background:#30363d; border-radius:5px; }
  ::-webkit-scrollbar-track { background:transparent; }

  /* ---------- shell ---------- */
  .shell {
    display:grid; grid-template-columns: 64px minmax(0,1fr) 360px;
    height: calc(100vh - 44px - 37px);
  }
  @media (max-width: 1100px) {
    .shell { grid-template-columns: 56px minmax(0,1fr) 300px; }
  }
  @media (max-width: 860px) {
    .shell { grid-template-columns: 56px minmax(0,1fr); grid-template-rows: minmax(0,1fr) 45vh; }
    .chatpane { grid-column: 2; border-left:0; border-top:1px solid var(--line); }
  }

  /* ---------- icon rail ---------- */
  .rail {
    background:var(--surface); border-right:1px solid var(--line);
    display:flex; flex-direction:column; align-items:center;
    padding:.6rem 0; gap:.25rem;
  }
  .rail .mark {
    width:32px; height:32px; border-radius:7px; background:var(--amber);
    color:#0d1117; font-weight:800; font-size:15px;
    display:grid; place-items:center; margin-bottom:.6rem; flex:none;
  }
  .rail button {
    position:relative;
    width:42px; height:42px; border-radius:8px; border:1px solid transparent;
    background:none; color:var(--muted); cursor:pointer;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    gap:1px; padding:0;
  }
  .rail button svg { width:17px; height:17px; stroke:currentColor; fill:none;
    stroke-width:1.7; stroke-linecap:round; stroke-linejoin:round; }
  .rail button span { font-size:9px; letter-spacing:.02em; }
  .rail button:hover:not([disabled]) { background:var(--raised); color:var(--ink); }
  .rail button[aria-current="page"] { background:var(--raised); border-color:var(--line); color:var(--amber-hi); }
  .rail button[disabled] { opacity:.34; cursor:not-allowed; }
  .rail .spacer { flex:1; }
  .rail .count {
    position:absolute; top:6px; right:4px; transform:none;
    background:var(--amber); color:#0d1117; border-radius:999px;
    font:10px/1 var(--mono); padding:2px 4px; pointer-events:none;
  }

  /* ---------- topbar ---------- */
  .topbar {
    height:44px; display:flex; align-items:center; gap:.8rem;
    padding:0 .9rem; background:var(--surface); border-bottom:1px solid var(--line);
  }

  /* ---------- view bar (filters + sorting) ---------- */
  .viewbar {
    display:flex; align-items:center; gap:.7rem; flex-wrap:wrap;
    padding:.4rem .9rem; background:var(--surface); border-bottom:1px solid var(--line);
  }
  .viewbar label { display:flex; align-items:center; gap:.35rem; font:10px/1 var(--mono);
    text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
  .viewbar select {
    background:var(--canvas); border:1px solid var(--line); color:var(--ink);
    border-radius:6px; padding:5px 7px; font-size:12px; outline:none; max-width:170px;
  }
  .viewbar select:focus { border-color:var(--amber); }
  .viewbar input[type=range] { width:110px; accent-color:var(--amber); }
  .viewbar .scoreval { font:12px/1 var(--mono); color:var(--ink); min-width:2.2rem; }
  .viewbar .floorhint { font:11px/1.3 var(--sans); color:var(--dim); }
  .viewbar .reset {
    background:none; border:1px solid var(--line); color:var(--muted);
    border-radius:6px; cursor:pointer; padding:5px 8px; font-size:11px;
  }
  .viewbar .reset:hover { color:var(--ink); border-color:var(--amber); }
  .viewbar .spacer { flex:1; }
  @media (max-width: 900px) { .viewbar { gap:.45rem; } .viewbar .floorhint { display:none; } }
  .topbar .who { font-weight:600; font-size:13px; }
  .topbar .where { color:var(--dim); font-size:12px; }
  .topbar .stat {
    display:flex; align-items:center; gap:.3rem; font:11px/1 var(--mono);
    color:var(--muted); white-space:nowrap;
  }
  .topbar .stat b { color:var(--ink); font-weight:600; }
  .dot { width:6px; height:6px; border-radius:50%; background:var(--emerald); flex:none; }
  .topbar .search { margin-left:auto; display:flex; align-items:center; gap:.4rem; }
  .topbar input[type=search] {
    width:230px; background:var(--canvas); border:1px solid var(--line); border-radius:7px;
    color:var(--ink); font:12px/1 var(--sans); padding:7px 9px; outline:none;
  }
  .topbar input[type=search]:focus { border-color:var(--amber); }
  .topbar input[type=search]::placeholder { color:var(--dim); }
  .topbar .clear {
    background:var(--raised); border:1px solid var(--line); color:var(--muted);
    border-radius:7px; cursor:pointer; padding:6px 8px; font-size:11px;
  }
  @media (max-width: 780px) { .topbar .where { display:none; } .topbar input[type=search] { width:150px; } }

  /* ---------- main pane ---------- */
  .pane { overflow-y:auto; padding:1.1rem 1.2rem 2rem; }

  .triage { margin-bottom:1.3rem; }
  .triage .bigcount {
    margin:0; font-size:clamp(28px, 4.4vw, 46px); line-height:1.05;
    letter-spacing:-.025em; font-weight:700;
  }
  .triage .bigcount.zero { color:var(--emerald); }
  .triage .subline { margin:.3rem 0 .9rem; color:var(--muted); font-size:13px; }
  .needcards { display:grid; grid-template-columns:repeat(auto-fit,minmax(280px,1fr)); gap:.7rem; }
  .needcard {
    background:var(--surface); border:1px solid var(--line); border-radius:9px;
    padding:.7rem .8rem; display:flex; flex-direction:column; gap:.3rem;
    border-left-width:3px; text-align:left; cursor:pointer; width:100%;
    color:inherit; font:inherit;
  }
  .needcard:hover { background:var(--raised); }
  .needcard.overdue { border-left-color:var(--rose); }
  .needcard.followup { border-left-color:var(--amber); }
  .needcard.staged { border-left-color:var(--emerald); }
  .needcard .top { display:flex; align-items:center; gap:.45rem; }
  .needcard .kind {
    font:10px/1 var(--mono); text-transform:uppercase; letter-spacing:.07em; color:var(--muted);
  }
  .needcard kbd { margin-left:auto; }
  .needcard .title { font-weight:600; font-size:13px; }
  .needcard .meta { color:var(--muted); font-size:12px; }

  .panelhead {
    display:flex; align-items:baseline; gap:.6rem; flex-wrap:wrap;
    border-bottom:1px solid var(--line); padding-bottom:.5rem; margin-bottom:.8rem;
  }
  .panelhead h2 {
    margin:0; font:600 11px/1 var(--mono); text-transform:uppercase;
    letter-spacing:.1em; color:var(--muted);
  }
  .panelhead .hint { color:var(--dim); font-size:12px; }
  .panelhead .count { font:11px/1 var(--mono); color:var(--muted); }

  /* ---------- kanban ---------- */
  .lanes { display:grid; grid-auto-flow:column; grid-auto-columns:minmax(238px,1fr);
    gap:.7rem; align-items:start; overflow-x:auto; padding-bottom:.5rem; }
  .lane { background:var(--surface); border:1px solid var(--line); border-radius:9px; }
  .lane > h3 {
    margin:0; padding:.5rem .65rem; border-bottom:1px solid var(--line);
    font:600 10px/1.4 var(--mono); text-transform:uppercase; letter-spacing:.09em;
    color:var(--muted); display:flex; align-items:center; gap:.4rem;
  }
  .lane > h3 .n {
    margin-left:auto; background:var(--raised); border:1px solid var(--line);
    border-radius:4px; padding:.1rem .3rem; color:var(--ink); font-size:10px;
  }
  .lane .cards { padding:.5rem; display:flex; flex-direction:column; gap:.4rem; }

  .card {
    background:var(--raised); border:1px solid var(--line); border-radius:7px;
    padding:.55rem .6rem; cursor:pointer; display:flex; flex-direction:column; gap:.35rem;
  }
  .card:hover { border-color:var(--amber); }
  .card .co { color:var(--muted); font-size:11px; font-weight:600; }
  .card .role { font-size:13px; font-weight:500; }
  .card .tags { display:flex; align-items:center; gap:.3rem; flex-wrap:wrap; }
  .card .spacer { flex:1; }

  .pill {
    font:10px/1 var(--mono); border-radius:4px; padding:.28rem .4rem;
    border:1px solid var(--line); color:var(--muted); background:var(--surface);
    display:inline-flex; align-items:center; gap:.25rem;
  }
  .pill.match.good { color:var(--emerald); border-color:rgba(16,185,129,.4); background:rgba(16,185,129,.1); }
  .pill.match.mid { color:var(--amber-hi); border-color:rgba(245,158,11,.4); background:rgba(245,158,11,.1); }
  .pill.match.low { color:var(--rose); border-color:rgba(239,68,68,.4); background:rgba(239,68,68,.1); }
  .pill.pursuit.green { color:var(--emerald); border-color:rgba(16,185,129,.4); background:rgba(16,185,129,.1); }
  .pill.pursuit.amber { color:var(--amber-hi); border-color:rgba(245,158,11,.4); background:rgba(245,158,11,.1); }
  .pill.pursuit.red { color:var(--rose); border-color:rgba(239,68,68,.4); background:rgba(239,68,68,.1); }
  .pill.pay { color:var(--ink); border-color:rgba(139,148,158,.45); background:rgba(139,148,158,.12); }
  .pill.pay.sourced { color:var(--amber-hi); border-color:rgba(245,158,11,.4); background:rgba(245,158,11,.1); }
  .pill.pay.none { color:var(--dim); border-style:dashed; }
  .pill.pay.below { color:var(--rose); border-color:rgba(239,68,68,.45); background:rgba(239,68,68,.1); }
  .req { font:10px/1 var(--mono); color:var(--amber-hi); text-decoration:none;
    border:1px solid var(--line); border-radius:4px; padding:.28rem .4rem; }
  .req:hover { border-color:var(--amber); }
  .discard {
    border:1px solid var(--line); background:none; color:var(--dim);
    border-radius:4px; width:19px; height:19px; font-size:10px; line-height:1;
    cursor:pointer; padding:0; flex:none;
  }
  .discard:hover { border-color:var(--rose); color:var(--rose); }

  /* ---------- actions view ---------- */
  .actgrp { margin-bottom:1rem; }
  .actgrp h3 { margin:0 0 .4rem; font:600 11px/1 var(--mono); text-transform:uppercase;
    letter-spacing:.08em; color:var(--muted); }
  .actgrp ul { margin:0; padding:0; list-style:none; }
  .actgrp li {
    background:var(--surface); border:1px solid var(--line); border-radius:7px;
    padding:.5rem .65rem; margin-bottom:.35rem; display:flex; gap:.6rem; align-items:baseline;
  }
  .actgrp .when { color:var(--dim); font-size:11px; font-family:var(--mono); margin-left:auto; white-space:nowrap; }
  .actgrp .overdue { color:var(--rose); font-weight:600; }
  .applink { background:none; border:0; color:var(--amber-hi); font:11px/1 var(--mono);
    cursor:pointer; padding:0; text-decoration:underline; }

  /* ---------- preferences ---------- */
  .prefs { margin-top:1.4rem; border-top:1px solid var(--line); padding-top:.8rem; }
  .prefs .row { display:flex; flex-wrap:wrap; gap:.4rem; align-items:center; margin-top:.5rem; }
  .chip {
    display:inline-flex; gap:.4rem; align-items:center;
    background:rgba(245,158,11,.07); border:1px solid rgba(245,158,11,.3);
    border-radius:999px; padding:.2rem .3rem .2rem .65rem; font-size:12px;
  }
  .chip .k { font-family:var(--mono); font-size:11px; color:var(--amber-hi); }
  .chip form { display:inline-flex; gap:.3rem; }
  .chip input {
    border:1px solid var(--line); background:var(--canvas); color:var(--ink);
    border-radius:999px; padding:.2rem .55rem; font-size:12px; min-width:8rem; outline:none;
  }
  .chip input:focus { border-color:var(--amber); }
  .chip button {
    border:0; background:var(--amber); color:#0d1117; border-radius:999px;
    padding:.2rem .65rem; font-size:12px; font-weight:600; cursor:pointer;
  }

  /* ---------- chat ---------- */
  .chatpane {
    background:var(--surface); border-left:1px solid var(--line);
    display:flex; flex-direction:column; min-height:0;
  }
  .chatpane > header {
    display:flex; align-items:baseline; gap:.5rem; padding:.6rem .8rem;
    border-bottom:1px solid var(--line); flex:none;
  }
  .chatpane > header h2 { margin:0; font-size:13px; font-weight:600; }
  .chatpane > header .sub { color:var(--dim); font-size:11px; }
  #chatlog { flex:1; overflow-y:auto; padding:.7rem .8rem; display:flex;
    flex-direction:column; gap:.45rem; min-height:0; }
  .bubble {
    max-width:92%; padding:.5rem .65rem; border-radius:8px;
    white-space:pre-wrap; border:1px solid var(--line); font-size:13px;
  }
  .bubble.user { align-self:flex-end; background:var(--raised); border-bottom-right-radius:2px; }
  .bubble.agent { align-self:flex-start; background:var(--canvas); border-bottom-left-radius:2px; color:#c9d1d9; }
  .bubble .who { display:block; font:10px/1.4 var(--mono); color:var(--dim); margin-bottom:.15rem;
    text-transform:uppercase; letter-spacing:.06em; }
  #composer { display:flex; border-top:1px solid var(--line); flex:none; }
  #composer input { flex:1; border:0; background:none; color:var(--ink);
    padding:.7rem .8rem; font:inherit; outline:none; min-width:0; }
  #composer input::placeholder { color:var(--dim); }
  #composer button { border:0; background:var(--amber); color:#0d1117; font-weight:600;
    padding:0 1rem; cursor:pointer; }

  /* ---------- application sheet ---------- */
  #overlay { position:fixed; inset:0; background:rgba(1,4,9,.72); display:none;
    align-items:center; justify-content:center; padding:2vh 1rem; z-index:40; }
  #overlay.open { display:flex; }
  #overlay .sheet {
    background:var(--surface); border:1px solid var(--line); border-radius:12px;
    max-width:760px; width:100%; max-height:92vh; overflow:auto; padding:1.1rem 1.3rem;
    box-shadow:0 12px 40px rgba(0,0,0,.6);
  }
  #overlay h3 { margin:.1rem 0 .7rem; font-size:1.05rem; }
  #overlay h4 { margin:1.1rem 0 .4rem; font:600 11px/1 var(--mono);
    text-transform:uppercase; letter-spacing:.08em; color:var(--muted); }
  #overlay .close { float:right; border:0; background:none; font-size:1.1rem;
    cursor:pointer; color:var(--muted); padding:0 .2rem; }
  #overlay .close:hover { color:var(--ink); }
  #overlay pre {
    white-space:pre-wrap; color:#c9d1d9; background:var(--canvas);
    border:1px solid var(--line); border-radius:7px; padding:.6rem; font-size:12px;
    max-height:280px; overflow:auto;
  }
  .artifact {
    display:inline-block; margin:0 .4rem .4rem 0; border:1px solid var(--line);
    background:var(--raised); color:var(--ink); border-radius:7px; padding:.35rem .6rem;
    font-size:12px; text-decoration:none;
  }
  .artifact:hover { border-color:var(--amber); }
  .artifact.evidence { border-color:rgba(217,119,6,.5); color:var(--amber-hi); }
  dl.meta { display:grid; grid-template-columns:auto minmax(0,1fr); gap:.3rem .9rem; font-size:13px; margin:0; }
  dl.meta dt { color:var(--muted); font:11px/1.5 var(--mono); text-transform:uppercase;
    letter-spacing:.06em; padding-top:.15rem; }
  dl.meta dd { margin:0; }
  ul.outreach { margin:.3rem 0; padding-left:1.1rem; font-size:13px; }
  ul.outreach li { margin:.25rem 0; }
  .ostate.follow-up-due { color:var(--amber-hi); font-weight:600; }
  .ostate.replied { color:var(--emerald); }
  .empty { color:var(--dim); padding:.8rem 0; font-size:13px; }
  .rescore {
    border:1px solid var(--line); background:var(--raised); color:var(--ink);
    border-radius:7px; padding:.35rem .7rem; font-size:12px; cursor:pointer;
  }
  .rescore:hover { border-color:var(--amber); }
  .actgrp.flash { outline:2px solid var(--amber); outline-offset:6px; border-radius:8px; }
</style>
</head>
<body>

<header class="topbar">
  <span class="who" id="who">Aja</span>
  <span class="where" id="where">job pipeline &amp; chat — everything stays on this machine</span>
  <span class="stat" id="counts"><span class="dot"></span> <b>0</b> active</span>
  <div class="search">
    <input type="search" id="boardSearch" autocomplete="off" spellcheck="false"
      placeholder="filter the board — company, role, req id…" aria-label="Filter the board">
    <button class="clear" id="boardSearchClear" title="Clear the filter" style="display:none">✕</button>
  </div>
</header>

<div class="viewbar" role="group" aria-label="Filter and sort the board">
  <label>min score
    <input type="range" id="minScore" min="0" max="100" step="5" value="0"
      aria-label="Hide cards scoring below this">
    <span class="scoreval" id="minScoreVal">any</span>
  </label>
  <label>verdict
    <select id="pursuit" aria-label="Filter by pursuit verdict">
      <option value="">any</option>
      <option value="green">green — push</option>
      <option value="amber">amber — referral only</option>
      <option value="red">red — skip</option>
      <option value="none">no verdict yet</option>
    </select>
  </label>
  <label>stage
    <select id="stages" aria-label="Which stages to show">
      <option value="">all stages</option>
      <option value="discovered,matched,tailoring,ready">backlog — not sent</option>
      <option value="discovered,matched,tailoring,ready,submitted">in flight</option>
      <option value="submitted,interviewing,offer">sent — waiting on them</option>
      <option value="interviewing,offer">interviewing or offer</option>
      <option value="closed,rejected">closed and rejected</option>
    </select>
  </label>
  <label>pay
    <select id="payFilter" aria-label="Filter by pay figure">
      <option value="">any</option>
      <option value="with">has a figure</option>
      <option value="without">no figure on file</option>
      <option value="below-floor">below my floor</option>
    </select>
  </label>
  <label>sort
    <select id="sortBy" aria-label="Order cards inside each lane">
      <option value="recent">most recent first</option>
      <option value="score">highest match first</option>
      <option value="company">company A–Z</option>
      <option value="pay">highest pay first</option>
    </select>
  </label>
  <button class="reset" id="viewReset" title="Clear every filter and go back to the default order">reset</button>
  <span class="spacer"></span>
  <span class="floorhint" id="floorHint"></span>
</div>

<div class="shell">
  <nav class="rail" aria-label="Sections">
    <div class="mark" aria-hidden="true">A</div>
    <button id="navBoard" aria-current="page" title="Pipeline board">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="10" y="4" width="5" height="10" rx="1"/><rect x="17" y="4" width="4" height="14" rx="1"/></svg>
      <span>Board</span>
    </button>
    <button id="navActions" title="Every decision that needs you">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
      <span>Actions</span>
      <span class="count" id="railCount" style="display:none">0</span>
    </button>
    <button id="navChat" title="Jump to the chat">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.2A8.4 8.4 0 0 1 4 11.5a8.5 8.5 0 0 1 8.5-8.4h.5a8.5 8.5 0 0 1 8 8.4z"/></svg>
      <span>Chat</span>
    </button>
    <button disabled title="'learn' runs in the CLI — it reads your verdicts and outcomes. No view yet.">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg>
      <span>Learn</span>
    </button>
    <button disabled title="Settings live in applymate.config.json — no view yet.">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 7 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 15a1.6 1.6 0 0 0-1.5-1H1a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 3 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 9 3V1a2 2 0 1 1 4 0v.1A1.6 1.6 0 0 0 15 3a1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 21 9h.1a2 2 0 1 1 0 4H21a1.6 1.6 0 0 0-1.6 2z"/></svg>
      <span>Setup</span>
    </button>
    <div class="spacer"></div>
    <button id="navStatus" title="Everything stays on this machine" style="cursor:default">
      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></svg>
      <span>Local</span>
    </button>
  </nav>

  <main class="pane" id="pane">

    <!-- Board view -->
    <div id="viewBoard">
      <section class="triage">
        <h1 class="bigcount" id="bigcount">—</h1>
        <p class="subline" id="subline">loading…</p>
        <div class="needcards" id="needcards"></div>
      </section>

      <section>
        <div class="panelhead">
          <h2>Pipeline</h2>
          <span class="count" id="boardCount"></span>
          <span class="hint">click a card for the full application · ✕ discards</span>
        </div>
        <div class="lanes" id="board"><div class="empty">loading…</div></div>
      </section>

      <section class="prefs">
        <div class="panelhead" style="margin-bottom:0">
          <h2>Preferences the agent will ask about</h2>
        </div>
        <div class="row" id="prefsRow"><span class="empty">all set ✓</span></div>
      </section>
    </div>

    <!-- Actions view -->
    <div id="viewActions" style="display:none">
      <section class="triage">
        <h1 class="bigcount" id="actionsCount">—</h1>
        <p class="subline" id="actionsSubline">every dated decision and follow-up, unabridged</p>
      </section>
      <div id="actionsBody"></div>
    </div>

  </main>

  <aside class="chatpane">
    <header>
      <h2>Chat with Aja</h2>
      <span class="sub">the agent's other side</span>
    </header>
    <div id="chatlog"></div>
    <form id="composer">
      <input id="say" placeholder="type a message; Enter sends" autocomplete="off">
      <button>Send</button>
    </form>
  </aside>
</div>

<div id="overlay"><div class="sheet">
  <button class="close" onclick="closeSheet()" aria-label="Close">✕</button>
  <div id="sheetBody"></div>
</div></div>

<script>
const $ = (s) => document.querySelector(s);
let lastId = 0;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"\\""}[c]));

// Injected from src/services/linkify.ts — chat text turns into links there
// (URLs, workspace file paths, known application ids). The source is embedded
// verbatim, so that module must stay free of backticks, template-literal
// syntax, and script-closing markup. test/linkify.test.ts enforces it.
${linkifyChatHtml}

// The application ids the board currently knows: chat mentions of an id only
// become an open-button when the board can actually open it. Rebuilt on every
// board fetch; when the set grows, the chat log is redrawn once so mentions
// that rendered as plain text (the board had not caught up yet) become their
// buttons too.
let knownApps = {};
let appsSig = "";
let redrawChat = false;
let chatMsgs = [];

async function jget(u){ return (await fetch(u)).json(); }
async function jpost(u, body){ return (await fetch(u, {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify(body)})).json(); }

// The match grade maps to the pill palette: strong fits read emerald, borderline
// amber, and anything under the relevance floor rose.
function scoreClass(grade){
  if (grade === "strong" || grade === "good") return "good";
  if (grade === "fair") return "mid";
  if (grade === "stretch") return "low";
  return "";
}
function scoreBadge(score, grade){
  if (score === null || score === undefined) return "";
  return '<span class="pill match ' + scoreClass(grade||"") + '">' + esc(score) + " match</span>";
}

// Aja's conversion-odds verdict: green = push, amber = only with a referral, red = skip.
const PURSUIT_LEGEND = "green: push · amber: only with a warm referral · red: skip";
function pursuitBadge(p){
  if (!p || !p.verdict) return "";
  const tip = PURSUIT_LEGEND + (p.note ? " — " + p.note : "");
  return '<span class="pill pursuit ' + esc(p.verdict) + '" title="' + esc(tip) + '">' + esc(p.verdict) + "</span>";
}

function refBadge(appId){
  const msgs = outreachByApp[appId] || [];
  // Silence renders nothing: a "no ref" pill on every card nobody has been
  // messaged about yet is noise — the badge exists to flag referral motion,
  // not to stamp 300 identical non-facts across the board.
  if (!msgs.length) return "";
  const refs = msgs.filter((m) => m.targetRole === "referrer");
  if (refs.length) return '<span class="pill" title="referral outreach sent to ' + refs.length + ' people">refs ' + refs.length + "</span>";
  return '<span class="pill match mid" title="outreach sent, but no referral yet">no ref</span>';
}

// The pay pill. A figure is only ever shown when one was recorded from a real
// source (the server formats and compares it, so this page cannot drift from
// the CLI); "no pay figure on file" is a deliberate state — never a guess, and
// never the candidate's floor standing in for the posting's own number.
function payPill(a){
  const p = a.pay || { label: "no pay figure", title: "no pay figure on file", verdict: "none", basis: null };
  const cls = p.verdict === "below" ? "below" : p.basis ? "sourced" : "none";
  const tag = p.basis ? (p.basis === "posted" ? "posted" : p.basis === "stated" ? "stated" : "sourced") : "";
  return '<span class="pill pay ' + cls + '" title="' + esc(p.title) + '">' +
    esc(p.label) + (tag ? " " + tag : "") + "</span>";
}

function discardBtn(a){
  if (!DISCARDABLE.includes(a.status)) return "";
  return '<button class="discard" data-id="' + esc(a.id) + '" title="not interested — moves this role to Closed" onclick="event.stopPropagation()">✕</button>';
}

// The board as the candidate asked to see it. Filters and sort live here and in
// localStorage, so the 10s auto-refresh keeps the view and a reload keeps it
// too. Every value maps to a /api/state parameter — the server does the work.
const STAGE_PRESETS = {
  "": null,
  "discovered,matched,tailoring,ready": "discovered,matched,tailoring,ready",
  "discovered,matched,tailoring,ready,submitted": "discovered,matched,tailoring,ready,submitted",
  "submitted,interviewing,offer": "submitted,interviewing,offer",
  "interviewing,offer": "interviewing,offer",
  "closed,rejected": "closed,rejected",
};

const DEFAULT_VIEW = { q: "", minScore: 0, pursuit: "", stages: "", pay: "", sort: "recent" };

function loadView() {
  try {
    const saved = JSON.parse(localStorage.getItem("boardView") || "{}");
    return Object.assign({}, DEFAULT_VIEW, saved);
  } catch {
    return Object.assign({}, DEFAULT_VIEW);
  }
}

let view = loadView();

function viewParams() {
  const p = new URLSearchParams();
  if (view.q) p.set("q", view.q);
  if (view.minScore > 0) p.set("minScore", String(view.minScore));
  if (view.pursuit) p.set("pursuit", view.pursuit);
  const stages = STAGE_PRESETS[view.stages];
  if (stages) p.set("status", stages);
  if (view.pay) p.set("pay", view.pay);
  if (view.sort && view.sort !== "recent") p.set("sort", view.sort);
  const s = p.toString();
  return s ? "?" + s : "";
}

function applyView() {
  try { localStorage.setItem("boardView", JSON.stringify(view)); } catch {}
  $("#boardSearch").value = view.q;
  $("#minScore").value = String(view.minScore);
  $("#minScoreVal").textContent = view.minScore > 0 ? view.minScore + "+" : "any";
  $("#pursuit").value = view.pursuit;
  $("#stages").value = view.stages;
  $("#payFilter").value = view.pay;
  $("#sortBy").value = view.sort;
  $("#boardSearchClear").style.display = view.q ? "" : "none";
}

// Guards against out-of-order renders: a slow unfiltered fetch (initial load,
// auto-refresh tick) must never overwrite a newer filtered one.
let boardFetch = 0;

// The candidate's own floor, as the server read it (null when unset/unreadable).
let floorInfo = null;

// Board-wide tally for the topbar. Never derived from a filtered fetch — a
// filter narrows the board, it does not shrink the board.
let boardTotals = null;

async function refreshPrefs(){
  const state = await jget("/api/state");
  // keys are normalized ("candidatename"); greet the candidate by first name
  const nameRec = (state.preferences||[]).find((p) => p.key === "candidatename");
  if (nameRec && nameRec.value) $("#who").textContent = "Aja · " + String(nameRec.value);
  const row = $("#prefsRow");
  const missing = state.missingPreferences || [];
  if (!missing.length){ row.innerHTML = '<span class="empty">all set ✓ — the agent reads these before hunting</span>'; return; }
  row.innerHTML = missing.map((k) =>
    '<span class="chip"><span class="k">' + esc(k) +
    '</span><form data-key="' + esc(k) + '"><input name="v" placeholder="your preference"><button>save</button></form></span>'
  ).join("");
  row.querySelectorAll("form").forEach((f) => f.addEventListener("submit", async (e) => {
    e.preventDefault();
    await jpost("/api/prefs", { key: f.dataset.key, value: f.querySelector("input").value });
    refreshPrefs();
  }));
}

// "Needs you now": overdue decisions, due follow-ups, staged submits, and the
// next deadlines — computed server-side from the full board, so a board-search
// filter never hides an action. The big count is the one thing that may not be
// missed; the cards under it carry the detail. Due follow-ups render as one
// batch card (they are one repeated action), the per-person list lives in the
// Actions view.
function appTag(id){
  return ' <button class="applink" data-app="' + esc(id) + '">[' + esc(id) + ']</button>';
}
function bindAppTags(root){
  root.querySelectorAll("button.applink").forEach((b) =>
    b.addEventListener("click", (e) => { e.stopPropagation(); openApp(b.dataset.app); }));
}

function renderTriage(a){
  const dueRem = a.dueReminders || [];
  const dueFu = a.dueFollowUps || [];
  const staged = a.staged || [];
  // Due referral follow-ups are one repeated action, not N decisions: they
  // collapse into a single batch card here, and the Actions view keeps the
  // unabridged list. Without this, one busy outreach day floods the grid with
  // dozens of look-alike cards and buries the decisions that actually need
  // the candidate.
  const fuBatch = dueFu.length ? [{
    kind: "referral follow-ups", cls: "followup", appId: null, jump: "followups",
    title: dueFu.length + " nudges pending",
    meta: "sent " + sentRange(dueFu) + " · one nudge each — full list in Actions",
  }] : [];
  const decisions = dueRem.length + staged.length + fuBatch.length;
  const trueTotal = dueRem.length + dueFu.length + staged.length;

  const big = $("#bigcount");
  big.textContent = decisions
    ? decisions + (decisions === 1 ? " thing needs you" : " things need you")
    : "Nothing is blocking";
  big.classList.toggle("zero", decisions === 0);

  $("#subline").textContent = decisions
    ? dueRem.length + " overdue · " + dueFu.length + " follow-up" + (dueFu.length === 1 ? "" : "s") + " · " + staged.length + " awaiting your yes"
    : "no overdue decisions, no follow-ups due, nothing staged";
  $("#actionsCount").textContent = trueTotal
    ? trueTotal + (trueTotal === 1 ? " item needs you" : " items need you")
    : "Nothing is blocking";
  const upcoming = (a.upcomingReminders || []).length;
  $("#actionsSubline").textContent = trueTotal || upcoming
    ? dueRem.length + " overdue · " + dueFu.length + " follow-ups · " + staged.length + " staged · " + upcoming + " coming up — every item, unabridged"
    : "every dated decision and follow-up, unabridged";

  const railCount = $("#railCount");
  railCount.textContent = decisions;
  railCount.style.display = decisions ? "" : "none";

  const items = [];
  dueRem.forEach((r) => items.push({
    kind: "decisions overdue", cls: "overdue", appId: r.appId || null,
    title: r.title,
    meta: "due " + String(r.dueAt).slice(0, 10) + (r.overdueDays ? " · " + r.overdueDays + "d overdue" : "") + (r.note ? " · " + r.note : ""),
  }));
  items.push(...fuBatch);
  staged.forEach((s) => items.push({
    kind: "staged", cls: "staged", appId: s.id || null,
    title: s.company + " — " + s.title,
    meta: (s.wait && s.wait.detail) || "tailored and staged · waiting on your explicit yes to submit",
  }));

  const cards = $("#needcards");
  cards.innerHTML = items.map((it, i) =>
    '<button class="needcard ' + it.cls + '" data-app="' + esc(it.appId || "") + '"' +
    (it.jump ? ' data-jump="' + esc(it.jump) + '"' : "") +
    (it.appId ? ' title="open the application"'
      : it.jump ? ' title="open the full list in the Actions view"'
      : ' title="no application is linked to this yet"') + ">" +
      '<span class="top"><span class="kind">' + esc(it.kind) + "</span>" +
      (items.length <= 9 ? "<kbd>" + (i + 1) + "</kbd>" : "") + "</span>" +
      '<span class="title">' + esc(it.title) + "</span>" +
      '<span class="meta">' + esc(it.meta) + "</span>" +
    "</button>"
  ).join("");
  cards.querySelectorAll(".needcard").forEach((el) => el.addEventListener("click", () => {
    if (el.dataset.app) openApp(el.dataset.app);
    else if (el.dataset.jump) jumpToGroup(el.dataset.jump);
  }));

  const act = $("#actionsBody");
  if (!trueTotal && !upcoming){
    act.innerHTML = '<p class="empty">nothing needs you — no overdue decisions, no follow-ups due, nothing staged ✓</p>';
    return;
  }
  const group = (heading, rows, id) => rows.length
    ? '<div class="actgrp"' + (id ? ' id="grp-' + id + '"' : "") + "><h3>" + heading + '</h3><ul>' + rows.join("") + "</ul></div>" : "";
  act.innerHTML =
    group("Decisions overdue", dueRem.map((r) =>
      '<li><span><span class="overdue">' + esc(r.title) + "</span>" +
      (r.appId ? appTag(r.appId) : "") + (r.note ? '<br><span style="color:var(--muted)">' + esc(r.note) + "</span>" : "") +
      '</span><span class="when">due ' + esc(String(r.dueAt).slice(0, 10)) +
      (r.overdueDays ? " · " + r.overdueDays + "d overdue" : "") + "</span></li>")) +
    group("Referral follow-ups due (the one nudge) — " + dueFu.length, dueFu.map((m) =>
      "<li><span>" + esc(m.target) + " · " + esc(m.targetRole) +
      (m.appId ? appTag(m.appId) : "") + '</span><span class="when">sent ' + esc(String(m.sentAt).slice(0, 10)) + "</span></li>"), "followups") +
    group("Staged — what each is waiting on", staged.map((s) =>
      '<li' + (s.wait && s.wait.detail ? ' title="' + esc(s.wait.detail) + '"' : "") + '><span>' +
      esc(s.company) + " — " + esc(s.title) + appTag(s.id) +
      '</span><span class="when">' + esc((s.wait && s.wait.label) || "not yet submitted") + "</span></li>")) +
    group("Coming up", (a.upcomingReminders || []).map((r) =>
      "<li><span>" + esc(r.title) + (r.appId ? appTag(r.appId) : "") +
      '</span><span class="when">due ' + esc(String(r.dueAt).slice(0, 10)) + "</span></li>"));
  bindAppTags(act);
}

// "Oct 1" or "Oct 1 – Oct 5" — the span a batch of sends went out in.
function sentRange(msgs){
  const times = msgs.map((m) => Date.parse(m.sentAt)).filter((t) => !Number.isNaN(t)).sort((x, y) => x - y);
  const fmt = (t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (!times.length) return "an unknown date";
  return times[0] === times[times.length - 1] ? fmt(times[0]) : fmt(times[0]) + " – " + fmt(times[times.length - 1]);
}

// The follow-up batch card has no single application behind it — it points at
// the unabridged group in the Actions view instead.
function jumpToGroup(id){
  showView("actions");
  const g = document.getElementById("grp-" + id);
  if (!g) return;
  g.scrollIntoView({ behavior: "smooth", block: "start" });
  g.classList.add("flash");
  setTimeout(() => g.classList.remove("flash"), 1600);
}

const STATUS_ORDER = ["discovered","matched","tailoring","ready","submitted","interviewing","offer","rejected","closed"];
// appId → outreach messages linked to that application (from /api/state)
let outreachByApp = {};
// Discard shows only before real work attaches — after tailoring, closing a
// card is a conversation with Aja, not a button.
const DISCARDABLE = ["discovered", "matched"];

function matchGrade(score){
  if (score === null || score === undefined) return "";
  if (score >= 85) return "strong";
  if (score >= 70) return "good";
  if (score >= 60) return "fair";
  return "stretch";
}

async function refreshBoard(){
  const me = ++boardFetch;
  const state = await jget("/api/state" + viewParams());
  if (me !== boardFetch) return;
  outreachByApp = {};
  for (const m of (state.outreach||[])) {
    if (!m.appId) continue;
    (outreachByApp[m.appId] = outreachByApp[m.appId] || []).push(m);
  }
  // The set of applications the board can open — chat mentions of an id only
  // turn into open-buttons once it is here. A changed set queues one chat-log
  // redraw so earlier plain-text mentions get their buttons.
  const ids = {};
  for (const s of Object.keys(state.pipeline || {}))
    for (const c of (state.pipeline[s] || [])) ids[c.id] = true;
  const sig = Object.keys(ids).sort().join(",");
  if (sig !== appsSig){ appsSig = sig; knownApps = ids; redrawChat = true; }
  renderTriage(state.actions || {});
  floorInfo = state.floor || null;
  $("#floorHint").textContent = floorInfo
    ? "your floor: " + floorInfo.asText
    : "set a salary floor (prefs salaryFloor) and every figure gets compared to it";

  const board = state.pipeline || {};
  let total = 0;
  const html = STATUS_ORDER.filter((s) => (board[s]||[]).length).map((s) => {
    const cards = board[s];
    total += cards.length;
    return '<div class="lane"><h3>' + esc(s) + '<span class="n">' + cards.length + "</span></h3>" +
      '<div class="cards">' + cards.map((a) =>
        '<div class="card" data-id="' + esc(a.id) + '" data-job="' + esc(a.jobId) + '" onclick="openApp(\\'' + esc(a.id) + '\\')">' +
          '<div class="tags">' + scoreBadge(a.matchScore, matchGrade(a.matchScore)) +
            pursuitBadge(a.pursuit) + '<span class="spacer"></span>' + discardBtn(a) + "</div>" +
          '<div class="co">' + esc(a.company) + "</div>" +
          '<div class="role">' + esc(a.title) +
            (a.jobUrl ? ' <a class="req" target="_blank" rel="noopener" href="' + esc(a.jobUrl) +
              '" onclick="event.stopPropagation()" title="open the requisition page">req ↗</a>' : "") +
          "</div>" +
          '<div class="tags">' + payPill(a) + refBadge(a.id) + "</div>" +
        "</div>"
      ).join("") + "</div></div>";
  }).join("");

  const filtered = view.q || view.minScore || view.pursuit || view.stages || view.pay;
  $("#board").innerHTML = html || (filtered
    ? '<div class="empty">no cards match this view — press reset to see the whole board</div>'
    : '<div class="empty">no applications yet — ask Aja to find jobs</div>');
  const meta = state.board || {};
  $("#boardCount").textContent = total
    ? (filtered ? total + " of " + (meta.total ?? total) + " shown" : total + " application" + (total === 1 ? "" : "s"))
    : "";
  // The topbar tally is about the board, not the view, so a board filter must
  // not shrink it. Only an unfiltered fetch can update it; while filtering we
  // keep the last full-board numbers rather than issue a second request a tick.
  if (!filtered){
    boardTotals = {
      active: (board.discovered||[]).length + (board.matched||[]).length + (board.tailoring||[]).length,
      interviewing: (board.interviewing||[]).length + (board.offer||[]).length,
    };
  }
  if (boardTotals){
    $("#counts").innerHTML = '<span class="dot"></span> <b>' + boardTotals.active +
      "</b> active · <b>" + boardTotals.interviewing + "</b> interviewing";
  }

  $("#boardSearchClear").style.display = view.q ? "" : "none";
  $("#board").querySelectorAll("button.discard").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("Discard this role? The card moves to Closed (a fresh application can be opened later for the same job).")) return;
    await jpost("/api/discard", { id: b.dataset.id });
    refreshBoard();
  }));
}

// Typing filters live (debounced); the box lives outside #board so the
// auto-refresh never steals focus mid-search.
let searchTimer = null;
function refreshSoon() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(refreshBoard, 150);
}
$("#boardSearch").addEventListener("input", (e) => {
  view.q = e.target.value.trim();
  refreshSoon();
});
$("#boardSearchClear").addEventListener("click", () => {
  view.q = "";
  applyView();
  refreshBoard();
  $("#boardSearch").focus();
});

$("#minScore").addEventListener("input", (e) => {
  view.minScore = Number(e.target.value);
  $("#minScoreVal").textContent = view.minScore > 0 ? view.minScore + "+" : "any";
  refreshSoon();
});
for (const [id, key] of [["#pursuit", "pursuit"], ["#stages", "stages"], ["#payFilter", "pay"], ["#sortBy", "sort"]]) {
  $(id).addEventListener("change", (e) => {
    view[key] = e.target.value;
    applyView();
    refreshBoard();
  });
}
$("#viewReset").addEventListener("click", () => {
  view = Object.assign({}, DEFAULT_VIEW);
  applyView();
  refreshBoard();
});
applyView();

// 1-9 focus a needs-you card. It opens the application for review — it never
// acts. Nothing on this surface may send, submit, or discard without a click
// on the thing itself.
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const t = e.target;
  if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
  if ($("#overlay").classList.contains("open")) return;
  const n = Number(e.key);
  if (!n || n > 9) return;
  const cards = [...document.querySelectorAll("#needcards .needcard")];
  if (cards[n - 1]) { e.preventDefault(); cards[n - 1].click(); }
});

// The rail is a view switcher over data the page already has — no extra calls.
function showView(name){
  const board = name === "board";
  $("#viewBoard").style.display = board ? "" : "none";
  $("#viewActions").style.display = board ? "none" : "";
  $("#navBoard").setAttribute("aria-current", board ? "page" : "false");
  $("#navActions").setAttribute("aria-current", board ? "false" : "page");
  $("#pane").scrollTop = 0;
}
$("#navBoard").addEventListener("click", () => showView("board"));
$("#navActions").addEventListener("click", () => showView("actions"));
$("#navChat").addEventListener("click", () => { $("#say").focus(); });

async function openApp(id){
  const app = await jget("/api/application/" + id);
  const job = app.job || {};
  const arts = Object.entries(app.artifacts || {}).filter(([,p]) => p)
    .map(([k,p]) => '<a class="artifact" target="_blank" href="/api/artifact?path=' + encodeURIComponent(p) + '">open ' + esc(k) + "</a>").join("");
  const evidence = (app.evidence||[]).map((e) =>
    '<a class="artifact evidence" target="_blank" href="/api/artifact?path=' + encodeURIComponent(e.path) + '" title="' + esc(e.at) + '">' + esc(e.kind) + "</a>"
  ).join("");
  const outreach = (app.outreach||[]);
  const outreachHtml = outreach.length
    ? '<h4>Outreach</h4><ul class="outreach">' + outreach.map((m) =>
        "<li><strong>" + esc(m.target) + "</strong> · " + esc(m.targetRole) + " · " + esc(m.channel) +
        ' · <span class="ostate ' + esc(m.state) + '">' + esc(m.state) + "</span>" +
        " · sent " + esc(String(m.sentAt).slice(0, 10)) +
        (m.note ? " — " + esc(m.note) : "") + "</li>"
      ).join("") + "</ul>"
    : '<p class="empty">no outreach or referral logged for this application yet</p>';
  const state = await jget("/api/state");
  floorInfo = state.floor || null;
  const pay = app.pay || null;
  const payHtml = pay && pay.basis
    ? esc(pay.label) + ' <span class="pill pay ' + (pay.basis === "sourced" ? "sourced" : "") + '">' +
        esc(pay.basis) + '</span><br><span style="color:var(--muted)">' + esc(pay.title) + "</span>" +
        (pay.url ? '<br><a target="_blank" rel="noopener" href="' + esc(pay.url) + '">open the source ↗</a>' : "")
    : "nothing on file yet — <button class=\\"applink\\" onclick=\\"askPay(\\'" + esc(job.id || "") + "')\\">ask Aja to pull it</button>" +
      '<br><span style="color:var(--muted)">Aja reads the range off the company\\\'s posting page or a public comp source and records where it came from. Nothing is estimated.</span>';
  $("#sheetBody").innerHTML =
    "<h3>" + esc(job.company||"?") + " — " + esc(job.title||"?") + "</h3>" +
    '<dl class="meta">' +
      "<dt>status</dt><dd>" + esc(app.status) + "</dd>" +
      "<dt>match</dt><dd>" + (app.matchScore ?? job.matchScore ?? "not scored") + "</dd>" +
      "<dt>pursuit</dt><dd>" + (app.pursuit
        ? pursuitBadge(app.pursuit).replace('class="pill pursuit', 'class="pill pursuit" style="display:inline-flex"') +
          (app.pursuit.note ? " — " + esc(app.pursuit.note) : "")
        : "not assessed") + "</dd>" +
      "<dt>pay</dt><dd>" + payHtml + "</dd>" +
      "<dt>location</dt><dd>" + esc(job.location || "-") + "</dd>" +
      "<dt>posting</dt><dd>" + (job.url
        ? '<a target="_blank" rel="noopener" href="' + esc(job.url) + '">open requisition ↗</a>'
        : "-") + "</dd>" +
      "<dt>resume</dt><dd>" + esc(app.resumeRef || "-") + "</dd>" +
      "<dt>submitted</dt><dd>" + (app.submittedAt
        ? esc(app.submittedAt) + (app.submissionPortal ? " via " + esc(app.submissionPortal) : "") +
          (app.submissionConfirmation ? " · conf " + esc(app.submissionConfirmation) : "")
        : "not yet") + "</dd>" +
    "</dl>" +
    '<div class="btnrow"><button class="rescore" onclick="rescore(\\'' + esc(job.id || "") + '\\')">re-score against the dossier</button></div>' +
    (evidence ? "<h4>Evidence</h4>" + evidence : "") +
    outreachHtml +
    (arts ? "<h4>Artifacts</h4>" + arts : '<p class="empty">no artifacts yet</p>') +
    "<h4>Job description</h4><pre>" + esc(job.description||"") + "</pre>";
  $("#overlay").classList.add("open");
}

// The "ask Aja to pull it" button posts the candidate's request into the same
// chat queue Aja polls, so scraping happens in the browser at human pace
// instead of the dashboard reaching out to the internet on its own.
async function askPay(jobId){
  if (!jobId) return;
  const sent = await jpost("/api/pay-request", { jobId });
  closeSheet();
  if (sent && sent.id) {
    const log = $("#chatlog");
    log.appendChild(bubble(sent));
    log.scrollTop = log.scrollHeight;
  }
}
async function rescore(jobId){
  if (!jobId) return;
  await jpost("/api/match", { jobId });
  closeSheet(); refreshBoard();
}
function closeSheet(){ $("#overlay").classList.remove("open"); }
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeSheet();
});
$("#overlay").addEventListener("click", (e) => {
  if (e.target.id === "overlay") closeSheet();
});

function bubble(m){
  const div = document.createElement("div");
  div.className = "bubble " + m.from;
  div.innerHTML = '<span class="who">' + esc(m.from) + "</span>" + linkifyChatHtml(m.text, Object.keys(knownApps));
  return div;
}
async function refreshChat(){
  const msgs = await jget("/api/chat?since=" + lastId);
  const log = $("#chatlog");
  let grew = false;
  if (msgs.length){
    for (const m of msgs){ chatMsgs.push(m); lastId = Math.max(lastId, m.id); }
    grew = true;
  }
  if (redrawChat){
    // The board just learned application ids it did not know when earlier
    // bubbles rendered: redraw the log once, so chat mentions of those ids
    // become their open-buttons too. The log was just cleared, so every
    // button in it is new and gets bound exactly once.
    redrawChat = false;
    log.innerHTML = "";
    for (const m of chatMsgs) log.appendChild(bubble(m));
    bindAppTags(log);
    grew = true;
  } else if (msgs.length){
    // bind per bubble: the log also holds buttons from earlier renders and
    // they must not get a second click handler
    for (const m of msgs){ const b = bubble(m); log.appendChild(b); bindAppTags(b); }
  }
  if (grew) log.scrollTop = log.scrollHeight;
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
