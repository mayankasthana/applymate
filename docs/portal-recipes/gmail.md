# gmail.com — reading the candidate's mail programmatically (IMAP)

Verified 2026-10-01.

## Goal

Read application confirmations, knock-out rejections, and recruiter replies for
evidence capture (`app evidence`, `job evidence`) without driving a browser, and
with exact timestamps.

## Naive approach fails

- **No Google API client is installed.** No `gcloud` binary, no
  `google-api-python-client`, no `google-auth`, no OAuth credential JSON on disk.
  `pip install` + an OAuth consent flow is the heavyweight path and is not
  available unattended.
- **Driving the Gmail web UI works but is the wrong tool.** It needs the in-app
  browser, renders each thread in local time with no timezone label, and its
  `#search/` results are noisy: a plain `walmart` query returns LinkedIn digest
  mail first, and searching bare requisition IDs (`R-2650329`) does **not**
  reliably match, because the ID sits in the body of a MIME part that the thread
  search does not index the way you expect.
- **`X-GM-RAW` search through Python `imaplib` fails to parse.** Passing
  `M.uid("search", None, "X-GM-RAW", "from:walmart newer_than:45d")` returns
  `imaplib.IMAP4.error: UID command error: BAD [b'Could not parse command']` —
  `imaplib._atom()` does not quote a value containing a colon *and* spaces. This
  is not a Gmail or credential problem; drop the extension and use standard
  IMAP search keys instead.

## Working path

The candidate has a Google **app password** in their `local-tooling` project `.env`,
under the keys `OFFERHAUL_GMAIL_ADDRESS` and `OFFERHAUL_GMAIL_APP_PASSWORD`. That
enables IMAP directly with the Python standard library — no install needed.

```python
import imaplib, email, re
from email.header import decode_header, make_header

M = imaplib.IMAP4_SSL("imap.gmail.com", 993)
M.login(address, app_password)              # app password, NOT the account password

# EXAMINE, not SELECT: opens read-only and never sets \Seen
M.select('"[Gmail]/All Mail"', readonly=True)

# Standard search keys only — X-GM-RAW does not survive imaplib's atom quoting
typ, data = M.uid("search", None, "FROM", "walmart", "SINCE", "01-Sep-2026")
for uid in data[0].split():
    typ, parts = M.uid("fetch", uid, "(BODY.PEEK[])")   # PEEK: don't set \Seen
```

Notes that matter:

- **`BODY.PEEK[]`**, not `BODY[]`. Fetching `[]` sets `\Seen` and mutates the
  candidate's mailbox state.
- **Select `[Gmail]/All Mail`**, not `INBOX`. Application receipts and some
  recruiter mail get labeled away from the inbox; searching only `INBOX`
  silently under-reports.
- **Walk all parts and prefer `text/plain`.** These messages are `text/html`
  with a `<style>` block as the first part, so naive payload decoding returns
  CSS, not prose. Strip tags after extraction.
- **ALWAYS dump the part tree before concluding a mail has no substance.**
  `multipart/mixed` wraps `multipart/alternative` (text/plain + text/html) and
  then **sibling attachment parts**. A walker that only descends for
  `text/plain`/`text/html` silently drops every attachment — verified
  2026-10-05, when a recruiter forward read as "no JD, no requisition, no
  requirements" and was registered on the board at 66/100 off the pitch alone.
  The JD was `application/pdf` attached as the third part; scoring against the
  real document moved it to **79/100 strong** and flipped the pursuit verdict
  amber → green. Print the tree first, cheaply, every time:

  ```python
  def show(m, depth=0):
      print("  "*depth, m.get_content_type(), "filename=", m.get_filename())
      if m.is_multipart():
          for p in m.get_payload(): show(p, depth+1)
  ```

- **Recursion guard is required, not optional.** `message/rfc822` and
  `multipart/digest` parts contain nested messages that re-enter the walker;
  without a depth cap or an explicit skip you get
  `RecursionError: maximum recursion depth exceeded` on ordinary forwarded mail.
  Skip those content types and cap depth.
- **Extract attachment bytes with `get_payload(decode=True)`** and write them
  next to the capture — a recruiter-attached JD PDF is the real JD, and it
  belongs in `job evidence --kind jd-screenshot` like any other capture.
- **ReportLab PDFs need a manual text pull.** These JDs (Kily, 2026-10-05) are
  ASCII85 + Flate with `Tj`/`TJ` operators; `pdftotext` is not installed and
  the file-read tool returns raw PDF internals. Decode per `stream…endstream`:
  `base64.a85decode` (strip a trailing `~>` first), then `zlib.decompress`,
  then collect `((…))` literals inside each `BT…ET` block. See the snippet in
  `scripts/` if one exists, otherwise re-derive from this note.
- **IMAP returns one message per MIME part, not per Gmail thread.** The web UI
  groups four Workday confirmations into one thread and shows "4"; IMAP returns
  them as four separate UIDs. Count accordingly.
- **Timestamps come back as RFC-2822 with an explicit offset** (`+0000`), which
  is strictly better than the web UI's local-time rendering. Convert once and
  keep UTC.

## Classifying the two shapes

Walmart Workday (and most ATSes) use two subject lines that must be told apart:

- `Thank you for Applying!` — submission receipt. Contains
  `Business Process: Job Application: <name> (Referral) - R-####### ROLE (C-########) on MM/DD/YYYY`.
- `Thank you for your interest` — knock-out rejection. Body reads *"At this time
  we have decided not to move forward with your application"*.

Match on the body phrase **`not to move forward`**, not `not move forward` — the
extra `to` is in the source text, and the tighter pattern silently classifies
rejections as confirmations.

## Ground rules

- **Read-only on this path.** `EXAMINE` + `BODY.PEEK[]` only. Never `STORE`, never
  `STOREFLAGS`, never `COPY`/`MOVE`, never append.
- **Never send over IMAP/SMTP with the app password.** Mail goes out through the
  candidate's own Gmail client with an explicit per-send approval; the app password
  exists to *read* evidence, not to send. To mail something, use the browser
  recipe below.
- **Never print or commit the app password.** Read it from the candidate's own
  `.env` at runtime; this file records only the variable names.

---

# Gmail web UI — composing and sending with attachments

The other half of gmail.com: when the candidate has authorised an outbound mail
(the resume handoff, a recruiter reply), it goes through the Gmail web UI in the
browser, never the IMAP credential above.

**Verified 2026-10-02** — 3-file resume mail composed, attached, sent, and confirmed
in the Sent folder.

## Getting to a usable compose window

**Goal:** an open compose with recipient, subject and body.

Gmail was already signed in as the candidate's account — check `title()` /
`location` before assuming you need a login, and never handle credentials. The
logged-in check is cheap: no `input[type=password]` on the page means the session is live.

**Naive approach fails (twice):**

1. `input[aria-label="To recipients"]` is **the wrong element and it is hidden.** It
   reports `display:block` but `width:0, height:0` — Gmail collapses the real
   recipients input until the row is focused, and keeps a second copy around for
   chip handling. `click()`/`type()` on it fail with *"waiting for click actionability
   (hidden)"*.
2. Typing into it also fails **across separate `js` calls.** Gmail re-collapses the
   input the moment focus leaves it, and every `js` call is a fresh kernel, so the
   expansion measured at the end of one call is gone by the next.

**Working path:** click the *visible row* to expand the input, then type, **in the
same `js` call**. The collapse is not a state you can re-enter from a later call.

```js
const row = tab.playwright.locator("div.aoD.hl");        // the visible recipients row
await row.click();
const to  = tab.playwright.locator('input[aria-label="To recipients"]');
await to.type("addr@example.com", { delay: 70 });
await to.press("Enter");                                 // commit the chip
```

Committing the chip collapses the input again — **that is success, not failure.** Read
the chip back out of the row rather than expecting the input to stay open:

```js
document.querySelector('div.aoD').innerHTML
// -> <span email="addr@example.com">Display Name</span>
```

Subject is `input[name="subjectbox"]` (visible, safe to `fill()` normally). Body is
`div[contenteditable="true"][aria-label="Message Body"]` — `click()` then `type()`;
`fill()` on a contenteditable does not take in Gmail's editor.

## Attaching PDFs — DataTransfer injection, no file chooser

Same `capability_unsupported` wall as LinkedIn (see
[linkedin.md](linkedin.md)): `waitForEvent("filechooser")` and `fileChooser.setFiles()`
are unavailable in IAB, and `setInputFiles` is not in the Playwright surface.

**Do not push the PDFs through as base64 in the tool call.** Three ~220KB PDFs is
~880KB of base64 in a single `evaluate` argument — unreadable, slow, and easy to
truncate. Instead serve the bytes from a loopback-only HTTP server and `fetch` them
inside the page.

This works despite Gmail being `https://`, because **`http://127.0.0.1` counts as a
potentially-trustworthy origin** and is exempt from mixed-content blocking. CORS still
applies, so the server must send `Access-Control-Allow-Origin: *` and answer `OPTIONS`.

```
node workspace/_capture/local-resume-server.mjs   # binds 127.0.0.1 only, one dir
```

Then, in the page:

```js
const dt = new DataTransfer();
for (const [path, name] of [["/trail", "…_Trail.pdf"], /* … */]) {
  const r = await fetch("http://127.0.0.1:8899" + path, { mode: "cors" });
  dt.items.add(new File([await r.arrayBuffer()], name, { type: "application/pdf" }));
}
const input = document.querySelector('input[type="file"][multiple]');
input.files = dt.files;
input.dispatchEvent(new Event("change", { bubbles: true }));
```

**Kill the server immediately after the send.** It is serving the candidate's resume
over a local port; the exposure is small but it should not outlive the task.

## Verifying before and after the send

**Read the attachment chips back — do not trust the assignment.** A silently dropped
`files` assignment still leaves a perfectly valid-looking compose box, which is the
exact failure mode that sends a resume-less email. This bit once on 2026-10-02: the
injection reported `assigned: 3`, and a DOM read for chips found **none**.

Worse, the obvious chip selectors (`.aQH`, `.aZo`, `span` inside the form) return
**empty even when all three files are correctly attached** — Gmail uses classes that
do not match the LinkedIn pattern. The selector going empty is not evidence of failure.

**Use a screenshot for this check.** It is the cheapest thing that is actually
decisive here: the compose window renders `Candidate_Resume_Trail.pdf (217K)`
per attachment, and the Sent row shows the same three PDF chips afterwards.

Send with `div[role="button"][aria-label^="Send"]`, then confirm **all three** signals:
a `[role="alert"]` reading `Message sent`, the compose window gone
(`div[aria-label="Message Body"]` absent), and the message at the top of `#sent` with
its attachment chips.

**Beware `getByText()` on a subject line to open the sent copy** — it resolved once,
then failed with *"waiting for click actionability (hidden)"*, and the stray
interaction left `in:sent` in the search box. A screenshot of the Sent list is both
safer and sufficient.

## Filenames on outgoing mail vs. portals

The generic-filename rule (`Candidate_Resume.pdf`) is a **portal-upload** rule:
portals show the attachment filename to recruiters, where a per-company name leaks the
target and makes one generic resume look bespoke.

**Email to a person is the opposite case.** One mail carrying three tailored resumes
with identical filenames is unusable — the recipient cannot tell them apart. Company
qualifiers on the *email attachment* names are correct and necessary.

Keep both: the generic-named PDF stays in `workspace/applications/<appId>/` for
portal upload, and company-named copies live wherever they are mailed from. Rename at
the point of injection, not by mutating the dossier copy.
