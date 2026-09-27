"""Deterministic task-spec guardrails for the laya/jev browser decision loop.

The v17s decision head picks (operation, target) in one forward pass, but on long forms it
exhibits three measured failure modes: premature DONE, stray PRESS_ENTER after typing, and
re-toggling/toggling the wrong checkboxes. This module filters the offered choices before
each decision so the model can only move the form forward. It is pure stdlib — no torch,
no jev imports — so it can be unit-tested anywhere.

Spec format (see spec_server.py; Applymate generates these from the candidate's answers):
    field_map:      [[label_regex, value], ...]   what to type into which fields
    required:       [{field, equals|checked}, ...] DONE gate for fill-without-submit flows
    suppress_enter: true                          remove PRESS_ENTER controls
    suppress_click: [label_regex, ...]            remove click targets (site nav, ads)
    suppress_type:  [label_regex, ...]            remove fill targets (readonly/dead fields)
    done_when_text: page_regex                    DONE only once this evidence is visible
"""
import json
import os
import re
import time
import urllib.request

_SPEC = {"t": 0.0, "data": {}}


def get_spec(base_url=None, ttl=2.0, timeout=2):
    """Active task spec from the spec server, cached for `ttl` seconds."""
    if base_url is None:
        base_url = os.environ.get("SPEC_URL", "http://127.0.0.1:30000")
    if time.perf_counter() - _SPEC["t"] > ttl:
        try:
            with urllib.request.urlopen(base_url + "/spec", timeout=timeout) as r:
                _SPEC["data"] = json.load(r)
        except Exception:
            _SPEC["data"] = {}
        _SPEC["t"] = time.perf_counter()
    return _SPEC["data"]


def _norm(v):
    return str(v).strip().lower() if v is not None else ""


def gate_ok(spec, elements):
    """True when every `required` entry visibly holds on the element table."""
    for r in spec.get("required", []):
        pat, want, checked = r["field"], r.get("equals"), r.get("checked")
        hit = False
        for el in elements:
            if not re.search(pat, str(el.get("label", "")), re.I):
                continue
            if checked is not None and _norm(el.get("checked")) == _norm(checked):
                hit = True
                break
            if want is not None and _norm(el.get("value")) == _norm(want):
                hit = True
                break
        if not hit:
            return False
    return True


def _drop(operations, targets, op):
    operations.pop(op, None)
    targets.pop(op, None)


def apply_spec(operations, elements, page_text, targets=None, spec=None):
    """Filter the offered operations/targets in place, before the model decides.

    operations: {op_key: label} — what the model may choose (CLICK/TYPE_TEXT/SELECT/DONE/...)
    elements:   [{label, role, value, checked, ...}] — the observed control table
    page_text:  visible page text
    targets:    {op: {index: action}} — per-operation candidate targets (optional)
    spec:       task spec; fetched from the spec server when omitted
    """
    if spec is None:
        spec = get_spec()
    if not spec:
        return
    if spec.get("suppress_enter"):
        for k in [k for k in operations if "ENTER" in k.upper()]:
            operations.pop(k)
    for pat in spec.get("suppress_click", []):
        for k in [k for k in operations if re.search(pat, str(operations[k]), re.I)]:
            operations.pop(k)
    if "DONE" in operations:
        if spec.get("done_when_text"):
            # form task with a success page: DONE only once that evidence is visible,
            # never merely because the fields are filled (the submit still has to happen)
            if not re.search(spec["done_when_text"], page_text or "", re.I):
                operations.pop("DONE")
        elif not gate_ok(spec, elements):
            operations.pop("DONE")
    if targets is None:
        return
    if spec.get("suppress_click"):
        cand = targets.get("CLICK")
        if cand:
            keep = {}
            for idx, a in cand.items():
                if any(re.search(p, str(a.get("label", "")), re.I) for p in spec["suppress_click"]):
                    continue
                keep[idx] = a
            if not keep:
                _drop(operations, targets, "CLICK")
            else:
                targets["CLICK"] = keep
    if spec.get("suppress_type"):
        cand = targets.get("TYPE_TEXT")
        if cand:
            keep = {}
            for idx, a in cand.items():
                if any(re.search(p, str(a.get("label", "")), re.I) for p in spec["suppress_type"]):
                    continue
                keep[idx] = a
            if not keep:
                _drop(operations, targets, "TYPE_TEXT")
            else:
                targets["TYPE_TEXT"] = keep
    if targets is not None and spec.get("required"):
        # toggle discipline: among checkbox/radio click targets, only offer required-checked
        # elements that are still unchecked (and never offer un-toggling them)
        cand = targets.get("CLICK")
        if cand:
            keep = {}
            for idx, a in cand.items():
                try:
                    el = elements[int(str(idx).split(":")[0]) - 1]
                except Exception:
                    keep[idx] = a
                    continue
                if str(el.get("role", "")).lower() not in ("checkbox", "radio"):
                    keep[idx] = a
                    continue
                want = next((r for r in spec["required"] if r.get("checked") is not None
                             and re.search(r["field"], str(el.get("label", "")), re.I)), None)
                if want and _norm(el.get("checked")) != _norm(want["checked"]):
                    keep[idx] = a
            if not keep:
                _drop(operations, targets, "CLICK")
            else:
                targets["CLICK"] = keep
    if spec.get("field_map"):
        for op in ("TYPE_TEXT", "SELECT"):
            cand = targets.get(op)
            if not cand:
                continue
            keep = {}
            for idx, a in cand.items():
                label = str(a.get("label", ""))
                try:
                    el = elements[int(str(idx).split(":")[0]) - 1]
                    cur = str(el.get("value", "") or "").strip()
                except Exception:
                    el, cur = {}, ""
                if str(el.get("role", "")).lower() in ("checkbox", "radio"):
                    continue  # not a text target: the model must click these
                if any(re.search(p, label, re.I) and cur.lower() == str(v).strip().lower()
                       for p, v in spec["field_map"]):
                    continue  # already holds the requested value
                keep[idx] = a
            if not keep:
                _drop(operations, targets, op)
            else:
                targets[op] = keep
