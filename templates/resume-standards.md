# Resume standards — template

**This is a starter, not the real thing.** It carries the invariants that hold
for any candidate and marks the rest for you to fill in. The live copy lives in
`workspace/profile/notes.json` (gitignored, because it is yours, not the
repo's) and is what the agent actually reads:

```
node bin/applymate.ts profile note get resume-standards
```

Overwrite this file with your own content and load it:

```
node bin/applymate.ts profile note set resume-standards <your-file>.md
```

To keep a copy outside git (the note is gitignored, so git is not its backup):

```
node bin/applymate.ts profile note export resume-standards ~/somewhere/safe.md
```

---

## Fill these in — the agent asks for them rather than guessing

- **Open source and projects to name.** Which upstream work, which projects,
  and the exact wording for each.
- **Awards, hackathons, labs, notable projects** that must appear.
- **Standing content requirements** (a summary clause? a skills section? a
  particular framing for a domain?).
- **The filename convention** for the file you upload to portals.
- **Any wording corrections** where the obvious phrasing is wrong — e.g. how to
  describe contributions that landed through a maintainer workflow.

## The invariants — these hold for everyone, refine them if you like

- **One title per line.** Every position is its own block: company line, then
  the title alone on its own line, then the date range alone on the next line.
  Never join two titles, or a title and its dates, with separators on one line —
  ATS parsers mangle that.
- **Meta lines are parser-fed.** Portal resume parsers autofill forms from the
  company and date lines: company line is plain text `Company, City, Country` —
  no heading markup, parentheses, sub-brands, or em dashes; date line is
  exactly `MMM YYYY – MMM YYYY` with nothing else (no italics, no inline notes);
  context paragraphs are plain text, never italic.
- **Ship as a 2-page A4 PDF.** The stock `render` output has no print CSS and
  spills past 2 pages — apply a print stylesheet (≈9–10pt, tight A4 margins) and
  verify the page count. Print via Chrome DevTools Protocol (`Page.printToPDF`,
  `displayHeaderFooter: false`); a naive headless run bakes the local `file://`
  path and a timestamp into every page, which is a personal-data leak. Verify
  the header/footer strips are absent, not just the page count.
- **Generic filename on everything that leaves the machine.** The uploaded file
  must be named for the candidate only — never the target company, role, or
  site, since portals show the filename to recruiters. Per-company naming is for
  private dossier copies only.
- **Never name the target.** The resume never names the target company or the
  target role title — no header, objective, summary, or body line may contain
  either. Tailor the content, keep the document generic. The cover letter is
  where company and role are named.
