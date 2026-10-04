# deshawindia.com — D. E. Shaw India careers board

Mechanics of the public careers board (`https://www.deshawindia.com/careers`).
No candidate facts. Verified 2026-10-04.

## Reading the board

- The whole board is one page with category/location dropdowns ("I am
  interested in ___ at your ___ offices"). A counter reads
  `Viewing 4 of 78 Jobs`, and a `+74 Jobs` load-more element sits below the
  visible cards.
- **The counter lies about what is in the DOM.** After switching category,
  every job card for the selected category is present in the page as
  `<a href="/careers/<slug>-<id>">` even while the counter still says
  "Viewing 4 of N" and only 4 cards are visibly rendered. Collect the full
  list with one `evaluate` over `a[href*="/careers/"]` (filter the nav
  links: `/careers/faq`, `/careers/campus`, …) — do not bother with the
  load-more control. The `+N Jobs` paragraph is not reliably clickable
  (locator click times out waiting for actionability).
- Job detail pages are `/careers/<slug>-<numeric-id>` and are plain
  server-rendered text. The JD body sits between the job-title heading and
  the `Candidates with relevant experience…` legal boilerplate — slice
  `document.body.innerText` between those two anchors.

## Switching category (the dropdown fights Playwright)

**Naive approach fails** (verified 2026-10-04, IAB): the filter is a custom
dropdown, not a native `<select>`. The first click after page load works, but
subsequent `getByRole("button", { name: "open category options" })` clicks and
`getByRole("option", …)` clicks time out waiting for actionability — the
options stay "visible" in the ARIA tree but don't receive pointer events.

**Working path:** dispatch the same clicks from page context:

```js
// open the dropdown
await tab.playwright.evaluate(`(() => {
  const btn = Array.from(document.querySelectorAll('button')).find(b =>
    (b.getAttribute('aria-label') || '').includes('open category options'));
  if (btn) btn.click();
})()`);
// wait ~400ms, then click the option
await tab.playwright.evaluate(`(() => {
  const opts = Array.from(document.querySelectorAll('*')).filter(e =>
    e.children.length === 0 && (e.textContent || '').trim() === 'Core Tech');
  opts[opts.length - 1].click();   // LAST match, see below
})()`);
```

- **Take the last matching element for the option.** Category names also
  appear as marketing nav links elsewhere in the page (e.g. "Financial
  Research" exists both as an option and as a `/what-we-do/financial-research`
  nav link). The first match is the nav link and navigating away loses the
  filter; the last match is the actual listbox option. Check `location.href`
  after clicking to confirm no navigation happened.
- State is observable from `document.body.innerText`: the selected category
  text sits right after "I am interested in", and the counter reads
  `Viewing N of M Jobs` for the active filter.

## Board shape (2026-10-04)

Categories on the India board: Fresh Graduate Roles, Administration,
Core Tech, Financial Operations, Financial Research, Front Office Tech,
Human Capital, Legal, Product Management, Project Management Office,
Quality and Test Engineering, Systems. Engineering IC reqs live almost
entirely in Core Tech (23 reqs); Front Office Tech had exactly 1; Systems is
IT-infra/SRE track; Financial Research is analyst roles. There is no pay
information anywhere on the site — postings state no compensation.
