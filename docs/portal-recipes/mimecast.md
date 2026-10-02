# careers.mimecast.com — marketing careers site over a Workday tenant

Recipes for Mimecast's public careers site. Format and ground rules: [README.md](README.md).
Human pacing and the no-evasion rules in AGENTS.md govern everything here.

## WebFetch is blocked; the browser is not

**Goal:** read a Mimecast posting's full JD.

**Naive approach fails:** `WebFetch` on
`https://careers.mimecast.com/en/jobs/r6657/principal-software-engineer/` returns
**HTTP 403 Forbidden** with no body. It looks like the page is gone or private; it is
not.

**Working path:** open it in the browser. The page renders fully, including the
complete JD inside `<article>`, and the snapshot exposes the real ATS apply link.

## Reading a posting

**Goal:** title, location, posted date, liveness, and the apply URL.

**Working path:** the snapshot gives it directly —
`<h1>` is the title, and a `<list>` under it carries the `India - Bengaluru`
location link, the `Engineering` team link, and a `<time>` reading
`Posted 30+ Days Ago`. A stale `<time>` is not a liveness signal on its own; the
real check is that **`Apply Now` is present** and points at the ATS.

**Apply URL pattern (Workday tenant `mimecast.wd5.myworkdayjobs.com`):**

```
https://mimecast.wd5.myworkdayjobs.com/Mimecast-Careers/job/India---Bengaluru/Principal-Engineer_R6657-1/apply
```

Note the `-1` suffix — that is Workday's duplicate-posting counter, not a version
number. General form from [workday.md](workday.md); the Mimecast-specific parts are
the tenant host `wd5` and the `India---Bengaluru` location slug.

## Cookies

A consent dialog ("We care about your privacy") renders at the top with
`Accept All` / `Essential Only`. It did not block interaction on this site, but
dismiss it before clicking anything in the body — see
[eightfold-careers.md](eightfold-careers.md) for the case where the same banner
does block and covers the target control.

**Verified:** 2026-10-02 — R6657 (Principal Software Engineer, DMARC and Email
Security, India-Bengaluru) read in full and confirmed live via an active Apply Now
Workday link.
