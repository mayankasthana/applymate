"""Unit tests for guard.apply_spec — the deterministic task-spec guardrails.

Pure stdlib; run:  python3 -m unittest discover -s browser-rig/tests
"""
import sys
import unittest
from os.path import dirname, join

sys.path.insert(0, join(dirname(dirname(__file__))))  # browser-rig/

from guard import apply_spec, gate_ok  # noqa: E402


def element(label, role="textbox", value="", checked=None):
    return {"label": label, "role": role, "value": value, "checked": checked}


class Fixture:
    """Element table where target index i (1-based, as a string) maps to elements[i-1]."""

    def __init__(self, elements):
        self.elements = elements
        self.operations = {"CLICK": "Click an element", "TYPE_TEXT": "Enter text", "SELECT": "Select",
                           "PRESS_ENTER": "Press Enter", "DONE": "Every requirement is satisfied"}
        self.targets = {"CLICK": {str(i + 1): {"label": e["label"]} for i, e in enumerate(elements)},
                        "TYPE_TEXT": {str(i + 1): {"label": e["label"]} for i, e in enumerate(elements)},
                        "SELECT": {}}


FORMY_SPEC = {
    "field_map": [["first name", "Alex"], ["job title", "Software Engineer"]],
    "required": [{"field": r"first name", "equals": "Alex"}],
    "suppress_enter": True,
    "suppress_click": [r"^Form$"],
    "done_when_text": r"successfully submitted",
}


class SuppressEnterTest(unittest.TestCase):
    def test_enter_operation_removed(self):
        f = Fixture([element("First name")])
        apply_spec(f.operations, f.elements, "", f.targets, spec={"suppress_enter": True})
        self.assertNotIn("PRESS_ENTER", f.operations)
        self.assertIn("CLICK", f.operations)

    def test_enter_kept_without_flag(self):
        f = Fixture([element("Search")])
        apply_spec(f.operations, f.elements, "", f.targets, spec={})
        self.assertIn("PRESS_ENTER", f.operations)


class DoneGateTest(unittest.TestCase):
    def test_done_hidden_until_success_text(self):
        f = Fixture([element("First name", value="Alex")])
        apply_spec(f.operations, f.elements, "The form was successfully submitted!", f.targets,
                   spec={"done_when_text": r"successfully submitted"})
        self.assertIn("DONE", f.operations)

    def test_done_hidden_when_fields_filled_but_not_submitted(self):
        # a filled form alone must not unlock DONE — the submit still has to happen
        f = Fixture([element("First name", value="Alex")])
        apply_spec(f.operations, f.elements, "", f.targets, spec=FORMY_SPEC)
        self.assertNotIn("DONE", f.operations)

    def test_done_gated_on_required_fields_without_success_text(self):
        # fill-without-submit flow: DONE unlocks when every required field holds
        spec = {"required": [{"field": r"first name", "equals": "Alex"}]}
        f = Fixture([element("First name", value="")])
        apply_spec(f.operations, f.elements, "", f.targets, spec=spec)
        self.assertNotIn("DONE", f.operations)
        f2 = Fixture([element("First name", value="Alex")])
        apply_spec(f2.operations, f2.elements, "", f2.targets, spec=spec)
        self.assertIn("DONE", f2.operations)

    def test_gate_ok_checks_values_and_checked_state(self):
        spec = {"required": [{"field": r"^male$", "checked": "true"},
                             {"field": r"mobile", "equals": "555"}]}
        els = [element("Male", role="radio", checked="false"), element("Mobile Number", value="555")]
        self.assertFalse(gate_ok(spec, els))
        els[0]["checked"] = "true"
        self.assertTrue(gate_ok(spec, els))


class SuppressClickTest(unittest.TestCase):
    def test_labeled_click_target_removed(self):
        f = Fixture([element("Form", role="link"), element("Submit", role="button")])
        apply_spec(f.operations, f.elements, "", f.targets, spec={"suppress_click": [r"^Form$"]})
        self.assertNotIn("1", f.targets["CLICK"])
        self.assertIn("2", f.targets["CLICK"])

    def test_click_op_dropped_when_no_targets_left(self):
        f = Fixture([element("Form", role="link")])
        apply_spec(f.operations, f.elements, "", f.targets, spec={"suppress_click": [r"^Form$"]})
        self.assertNotIn("CLICK", f.operations)


class SuppressTypeTest(unittest.TestCase):
    def test_dead_field_removed_from_type_targets(self):
        f = Fixture([element("textbox", value="28 Sep 2026"), element("First name")])
        apply_spec(f.operations, f.elements, "", f.targets, spec={"suppress_type": [r"^textbox$"]})
        self.assertNotIn("1", f.targets["TYPE_TEXT"])
        self.assertIn("2", f.targets["TYPE_TEXT"])


class FieldMapTest(unittest.TestCase):
    def test_satisfied_field_hidden_unsatisfied_kept(self):
        f = Fixture([element("First name", value="Alex"), element("First name", value="")])
        apply_spec(f.operations, f.elements, "", f.targets,
                   spec={"field_map": [["first name", "Alex"]]})
        self.assertNotIn("1", f.targets["TYPE_TEXT"])
        self.assertIn("2", f.targets["TYPE_TEXT"])

    def test_type_op_dropped_when_every_field_satisfied(self):
        f = Fixture([element("First name", value="Alex")])
        apply_spec(f.operations, f.elements, "", f.targets,
                   spec={"field_map": [["first name", "Alex"]]})
        self.assertNotIn("TYPE_TEXT", f.operations)

    def test_select_hidden_when_current_value_matches(self):
        f = Fixture([element("Experience", role="combobox", value="2-4")])
        f.targets["SELECT"] = {"1": {"label": "Experience → 2-4"}}
        apply_spec(f.operations, f.elements, "", f.targets,
                   spec={"field_map": [["experience", "2-4"]]})
        self.assertNotIn("SELECT", f.operations)

    def test_checkboxes_never_type_targets(self):
        f = Fixture([element("Music", role="checkbox", checked="false")])
        apply_spec(f.operations, f.elements, "", f.targets,
                   spec={"field_map": [["music", ""]]})
        # a checkbox-only candidate set leaves no TYPE_TEXT targets at all
        self.assertNotIn("TYPE_TEXT", f.targets)


class ToggleDisciplineTest(unittest.TestCase):
    SPEC = {"required": [{"field": r"^male$", "checked": "true"},
                         {"field": r"^music$", "checked": "true"}]}

    def test_only_required_unset_toggles_offered(self):
        els = [element("Male", role="radio", checked="false"),
               element("Female", role="radio", checked="false"),
               element("Sports", role="checkbox", checked="false"),
               element("Music", role="checkbox", checked="false"),
               element("Submit", role="button")]
        f = Fixture(els)
        apply_spec(f.operations, f.elements, "", f.targets, spec=self.SPEC)
        offered = set(f.targets["CLICK"])
        self.assertEqual(offered, {"1", "4", "5"})  # Male + Music (unset) + the Submit button

    def test_satisfied_toggle_removed_cannot_untoggle(self):
        els = [element("Male", role="radio", checked="true"),
               element("Music", role="checkbox", checked="true"),
               element("Submit", role="button")]
        f = Fixture(els)
        apply_spec(f.operations, f.elements, "", f.targets, spec=self.SPEC)
        offered = set(f.targets["CLICK"])
        self.assertEqual(offered, {"3"})  # Submit only


class NoSpecTest(unittest.TestCase):
    def test_missing_spec_changes_nothing(self):
        f = Fixture([element("First name")])
        before = dict(f.operations)
        apply_spec(f.operations, f.elements, "", f.targets, spec={})
        self.assertEqual(before, f.operations)


if __name__ == "__main__":
    unittest.main()
