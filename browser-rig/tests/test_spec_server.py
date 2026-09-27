"""Unit tests for spec_server: spec loading, field-value matching, HTTP endpoints.

Pure stdlib; run:  python3 -m unittest discover -s browser-rig/tests
"""
import json
import sys
import tempfile
import threading
import unittest
import urllib.request
from http.client import HTTPConnection
from os.path import dirname, join

sys.path.insert(0, join(dirname(dirname(__file__))))  # browser-rig/

import spec_server  # noqa: E402
from spec_server import load_specs, make_handler, value_for  # noqa: E402


class ValueForTest(unittest.TestCase):
    def test_field_map_match_is_case_insensitive(self):
        spec = {"field_map": [[r"first name", "Mayank"]]}
        self.assertEqual(value_for(spec, {"field": {"label": "First Name"}}), "Mayank")

    def test_placeholder_labels_match_alternation(self):
        spec = {"field_map": [[r"user email|example\.com", "a@b.co"]]}
        self.assertEqual(value_for(spec, {"field": {"label": "name@example.com"}}), "a@b.co")

    def test_quoted_goal_fallback_for_search_tasks(self):
        self.assertEqual(
            value_for({}, {"goal": "Search Wikipedia for 'Python (programming)' and open it", "field": {"label": "Search"}}),
            "Python (programming)")

    def test_unknown_field_returns_empty_no_guessing(self):
        self.assertEqual(value_for({}, {"goal": "no quotes here", "field": {"label": "Mystery"}}), "")


class LoadSpecsTest(unittest.TestCase):
    def test_file_specs_merge_over_builtins_and_set_active(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"active": "my-app",
                       "specs": {"my-app": {"field_map": [["first name", "Mayank"]]}}}, f)
            path = f.name
        try:
            specs, active = load_specs(path)
            self.assertEqual(active, "my-app")
            self.assertIn("formy", specs)          # builtins still available
            self.assertIn("my-app", specs)
        finally:
            import os
            os.unlink(path)

    def test_unknown_active_spec_rejected(self):
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as f:
            json.dump({"active": "nope", "specs": {}}, f)
            path = f.name
        try:
            with self.assertRaises(ValueError):
                load_specs(path)
        finally:
            import os
            os.unlink(path)


class HttpEndpointsTest(unittest.TestCase):
    """Spec server on an ephemeral port: /settask, /spec, /v1/chat/completions."""

    def setUp(self):
        self.specs = dict(spec_server.BUILTIN_SPECS)
        spec_server.ACTIVE["name"] = "formy"
        self.server = spec_server.__dict__["ThreadingHTTPServer"](
            ("127.0.0.1", 0), make_handler(self.specs, spec_server.ACTIVE))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.port = self.server.server_address[1]

    def tearDown(self):
        self.server.shutdown()

    def request(self, method, path, body=None):
        conn = HTTPConnection("127.0.0.1", self.port, timeout=5)
        payload = json.dumps(body) if body is not None else None
        conn.request(method, path, body=payload, headers={"Content-Type": "application/json"} if body else {})
        resp = conn.getresponse()
        data = json.loads(resp.read() or b"{}")
        conn.close()
        return resp.status, data

    def test_settask_switches_active_spec(self):
        status, data = self.request("POST", "/settask", {"name": "demoqa"})
        self.assertEqual(status, 200)
        self.assertEqual(data, {"active": "demoqa"})
        status, spec = self.request("GET", "/spec")
        self.assertEqual(spec["active"], "demoqa")
        self.assertIn("suppress_type", spec)

    def test_settask_unknown_spec_rejected(self):
        status, _ = self.request("POST", "/settask", {"name": "nope"})
        self.assertEqual(status, 400)

    def test_chat_completions_returns_field_value(self):
        self.request("POST", "/settask", {"name": "formy"})
        status, data = self.request("POST", "/v1/chat/completions", {
            "messages": [{"role": "system", "content": "sys"},
                         {"role": "user", "content": json.dumps({"goal": "fill", "field": {"label": "First name"}})}]})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data["choices"][0]["message"]["content"]), {"text": "Mayank"})

    def test_chat_completions_empty_value_for_unknown_field(self):
        self.request("POST", "/settask", {"name": "formy"})
        status, data = self.request("POST", "/v1/chat/completions", {
            "messages": [{"role": "system", "content": "sys"},
                         {"role": "user", "content": json.dumps({"goal": "no quotes", "field": {"label": "Mystery"}})}]})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(data["choices"][0]["message"]["content"]), {"text": ""})


if __name__ == "__main__":
    unittest.main()
