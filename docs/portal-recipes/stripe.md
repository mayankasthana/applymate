# stripe.com careers — liveness, office location, and finding sibling reqs

Stripe runs its own careers site (`stripe.com/careers`), not Greenhouse/Ashby/
Lever. There is no public JSON API and no aggregator shortcut. Single-posting
URLs are stable and directly navigable.

## Reading one posting and proving liveness

- **Goal:** read a Stripe JD and prove it is still accepting applications
  (prefs `livenesscheck` — required before staging anything).
- **Naive approach fails:** `WebFetch` on the listing URL returns
  `Provider rejected the model request` (model-side block, not a Stripe 403).
  There is no server-rendered fallback worth trying. Stripe also has **no
  "this role has closed" page** — a delisted req 404s, but a role that is
  closing soon stays fully rendered with a live apply button, so the button
  alone is the only liveness signal there is.
- **Working path:**
  - Navigate straight to the listing URL:
    `https://stripe.com/careers/listing/<slug>/<req-id>` (e.g.
    `.../staff-backend-engineer-datalake-platform/8035723`).
  - `await tab.playwright.waitForLoadState({ state: "domcontentloaded" })`.
  - `domSnapshot()` is enough. Liveness = a link whose accessible name is
    **"Apply now"** or **"Apply for this role"** in the sidebar `complementary`
    block. Both appear; either proves it.
  - The sidebar is the field source of truth — it renders
    `Company` / `Team` / **`Office location`** / `Employment type` as
    heading+definition pairs. This is the fastest authoritative read of where
    a req actually sits.
- **Apply URL shape:** `https://stripe.com/careers/apply/<slug>/<req-id>` —
  the listing's href carries the same slug and id, so never construct it by
  hand; read it from the snapshot.

### EU/EEA tell (matters for work-authorization screening)

A Dublin req links an **"EU applicant personal information notice"** at
`/eu-applicant-notice` right under the apply button. Its presence means the req
is an EU/EEA hire. Cross-check `answers` for
*"Are you legally authorized to work in the country in which you are applying"*
before spending any effort on an EU req — that field is hand-judged and must
never be autofilled with an India-only answer.

### In-office expectations paragraph (the location trap)

Every Stripe JD repeats a boilerplate paragraph:

> "Stripes in Stripe Delivery Center roles in Mexico City, Mexico, Bengaluru,
> India, and Dublin, Ireland work **100% from the office**."

It appears **twice** in the rendered page (once inside the "Who You Are"
article, once as its own `h2` section) and lists **all** Delivery Center
cities, not just the req's own. Do not read it as "this req is in Dublin" —
confirm the actual city from the sidebar **Office location** field. But do read
it as: *if* the sidebar says Bengaluru or Dublin, that req is 100% on-site.

## Finding sibling reqs at the same company (the high-value move)

- **Goal:** a req is blocked on location/eligibility — find a location-clean
  sibling at the same company before closing it.
- **Naive approach fails:** the blocked req's own team rarely has an
  India-based clone. "Datalake" at Stripe returned exactly one result — the
  blocked Dublin one — which reads as "no alternative here" and invites a
  premature close.
- **Working path:** search on the **function**, not the team name.
  `https://stripe.com/careers/search?query=data%20platform` returned, in one
  pass, a Bengaluru req nobody had on the board:
  - `Software Engineer, Stripe Data Pipeline` — Data Platform, **Bengaluru**,
    7+ years (vs the Dublin req's 10+), petabytes daily, multi-tenant SLAs.
  - `Staff Engineer, Core Infrastructure` — **Bengaluru**, 12+ years.
  - `Staff Backend Engineer, Datalake Platform` — Dublin HQ (the blocked one).
- The results list is plain `innerText`, not an ARIA list — read it with a
  single bounded `playwright.evaluate` returning the slice between
  `"Clear all filters"` and the EEO boilerplate (`"Help us improve the
  conditions"`), which cleanly delimits the results from the page footer.
- To get req URLs without guessing, one `evaluate` over
  `a[href*="/careers/listing/"]` returning `{text, href}` pairs is enough.
  Never guess a req id.

**Why this matters:** the blocked Dublin Datalake req (match 87, pursuit green)
was sitting on the board looking like the best fit on it. The Bengaluru Data
Pipeline req scores 77 — *lower* — and clears every gate the Dublin one failed.
Match score ranks JD vocabulary overlap; it does not know about work
authorization or relocation. A high score on an ineligible req is worse than a
mid score on an eligible one.

**Verified:** 2026-10-03 — 5 listing reads (Dublin Datalake, Bengaluru Core
Infra, 2 search pages, Bengaluru Data Pipeline), all live with apply buttons
present. In-app browser only; `WebFetch` unusable on this domain.
