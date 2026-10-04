# Lever (jobs.lever.co)

Mechanics of Lever-hosted application forms. Verified on Bazaarvoice
(Staff Software Engineer, req `bcd72ca1-c6d0-439c-82de-850f236d2b25`),
2026-10-04. Single-page form, no account creation. HighLevel
(app-zhvb, 2026-10-02) is the same portal family.

## The form

- Apply URL: `https://jobs.lever.co/<company>/<req-id>/apply` — navigable
  directly; no need to click through the posting page.
- A native `<dialog>` cookie-consent banner appears on every page. Playwright
  role-clicks on its Deny/Accept buttons **time out** (actionability never
  settles). The working path is a programmatic click by text:
  `[...document.querySelectorAll("button")].find(b => b.textContent.trim().toLowerCase() === "deny").click()`.
- Required fields are marked ✱: resume upload, full name, email, phone,
  current location, LinkedIn URL, plus per-company card questions (CTC,
  notice period on this tenant). No cover-letter slot on this tenant — the
  tailored letter has to travel by email to the recruiter instead.

## Resume upload (no OS file picker)

- Hidden input: `input#resume-upload-input` (`application-file-input
  invisible-resume-upload`). Working path: fetch the PDF bytes in page
  context (serve the file from localhost with CORS), build a `File`,
  set `input.files` via a `DataTransfer`, dispatch `input` + `change`.
- The chip renders and the label flips to "Analyzing resume..." — but on this
  tenant the parser **autofilled nothing**. Verify every field by hand.
- **A failed submit wipes the attachment.** The first submit was rejected on
  the location validation and the re-render reset the file input to empty
  while all typed fields survived. Attach the resume **last**, after every
  validation-prone field is already valid, and go straight to submit.

## Location field — the real trap

Lever uses its own typeahead, `js/retrieveLocations.js` (jQuery, no
mapbox/google). Contract:

- `keydown` on `input.location-input` → debounced 500 ms XHR
  `GET /searchLocations?text=<query>` → results rendered as
  `.dropdown-location` divs inside `.dropdown-results`.
- Selection (mousedown on an option, or Enter on the active one) writes
  **two** fields: the option's `.name` into the visible input, and
  `JSON.stringify(location)` — `{name, id}` — into a hidden
  `input#selected-location`. The POST validates `#selected-location`;
  free text alone fails with
  "Please select a location from the dropdown menu and try again."
- **Blur without a selection clears both** the visible input and the hidden
  field (`emptyDropdownContainer()`).
- If the typeahead never renders (it silently failed on synthetic keystrokes
  and once on real ones), the honest fix is to call the site's own endpoint
  from the page — `fetch("/searchLocations?text=...")` — and perform exactly
  what the mousedown handler does: set `input.location-input` value to the
  picked result's `name` and `#selected-location` to `JSON.stringify(pick)`.
  That is Lever's own data and Lever's own write path, not a forged value.

## Radios (EEO / demographic survey)

Lever custom-styles its radios; the real `input[type=radio]` is hidden.
Playwright `check()` and even `check({ force: true })` **time out** on them.
The working path is a programmatic `input.click()` via evaluate — fires the
native checked + event chain, and the styled dot renders selected.

## After submit

- Confirmation page: `.../apply` navigates to `.../thanks` with
  "Application submitted!". Lever issues **no confirmation number** — the
  /thanks page screenshot is the whole proof.
- Do not read `document.body.innerText` while the POST navigation is in
  flight (`document.body` is null mid-transition); wait for
  domcontentloaded first.
