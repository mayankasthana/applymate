# higher.gs.com — Goldman Sachs careers site

Recipes for driving Goldman Sachs's own careers platform (`higher.gs.com`).
Format and ground rules: [README.md](README.md). Role URLs are `/roles/<id>`;
the search page is `/results`. Verified 2026-10-12.

## Search commits only via a native in-page click

**Goal:** keyword + location search on the Find Opportunities page.

**Naive approach fails:** Playwright locator `click()`, `cua` coordinate click
with hover-travel, `dom_cua` node click, and Enter-in-the-textbox are ALL
swallowed — the counter stays "Showing 20 of 649 matches" with no error.

**Working path:** `playwright.evaluate` a native click on the submit button:

```js
await tab.playwright.evaluate(`(() => {
  const btn = document.querySelector('main form button[type="submit"]');
  btn.click();
  return btn.textContent.trim();
})()`);
```

The same applies to filter toggles (native `.click()` on the visible button;
filter by `offsetParent !== null` — duplicate hidden buttons exist).

## URL scheme (state the SPA writes back — navigate directly)

```
https://higher.gs.com/results?LOCATION=Bengaluru|Hyderabad|Mumbai&page=1&search=Data%20Engineering&sort=RELEVANCE
```

- `LOCATION` takes a pipe-joined city list. Checking the country checkbox
  (e.g. INDIA) expands it to its cities in the URL.
- Country/city checkboxes have **no `name`/`aria-label` attribute** — match
  them by `closest('label').innerText`.
- `page=N` paginates; results render 20 per page.

## Reading a JD

Role pages render client-side; `main.innerText` carries everything. The first
~1100 chars are division boilerplate — the req-specific text is in the
`Job Summary:` / `Your Impact` section (search from the end for these markers;
the boilerplate itself contains a "Job Summary" phrase, so `lastIndexOf`).
`L2` in a title (e.g. "The Core Engineering-L2-...") means a generic
cross-team requisition: the JD is division-level and names no team. Apply
links point at `hdpc.fa.us2.oraclecloud.com` (Oracle Cloud HCM — see
[oraclecloud.md](oraclecloud.md) for the apply flow).

Role pages show **no posted date**. LinkedIn mirrors carry posted-age and
applicant counts (`topcard__flavor` spans via the guest jobPosting endpoint —
see [linkedin.md](linkedin.md)); use them for the competition signal.

The site talks to a GraphQL gateway (`api-higher.gs.com/gateway/api/v1/graphql`)
— unexplored; page-context extraction worked fine without it.
