# smartrecruiters.com — reading postings via the public API

Verified 2026-10-02 on the Freshworks, Eurofins, SupplyHouse-adjacent and
Skillz-adjacent boards, plus the Corporate Experience sites that embed SR.

## Goal

Get a posting's full JD text without a browser, and liveness-check a posting the
sender only gave you through an aggregator (Bioksha et al.).

## Working path — no auth, no install

```
# one posting
GET https://api.smartrecruiters.com/v1/companies/<Org>/postings/<id>

# search a board (q, country, limit, offset)
GET https://api.smartrecruiters.com/v1/companies/<Org>/postings?limit=100&q=Principal%20Software%20Engineer&country=in
```

`Accept: application/json`, `curl --compressed` (the responses are gzipped and
binary-looking without it). One `postings` search page returns everything —
it is the cheapest way to liveness-check a role you only have an aggregator
link for.

Use the **org name as it appears in the `smartrecruiters.com/<Org>/` part of the
URL**, not the company's marketing name: `Eurofins` is `Eurofins`, `Freshworks`
is `Freshworks`, but a board can be regional (`ni/Eurofins`).

## The gotcha that costs a wasted fetch

`jobAd.sections` is a **dict keyed by section name**
(`companyDescription`, `jobDescription`, `qualifications`, `additionalInformation`),
**not a list**. Iterating it as a list of dicts raises
`AttributeError: 'str' object has no attribute 'get'`, and iterating `values()`
as strings returns only the section *names* — a JD that silently extracts to
139 characters of headings and nothing else.

```python
sections = d["jobAd"]["sections"]
body = "\n\n".join(strip_tags(v["text"]) for v in sections.values())
```

A clean extraction should land at 4–8k characters for a normal posting. **If you
get under ~1k, you iterated the wrong shape** — re-fetch rather than storing it.

## Liveness-checking an aggregator link

`api.smartrecruiters.com` search is the authority, not the aggregator page. On
2026-10-02 a Bioksha "Principal Software Engineer, Bengaluru" for Eurofins
resolved to live posting `744000151831800` / ref `REF79852B`, and the same board
showed **four** near-identical Principal Software Engineer reqs in Bengaluru
(`/744000151834004`, `/744000151833643`, `/744000151831829`, `/744000151798771`)
— so when several reqs share a title, confirm you are reading the intended one
and say so, since they are separate requisitions.

## Ground rules

- Mechanics only, no candidate data — this directory is committed.
- Read-only HTTP. Nothing here submits anything.
- Verified: 2026-10-02, 5 postings (Freshworks 1, Eurofins 1, plus board searches).