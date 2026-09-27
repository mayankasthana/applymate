"""Career-site benchmark for cklxx/laya-browser, driven through jev-ultrafast + the local
laya systemone server (pure System 1, ESCALATE_TAU=0) and the guardrails from guard.py.

Real job boards are only navigated (read-only: nothing is filled, nothing is submitted).
Form-filling runs on sandbox test sites; field values come from spec_server.py.

    python3 career_suite.py [name-filter]      # services: Chrome :9222, laya :8791, specs :30000

Results 2026-09-28 (REPEATS=2): forms 4/4 PASS (4.5–7.2s), lever-nav 2/2 PASS (~10s),
gh-nav 0/2 FAIL (model target grounding — see README).
"""
import json
import os
import sys
import time
import urllib.request
from os.path import abspath, dirname, join

sys.path.insert(0, os.environ.get("RIG_JEV_DIR") or join(dirname(abspath(__file__)), "..", "jev-ultrafast"))
os.environ.update(BU_CDP_URL="http://127.0.0.1:9222", TYPESAFE_BASE_URL="http://127.0.0.1:8791",
                  TYPESAFE_API_KEY="local", TEXT_MODEL_API_KEY="local",
                  TEXT_MODEL_BASE_URL="http://127.0.0.1:30000/v1", TEXT_MODEL="deterministic-spec")
from jev_ultrafast import Agent  # noqa: E402

# (task_key, url, goal, check(url, title, text) -> bool)
TASKS = [
    ("career-gh-anthropic", "https://job-boards.greenhouse.io/anthropic",
     "Open the job posting titled 'Research Engineer, Knowledge Team'.",
     lambda u, t, x: "4017331008" in u or "Research Engineer, Knowledge Team" in t),
    ("career-lv-palantir", "https://jobs.lever.co/palantir",
     "Open the job posting titled 'Administrative Business Partner'.",
     lambda u, t, x: "ac978161" in u or "Administrative Business Partner" in t),
    ("career-formy-form", "https://formy-project.herokuapp.com/form",
     "Fill the job application form: first name Mayank, last name Tester, job title Software Engineer, "
     "education College, sex Male, experience 2-4, date 09/28/2026, then submit the form.",
     lambda u, t, x: "successfully submitted" in x.lower()),
    ("career-demoqa-form", "https://demoqa.com/automation-practice-form",
     "Fill the student practice form fields one by one: first name Mayank, last name Tester, email aja@example.com, "
     "gender Male, mobile 5551234567, hobbies Music, current address 1 Test Way, Testville, CA 90210, then submit the form.",
     lambda u, t, x: "Thanks for submitting the form" in x),
]

SPEC_ALIASES = {"career-formy-form": "formy", "career-demoqa-form": "demoqa"}


def set_task(name):
    """Point the spec server at this task's spec (nav tasks run under their own name,
    which resolves to the builtin empty spec -> guardrails stay out of the way)."""
    body = json.dumps({"name": SPEC_ALIASES.get(name, name)}).encode()
    req = urllib.request.Request("http://127.0.0.1:30000/settask", data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=3).read()
    except Exception as e:
        print(f"[warn] settask {name}: {e}")


def run(task_key, url, goal, check, max_steps=30):
    set_task(task_key)
    t0 = time.time()
    steps = 0
    status = "error"
    page = None
    lat = []
    try:
        with Agent(url, goal) as agent:
            page = agent.state["page"]
            for state in agent.run():
                steps = len(state["history"])
                status = state["status"]
                page = state["page"]
                lat = [d["latency_ms"] for d in state["decisions"]]
                if steps >= max_steps:
                    break
            time.sleep(1.5)  # let slow navigations land before judging
            try:
                page = agent.browser.observe(screenshot=False)
            except Exception:
                pass
    except Exception as e:
        status = f"error:{type(e).__name__}"
    wall = time.time() - t0
    ok = bool(page and check(page["url"], page["title"], page.get("text", "")))
    return ok, steps, status, wall, (page or {}).get("url", ""), lat


if __name__ == "__main__":
    flt = sys.argv[1] if len(sys.argv) > 1 else ""
    repeats = int(os.environ.get("REPEATS", "1"))
    rows = []
    for task_key, url, goal, check in TASKS:
        if flt and flt not in task_key:
            continue
        for rep in range(repeats):
            ok, steps, status, wall, final, lat = run(task_key, url, goal, check)
            avg = round(sum(lat) / len(lat), 1) if lat else 0
            rows.append(dict(task=task_key, rep=rep, ok=ok, steps=steps, status=status,
                             wall=round(wall, 1), decision_ms_avg=avg, final=final))
            print(f"{'PASS' if ok else 'FAIL'}  {task_key:22s} steps={steps:2d} status={status:12s} "
                  f"{wall:5.1f}s  decision_ms_avg={avg:6.1f}  {final[:60]}", flush=True)
    if rows:
        n = sum(r["ok"] for r in rows)
        print(f"\n== {n}/{len(rows)} passed ({100*n/len(rows):.0f}%) | "
              f"median wall {sorted(r['wall'] for r in rows)[len(rows)//2]:.1f}s")
    out = os.environ.get("SUITE_OUT", join(dirname(abspath(__file__)), "..", "results", "career_suite.json"))
    json.dump(rows, open(out, "w"), indent=1)
