# keka careers portals (`<tenant>.keka.com`) — apply flow

Recipes for keka-hosted careers sites (MontyCloud verified). Format and ground
rules: [README.md](README.md). Human pacing and the no-evasion rules in AGENTS.md
govern everything here.

## Reading a posting and reaching the form

**Working path:** `https://<tenant>.keka.com/careers/jobdetails/<id>/` renders the
full JD server-side (location, experience band, required-skills chips included).
The `Apply for this job` button navigates to `https://<tenant>.keka.com/careers/applyjob/<id>`
— the application form on its own page. No iframe, no login gate for a first-time
applicant.

Verified 2026-10-12, montycloud.keka.com, req 85529.

## The apply form — field map and the autofill trap

**Naive approach fails:** the resume upload is REQUIRED and auto-fills fields
("This will auto-fill the fields below"). The parser got name, email and phone
right but produced **wrong experience** (6y 10m on an 11y 4m record) and left the
phone country-code and gender selects empty. Trusting the autofill submits wrong data.

**Working path:** upload the resume first, wait for the fill, then **audit every
field from the DOM** and correct what's wrong. Field ids are bare (`firstName`,
`workExperience`, `availability`, `currentLocation`, `expectedSalary`,
`currentSalary`) or bare UUIDs for the custom questions; the `name` attributes are
dotted (`standardFields.<uuid>.answer`) — `getElementById` wants the bare id, not
the dotted name (the dotted string as an id lookup returns null silently).

Angular-style widgets: the native value setter + `input` + `change` + `blur`
events register state. Salary amounts display back in Indian digit grouping
(`6800000` → `68,00,000`) — that readback is the confirmation, not a corruption.

Widget specifics:

- `select[name="mobilePhone.countryCode"]` — options carry `+91`-style text; set by
  matching option text then `change`.
- Experience is a split widget: `#workExperience` (years text input), a
  `select[name="workExperience.months"]` (0–11), plus decorative "Years"/"Months"
  text boxes that are labels, not inputs.
- "Where did you come across this job opportunity?" is a radio group
  (`standardFields.f1aec955-….answer`) whose values are UUIDs — map the visible
  label per radio before clicking; nothing is pre-selected.
- `#candidateConsent` checkbox starts unchecked.
- "Date Applied" is a readonly empty field — it fills server-side on submit; leave it.
- Current/Recent Title wording accepts the most recent title; "Current Employer" is
  current-only — for a candidate between jobs the honest value is "Not currently
  employed" (blank fails the required check).

## The captcha is the candidate's, not ours

The form ends with a **typed image CAPTCHA** (`img` + `#captcha` textbox) and the
`Apply Now` button enables once the captcha is non-empty. Per the ground rules a
CAPTCHA is handed to the candidate: stage every other field, screenshot the staged
form, and let the candidate type the code and click Apply Now. No OCR, no bypass.
