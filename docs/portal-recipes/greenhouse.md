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

## Second tenant, 2026-10-03 — AlphaSense (job 8729924002), full submit

Re-confirmed the widget set on a different tenant and picked up three things the
Zeta entry did not cover.

**The widget path transfers across tenants unchanged.** Phone Country and
Location (City) behaved exactly as above on `alphasense`: `click()` → ~600 ms →
`type()` with real keystrokes → ~1.8 s → `option` in the ARIA snapshot → click.
The two Yes/No-style question selects are the same react-select widget, and the
success tell is the same pair — the `option <value>, selected.` line in the
`log` node, plus the value rendering as a sibling `generic` next to a
`button "Clear selections"`. No CUA coordinates were needed anywhere on this
form; plain Playwright was sufficient.

**The phone input reformats as you type.** Typing `9022431617` yields the
display value `90224 31617`. That is a mask, not a corrupted number — compare
the digits, never the rendered string, or you will "fix" a field that is
already right.

**Finding the file input may need a shadow-DOM walk.** `document.querySelector`
found it on this tenant, but not all Greenhouse tenants put the upload input at
the top level. Use a small recursive search that descends into `host.shadowRoot`
before falling back to the bare query, then the DataTransfer recipe unchanged.
Success signal is the same: the group renders `paragraph <filename>` plus a
`button "Remove file"`.

**Forms are not uniform — check for a cover-letter field before promising one.**
The AlphaSense board has **no** cover-letter field and no "enter manually" resume
textarea worth using, so a tailored cover letter cannot be attached at all. A
board can also carry questions a sibling tenant never asked: this one wanted an
experience **band** with options `Early career (<5) / Developing (5-8) /
Advanced (8-14) / Expert (14+)`. Do not reuse a stored band answer from another
employer's question — the option sets differ, and the honest band depends on the
actual years.

**Verified:** 2026-10-03, AlphaSense tenant, job 8729924002 — staged end to end,
0 unfilled required fields, submitted; confirmation page read back and
screenshotted (`Thank you for applying.`, no confirmation number issued).

---

# Reading a whole Greenhouse board as JSON — and the escaped-HTML trap

**Goal:** sweep an employer's entire Greenhouse board (liveness + full JD text)
with no browser, no search UI, and no pagination.

**The endpoint is public and needs no auth:**

```
https://boards-api.greenhouse.io/v1/boards/<board-token>/jobs?content=true
```

The board token is the slug in the careers URL — Databricks' is
`boards-api.greenhouse.io/v1/boards/databricks/jobs?content=true`, which
returned all 885 open reqs with full JD bodies in one call. Per-job liveness is
then a substring match of the req id against `absolute_url`, e.g. `gh_jid=8679982002`.

**`content` is HTML-*escaped*: `&lt;p&gt;&lt;strong&gt;`, not `<p><strong>`.**

This is the whole trap, and it fails silently. Stripping tags with
`re.sub(r"(?s)<[^>]+>", " ", ...)` matches **nothing** and returns the input
unchanged — the regex looks correct, the output looks like text, and the escaped
markup flows straight into the JD store. Unescape **first**, then strip:

```python
t = html.unescape(job["content"])            # MUST come first
t = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", t)
t = re.sub(r"(?i)</?(p|ul|ol|li|br|div|tr|h[1-6]|table)[^>]*>", "\n", t)
t = re.sub(r"(?s)<[^>]+>", " ", t)
t = html.unescape(t)                          # second pass, for double-escaped entities
```

**Why this matters more than a cosmetic bug:** the junk terms (`href`, `div`,
`li`, `ul`, `nbsp`, `span`, `https`) enter the match vocabulary and drag the
score down. A Databricks `Sr Full Stack Developer (AI Agents)` req scored
**63/100** with escaped markup and **85/100** clean — the same JD, same dossier.
Two more moved 69→83. This is the same failure class as the InMobi 32/100 case
in `AGENTS.md`, and it is silent: the stored score just looks low, so the
relevance gate quietly refuses roles that are actually strong fits.

**Always assert the capture is clean before storing it** — cheap, and it is the
only thing that catches this:

```python
leftover = len(re.findall(r"<[a-zA-Z/][^>]*>", t)) + len(re.findall(r"&(?:lt|gt|amp|nbsp|div|span|href);", t))
assert leftover == 0, f"markup leaked: {leftover}"
```

A second tell: if `job match` lists `href`, `div`, `br`, `li`, `ul`, `nbsp`, or
`span` in either `covered` or `missing`, the stored JD is polluted — re-capture
and re-score rather than trusting the number.

**Bonus — stored match scores go stale.** `job show` prints the score recorded
at capture time. `job match <id>` recomputes. Five Databricks reqs sat on the
board reading 8–26 and recomputed to 81–92. A suspiciously low score on a
company you have applied to is worth a re-score before you believe it.

**Verified:** 2026-10-03, Databricks board token, 885 jobs, 7 reqs liveness-checked
(6 live, 1 delisted), 2 JDs captured and re-scored clean.

## Greenhouse behind a company's own marketing site (verified 2026-10-04, Nextiva)

**Goal:** read and liveness-check a req when the company's careers page is marketing
site, not a Greenhouse-hosted board, and the board token is nowhere in the HTML.

**Naive approach fails:** the marketing page only embeds `greenhouse.js`. There is no
`job-boards.greenhouse.io/<tenant>` string, no `board_token`, and no iframe src in the
DOM, so token-hunting on the page finds nothing. LinkedIn's company page is also a dead
end here: the employer button is a `button` with no href and its `.click()` times out.

**Working path:**

1. Find the careers URL from the company's **own site navigation**, never by guessing a
   path. From `nextiva.com`, an `a[href]` innerText+href sweep matching
   `/career|job|hiring|join/i` returned the real one on the first try:
   `nextiva.com/company/careers`.
2. Read the listing rows with an `a[href*="gh_jid"]` sweep — that param is the give-away
   that the listing is Greenhouse-backed, and each row href
   (`.../careers-listing.html?gh_jid=<id>`) is a directly navigable posting. One
   `evaluate` returning `href :: title` for every row gets the **entire board** in a
   single call; on Nextiva that was all 27 listings, no pagination needed.
3. A posting's JD lives entirely in `domSnapshot()` — headings, `Responsibilities`,
   `Basic Qualifications`, `Preferred Qualifications` all render as plain ARIA text, so
   slice the snapshot rather than evaluating selectors (the `main p, li` extraction
   returns a flattened, order-shuffled 3KB blob; the snapshot is the reliable read).

**The board is also the test for an unpublished req.** A recruiter pitching a title that
does not appear on the company's own board is pitching either an unpublished seat, a
renamed posting, or a different req entirely. Diffing the pitch against the full board
inventory is cheap and is the only way to know which one before tailoring — do not
assume they are the same req.

## Double-escaped entities: decode to a fixed point, not once (verified 2026-10-05, Coupang)

**Goal:** capture a JD for `job match` and get a score that reflects the req.

**Naive approach fails — and it fails silently in the most expensive direction.**
The recipe above says "unescape **first**, then strip", and that is necessary but
not sufficient on boards like Coupang's. Much of the content carries
`&amp;nbsp;` (an escaped `&nbsp;`), so a **single** decode pass leaves a literal
`nbsp` in the output. The stored JD then looks like clean prose, `job match`
prints an ordinary-looking score, and nothing errors.

**The tell is in the `missing` list, and it moved real numbers by 20–55 points:**

| req | decode once | decode to fixed point |
|---|---|---|
| Staff Backend Engineer - K8 (Envoy) | 19 | **76** |
| Senior Staff Backend Engineer (IAM) | 25 | **79** |
| Senior Staff Backend Engineer (Service Mesh) | 20 | **74** |
| Senior Staff Backend Engineer - (K8) | 21 | **70** |
| Staff Backend Engineer - Intelligent Cloud | 65 | **83** |

`nbsp` — and `amp`, `quot`, `lt`, `gt`, `apos` — are junk vocabulary, so they
enter the denominator and drag the score down. A role that clears the
candidate's relevance floor can be silently gated out by a decoding bug. The
Envoy req scored 19/100 as "stretch" and is in fact one of the closest matches
on the board.

**Working path — decode repeatedly until the string stops changing:**

```js
function unescapeStable(s, maxPasses = 6) {
  let t = s;
  for (let i = 0; i < maxPasses; i++) {
    const next = t
      .replace(/&nbsp;/gi, ' ').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&#39;/gi, "'")
      .replace(/&#x27;/gi, "'").replace(/&amp;/gi, '&');
    if (next === t) break;          // fixed point reached
    t = next;
  }
  return t;
}
// decode -> strip tags -> unescapeStable again (second fixed-point pass)
```

**Assert before storing** — the recipe's leftover check stands, and on this board
it must run *after* the fixed-point decode:

```js
const audit = (t) => ({
  tags: (t.match(/<[a-zA-Z/][^>]*>/g) || []).length,
  ents: (t.match(/&(?:nbsp|lt|gt|quot|apos|amp|#39|#x27);/g) || []).length,
});
```

All 16 Coupang India reqs re-captured this way returned `tags=0 ents=0`.

**A board can also disagree with its own search facet.** Coupang's
`coupang.jobs` Bengaluru facet listed `7938018` "Staff Security Engineer (Data
Security Engineering)", but the board payload puts that req in **Seoul, South
Korea**. Trust the structured `location.name` from the API over the rendered
listing card when the two conflict.

## The file inputs swap out from under you after the first attach (verified 2026-10-12, Deliveroo)

**Goal:** attach resume AND cover letter on a tenant whose form has both
(`job-boards.greenhouse.io/deliveroo/jobs/8202442` — the `/apply` URL 404'd with
"the job board you were viewing is no longer active" while the posting page
returned 200 and carried the form behind its own Apply button; the posting page
is the apply page here).

**Naive approach fails:** query both `input[type="file"]` elements (ids `resume`
and `cover_letter`), DataTransfer one file onto each. After the first
`change` event, Greenhouse **re-renders and removes the consumed input** — the
second lookup returns null, and worse, the single change event can land the file
in BOTH groups (both chips showed the cover letter). A blind second attach then
throws on a null input and looks like a selector bug.

**Working path:**

1. Attach one file, wait ~1.5s, re-enumerate `input[type="file"]` — expect the
   consumed group's input to be gone and a chip (`paragraph <filename>` +
   `button "Remove file"`) in its place.
2. If the wrong file landed in a group, click that group's `Remove file` (first
   matching button = the topmost group, Resume/CV). The removed group's input
   reappears in the DOM, empty. DataTransfer the right file onto it by id.
3. Verify by chips, not by inputs: each group must show its own
   `paragraph <filename>`. Attach the resume LAST anyway (this tenant's upload
   shows a `progressbar` while Greenhouse processes the file — wait for the
   chip to replace it before submitting).
4. The India-tenant demographic survey (`India - Self-Identification Survey`)
   is entirely voluntary with its own consent toggle — leaving it untouched is
   a valid state; its trailing consent checkbox is only for answered questions.
5. Submit via `evaluate` `btn.click()` after `scrollIntoView`; success navigates
   to `/confirmation` ("Thank you for applying. Your application has been
   received."). No confirmation number; the URL + screenshot are the proof.

**Verified:** 2026-10-05, Coupang board token `coupang`, 688 reqs, 39
India-located, 16 captured and re-scored clean.

## A retitled req breaks id- and title-based liveness checks (verified 2026-10-05, Coupang)

A req pulled from an aggregator can be live on the company board under a
**different title and a different id**. Substring-matching the aggregator's
`gh_jid` against the board payload returns "not found", which reads exactly like
a delisting — and a delisted req gets closed.

Diff the JD **bodies** instead. Normalize both to lowercase, split on
whitespace, and count how many 8-word windows of A appear in B: **>90% = same
req under a new name**, **<30% = different posting**. On Coupang this separated
a retitled Bengaluru req (718/734 shared 8-grams, id and title both changed)
from a genuinely different Singapore req with a confusingly similar title
(154/726). No title-based or id-based check catches this; only the text does.
