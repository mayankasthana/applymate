"""Vendored from cklxx/laya-browser code/apps/browser_suite.py (Apache-2.0) — the
author's 16-task Suite A, with the jev path and text-model name parameterized.

    python3 suite_a_authors.py [name-filter]     # REPEATS=2 for repeats
"""
"""Real-task suite for the browser agent with automatic outcome checks (URL / title / page text).

    python apps/browser_suite.py [name-filter]       (services: chromium 9222, laya systemone 8791, sglang 30000)

Prints one line per task: PASS/FAIL, steps, wall time, and a summary table.
"""
import json, os, re, sys, time
sys.path.insert(0, os.environ.get("RIG_JEV_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "jev-ultrafast"))
os.environ.update(BU_CDP_URL="http://127.0.0.1:9222", TYPESAFE_BASE_URL="http://127.0.0.1:8791", TYPESAFE_API_KEY="local",
                  TEXT_MODEL_API_KEY="local", TEXT_MODEL_BASE_URL="http://127.0.0.1:30000/v1", TEXT_MODEL="deterministic-spec",
                  TEXT_MODEL_EXTRA_JSON='{"chat_template_kwargs": {"enable_thinking": false}}')
from jev_ultrafast import Agent

# (name, url, goal, check(url, title, text) -> bool)
TASKS = [
    # NOTE: Wikipedia's 'Random article' link sits in a collapsed menu that the DOM reader never observes -> search task instead
    ("wiki-einstein", "https://en.wikipedia.org/wiki/Main_Page", "Open the Wikipedia article about Albert Einstein.",
     lambda u, t, x: "Albert_Einstein" in u),
    ("wiki-search", "https://en.wikipedia.org/wiki/Main_Page", "Search Wikipedia for 'Python programming language' and open the article about the Python language.",
     lambda u, t, x: "Python" in t),
    ("hn-new", "https://news.ycombinator.com/", "Open the 'new' page that lists the newest submissions.",
     lambda u, t, x: u.rstrip("/").endswith("/newest")),
    ("hn-login-page", "https://news.ycombinator.com/", "Go to the login page.",
     lambda u, t, x: "login" in u),
    ("gh-issues", "https://github.com/tile-ai/tilelang", "Open the Issues tab of this repository.",
     lambda u, t, x: "/issues" in u),
    ("py-downloads", "https://www.python.org/", "Go to the Downloads page.",
     lambda u, t, x: "/downloads" in u),
    ("books-travel", "https://books.toscrape.com/", "Open the 'Travel' category.",
     lambda u, t, x: "travel" in u),
    ("books-open-book", "https://books.toscrape.com/", "Open the product page of the book 'A Light in the Attic'.",
     lambda u, t, x: "a-light-in-the-attic" in u),
    # NOTE: jev's snapshot.js hides password fields by design, so password logins are impossible in this framework.
    ("internet-dropdown", "https://the-internet.herokuapp.com/dropdown", "Select 'Option 2' in the dropdown.",
     lambda u, t, x: False),  # checked via page state below
    ("internet-checkbox", "https://the-internet.herokuapp.com/checkboxes", "Tick the first checkbox.",
     lambda u, t, x: False),
    ("books-page2", "https://books.toscrape.com/", "Go to page 2 of the catalogue.",
     lambda u, t, x: "page-2" in u),
    ("quotes-tag-love", "https://quotes.toscrape.com/", "Show the quotes tagged 'love'.",
     lambda u, t, x: "/tag/love" in u),
    ("hn-past", "https://news.ycombinator.com/", "Open the 'past' page (front pages from previous days).",
     lambda u, t, x: "/front" in u),
    # NOTE: DuckDuckGo (all front ends), Bing, Ecosia and Startpage block headless Chromium (bot pages); Marginalia does not.
    ("web-search", "https://search.marginalia.nu/", "Search for 'tilelang github' and show the results.",
     lambda u, t, x: "query=" in u and "tilelang" in u.lower()),
    ("arxiv-search", "https://arxiv.org/", "Search arXiv for 'flash attention' papers and show the results list.",
     lambda u, t, x: "search" in u and "flash" in u.lower()),
    ("flights", "https://www.google.com/travel/flights?hl=en", "Find one-way flights from Zurich to London on September 28, 2026, for one adult in economy. Stop when matching flight options are visible.",
     lambda u, t, x: ("ZRH" in x or "Zurich" in x or "Zürich" in x) and "London" in x and re.search(r"\b\d{1,2}:\d{2}\b", x) is not None and "one way" in x.lower()),
]

def run(name, url, goal, check, max_steps=20):
    t0 = time.time(); steps = 0; status = "error"; page = None
    try:
        with Agent(url, goal) as agent:
            page = agent.state["page"]
            for state in agent.run():
                steps = len(state["history"]); status = state["status"]; page = state["page"]
                if steps >= max_steps: break
            time.sleep(1.5)                                  # let a slow navigation (GitHub's Turbo, etc.) land before judging
            try:
                page = agent.browser.observe(screenshot=False)
            except Exception:
                pass
    except Exception as e:
        status = f"error:{type(e).__name__}"
    wall = time.time() - t0
    ok = bool(page and check(page["url"], page["title"], page.get("text", "")))
    if page and name == "internet-dropdown":
        ok = any(a.get("kind") == "select" and str(a.get("current_value", "")).strip() in ("2", "Option 2") for a in page["actions"])
    if page and name == "internet-checkbox":
        cbs = [a for a in page["actions"] if a.get("role") == "checkbox"]
        ok = bool(cbs) and bool(cbs[0].get("checked"))
    return ok, steps, status, wall, (page or {}).get("url", "")

if __name__ == "__main__":
    flt = sys.argv[1] if len(sys.argv) > 1 else ""
    repeats = int(os.environ.get("REPEATS", "1"))
    rows = []
    for name, url, goal, check in TASKS:
        if flt and flt not in name: continue
        for rep in range(repeats):
            ok, steps, status, wall, final = run(name, url, goal, check)
            rows.append((name, ok, steps, status, wall))
            print(f"{'PASS' if ok else 'FAIL'}  {name:16s} steps={steps:2d} status={status:9s} {wall:5.1f}s  {final[:70]}", flush=True)
    n = sum(r[1] for r in rows)
    print(f"\n== {n}/{len(rows)} passed ({100*n/len(rows):.0f}%, {repeats} run(s) per task) | median wall {sorted(r[4] for r in rows)[len(rows)//2]:.1f}s")
    if repeats > 1:
        per = {}
        for r in rows: per.setdefault(r[0], []).append(r[1])
        print("   per task: " + "  ".join(f"{k}={sum(v)}/{len(v)}" for k, v in per.items()))
    json.dump([dict(zip(("name", "pass", "steps", "status", "wall"), r)) for r in rows], open(os.environ.get("SUITE_OUT", "/tmp/suite.json"), "w"), indent=1)
