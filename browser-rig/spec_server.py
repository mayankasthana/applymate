"""Spec + text-value server for the laya browser rig (browser-rig/).

Serves the decision loop's two side-channels over HTTP:

  POST /settask               {"name": "..."}  -> activate a task spec
  GET  /spec                                   -> active task spec (guard flags + field values)
  POST /v1/chat/completions   jev field_text   -> {"choices":[{"message":{"content":"{\"text\": ...}"}}]}

TYPE_TEXT values come from the active spec's field map, keyed by field label — the same
shape Applymate generates from the candidate's answers.json (see src/form-spec.ts). An
unknown field returns an empty value, which jev treats as a failed text call: no guessing.

Specs come from builtin benchmark entries plus, when given, a JSON file:

    python3 spec_server.py [--specs specs.json] [--port 30000]

    {"active": "my-app", "specs": {"my-app": {"field_map": [["first name", "Mayank"]], ...}}}
"""
import argparse
import json
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# Builtin specs: the two sandbox form benchmarks plus generic/search tasks. File specs
# (application-specific, generated from answers.json) merge over these by name.
BUILTIN_SPECS = {
    "formy": {
        "field_map": [
            [r"first name", "Mayank"],
            [r"last name", "Tester"],
            [r"job title", "Software Engineer"],
            [r"date", "09/28/2026"],
        ],
        "required": [
            {"field": r"first name", "equals": "Mayank"},
            {"field": r"last name", "equals": "Tester"},
            {"field": r"job title", "equals": "Software Engineer"},
            {"field": r"experience", "equals": "2-4"},
        ],
        "suppress_enter": True,
        "suppress_click": [r"^Form$", r"^Formy$", r"^Components$", r"^Open "],
        "done_when_text": r"successfully submitted",
    },
    "demoqa": {
        "field_map": [
            [r"first name", "Mayank"],
            [r"last name", "Tester"],
            [r"user email|example\.com", "aja@example.com"],
            [r"mobile|phone", "5551234567"],
            [r"current address|address", "1 Test Way, Testville, CA 90210"],
        ],
        "required": [
            {"field": r"first name", "equals": "Mayank"},
            {"field": r"last name", "equals": "Tester"},
            {"field": r"example\.com", "equals": "aja@example.com"},
            {"field": r"mobile", "equals": "5551234567"},
            {"field": r"current address", "equals": "1 Test Way, Testville, CA 90210"},
            {"field": r"^male$", "checked": "true"},
            {"field": r"^music$", "checked": "true"},
        ],
        "suppress_enter": True,
        "suppress_type": [r"^textbox$", r"^combobox$"],
        "suppress_click": [r"^Practice Form$", r"^Forms$", r"^Elements$", r"^textbox$", r"^Next Month$",
                           r"^Previous Month$", r"^Open ", r"^link$", r"^Interactions$", r"^Alerts",
                           r"^Widgets$", r"^Book Store", r"^Home$", r"^Selenium", r"^Blog$", r"^Profile$",
                           r"^Login$", r"^Remove ", r"^Ad ", r"^Close$"],
        "done_when_text": r"Thanks for submitting the form",
    },
    # goals whose text-to-type is not in quotes (author's suite task keys)
    "wiki-einstein": {"field_map": [[r".*", "Albert Einstein"]]},
    "generic": {},
}

ACTIVE = {"name": "generic"}


def load_specs(path):
    """Load a spec file; returns (specs, active_name). File specs merge over builtins."""
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    specs = dict(BUILTIN_SPECS)
    specs.update(data.get("specs") or {})
    active = data.get("active") or ACTIVE["name"]
    if active not in specs:
        raise ValueError(f"active spec {active!r} is not defined")
    return specs, active


def value_for(spec, context):
    """The value to type for a field context, from the spec's field map. Falls back to the
    first quoted string in the goal (search-box tasks). Empty string = no known value."""
    goal = str(context.get("goal", ""))
    field = context.get("field") or {}
    label = str(field.get("label", ""))
    for pat, val in spec.get("field_map", []):
        if re.search(pat, label, re.I):
            return val
    for m in re.findall(r"['\"]([^'\"]{1,80})['\"]", goal):
        return m
    return ""


def make_handler(specs, active):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _send(self, code, body):
            data = json.dumps(body).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if self.path == "/spec":
                spec = dict(specs.get(ACTIVE["name"], {}))
                spec["active"] = ACTIVE["name"]
                return self._send(200, spec)
            return self._send(404, {"error": "not found"})

        def do_POST(self):
            n = int(self.headers.get("Content-Length", 0))
            req = json.loads(self.rfile.read(n) or b"{}")
            if self.path == "/settask":
                if req.get("name") not in specs:
                    return self._send(400, {"error": f"unknown spec {req.get('name')!r}"})
                ACTIVE["name"] = req["name"]
                return self._send(200, {"active": ACTIVE["name"]})
            if self.path.endswith("/chat/completions"):
                try:
                    context = json.loads(req["messages"][1]["content"])
                except Exception:
                    context = {}
                field = context.get("field") or {}
                print(f"[text] field={field.get('label')!r} role={field.get('role')!r} value={field.get('value')!r}", flush=True)
                text = value_for(specs.get(ACTIVE["name"], {}), context)
                content = json.dumps({"text": text}) if text else '{"text": ""}'
                return self._send(200, {"choices": [{"message": {"content": content}}]})
            return self._send(404, {"error": "not found"})

    return H


def main(argv=None):
    ap = argparse.ArgumentParser(description="spec + text-value server for the laya rig")
    ap.add_argument("--specs", help="JSON file with {active, specs}; merges over builtins")
    ap.add_argument("--port", type=int, default=30000)
    args = ap.parse_args(argv)

    specs = dict(BUILTIN_SPECS)
    if args.specs:
        specs, active = load_specs(args.specs)
        ACTIVE["name"] = active
    print(f"spec + text-value server on http://127.0.0.1:{args.port} (active={ACTIVE['name']!r})", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(specs, ACTIVE)).serve_forever()


if __name__ == "__main__":
    main(sys.argv[1:])
