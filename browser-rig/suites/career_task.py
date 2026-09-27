"""Verbose single-task runner: prints every decision and saves frame screenshots.

    python3 career_task.py <task_key> [url] [goal]
"""
import json
import os
import sys
import time
from os.path import abspath, dirname, join

sys.path.insert(0, os.environ.get("RIG_JEV_DIR") or join(dirname(abspath(__file__)), "..", "jev-ultrafast"))
os.environ.update(BU_CDP_URL="http://127.0.0.1:9222", TYPESAFE_BASE_URL="http://127.0.0.1:8791",
                  TYPESAFE_API_KEY="local", TEXT_MODEL_API_KEY="local",
                  TEXT_MODEL_BASE_URL="http://127.0.0.1:30000/v1", TEXT_MODEL="deterministic-spec")
sys.path.insert(0, dirname(abspath(__file__)))
from career_suite import TASKS, set_task  # noqa: E402
from jev_ultrafast import Agent  # noqa: E402

key = sys.argv[1]
task = next((t for t in TASKS if t[0] == key), None)
url, goal = (task[1], task[2]) if task else (sys.argv[2], sys.argv[3])
set_task(key)

t0 = time.time()
with Agent(url, goal, record_dir=f"/tmp/laya-bench/frames/{key}") as agent:
    print("elements on first page:", len(agent.snapshot()["elements"]), "| title:", agent.state["page"]["title"])
    for state in agent.run():
        h = state["history"][-1] if state["history"] else None
        d = state["decisions"][-1] if state["decisions"] else None
        print(f"{state['elapsed_ms']:6d} ms  status={state['status']:9s}  op={d['operation'] if d else None:9s} "
              f"conf={d['confidence'] if d else 0:.2f} model={d['latency_ms'] if d else 0:4d}ms  "
              f"action={h['action'][:60] if h else None}  text={h['text'] if h else None}")
        if len(state["history"]) >= 30:
            break
    final = agent.browser.observe(screenshot=False)
    print("FINAL:", state["status"], "| url:", final["url"], "| title:", final["title"], "| wall", round(time.time() - t0, 1), "s")
    print("FIELDS:", json.dumps([{k: a.get(k) for k in ("label", "kind", "current_value", "value", "checked")}
                                 for a in final["actions"] if a.get("kind") in ("fill", "select") or a.get("checked") is not None][:20],
                                ensure_ascii=False)[:1500])
