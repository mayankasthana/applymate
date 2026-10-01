# greenhouse.io job boards — browsing recipes

Recipes for driving Greenhouse job boards (job-boards.greenhouse.io/<tenant>) with
harness browser tools. Format and ground rules: [README.md](README.md). Human
pacing and the no-evasion rules in AGENTS.md govern everything here.

## Application form — the widget set (single-page form)

**Goal:** fill name/email/phone/location/resume + yes-no selects and submit.

**Naive approach fails:** the phone Country and Location (City) fields are
typeahead `combobox` **inputs**, not native `<select>`s — `locator.fill()`
sets the value but never opens the suggestion listbox, so no options appear in
the snapshot. Same for the Yes/No question selects ("Select..." + Toggle
flyout): they render nothing until physically clicked.

**Working path** (verified 2026-10-01, Zeta Global tenant, end to end):

- Text fields (`First Name`, `Email`, `LinkedIn Profile`, free-text questions):
  plain `fill()` + verify via `el.value`.
- Typeahead fields (phone Country, Location City): `click()` the combobox,
  wait ~500 ms, `type("term", { delayMs })` with real keystrokes, wait ~1.5 s —
  the listbox then renders in the ARIA snapshot (`option "India +91"`,
  `option "Some City, State, Country"`). Click the option.
- **Selection lands as a chip, not in the input** (same pattern as the Workday
  typeahead recipe): after clicking an option the search input reads `""` and
  the chosen value appears as a `generic` sibling with a `button "Clear
  selections"` next to it. Verify by that pair — never by the input value.
- Yes/No question selects: `click()` the combobox, wait, the listbox renders
  `option "Yes"` / `option "No"`; click one, verify the selected value shows as
  the `generic` next to the combobox + `Clear selections` appears.
- `fill("")` on a populated input is **async** — an immediate `el.value` read
  still shows the old text. Type the replacement after `fill("")` and verify
  after the typing, not after the clear.

## Resume upload without the OS file picker

**Naive approach fails:** IAB cannot drive the file chooser.

**Working path:** the committed DataTransfer recipe (workday.md) works
unchanged — read the file in Node, pass base64 into `playwright.evaluate`,
inside the page `atob` → `Uint8Array` → `new File(...)` → `DataTransfer` →
assign `input.files = dt.files` on the (single) `input[type="file"]` →
dispatch `new Event("change", { bubbles: true })`. Success signal: the
Resume/CV group renders `paragraph <filename>` + a `button "Remove file"`.

## Submit

- One page, one `button "Submit application"` at the bottom. reCAPTCHA badge
  is present but no visible challenge appeared on submit.
- Success: navigates to `/confirmation` — heading "Thank you for your interest
  in a career at <Company>!" with a Track-your-application sign-in panel. No
  confirmation number is shown; the confirmation URL + screenshot are the proof.

Verified: 2026-10-01, once (Zeta Global, job 6179911004, full submit).
