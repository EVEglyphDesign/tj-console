# TJ Console

Private working console for **T.J. Burke**. Not an outreach page. Not a public campaign.

## What it is

A single-page browser console that puts three things in front of TJ:

1. **The NB person index** — every name we've observed across NB provincial and Queen's/King's Bench dockets, with charges (raw section + plain English), hearing dates, court locations, and links to the source PDFs and any matched CanLII decisions.
2. **The CanLII decisions on file** — with source URLs to canlii.org and to the mirrored copy in the FreeFred repo.
3. **A drop-in cross-reference box** — paste anything the police, Crown, or court sends (brief, disclosure, docket page, email). It tokenizes the text and matches file numbers, names, surnames, charge sections, CanLII citations, and NB locations against the repository. Results include public source links so every match is checkable.

## What it is not

- **Not the FreeFred outreach page.** That lives at `eveglyphdesign.github.io/freefred/`.
- **Not the Hawkins outreach page.** That lives at `eveglyphdesign.github.io/hawkins-twin-platform/`.
- **Not a signup surface.** No accounts, no forms, no crisis banner.
- **Not a public campaign.** `noindex,nofollow`.

## How it works

- Static site. Pure client-side. No backend, no tokens, no server. GitHub Pages hosts it.
- `data/*.json` is baked at build time from:
  - [`freefred/index/dockets.jsonl`](https://github.com/EVEglyphDesign/freefred/blob/main/index/dockets.jsonl) — 29k NB docket rows.
  - [`freefred/index/canlii_nb.jsonl`](https://github.com/EVEglyphDesign/freefred/blob/main/index/canlii_nb.jsonl) — curated NB CanLII cases.
  - [`freefred/index/joins.jsonl`](https://github.com/EVEglyphDesign/freefred/blob/main/index/joins.jsonl) — docket ↔ CanLII match records.
  - [`freefred/canon/*.md`](https://github.com/EVEglyphDesign/freefred/tree/main/canon) — doctrine.
- Cross-reference logic runs entirely in the browser. Nothing pasted into the drop-in box leaves the page.

## To rebuild the index

```bash
python3 scripts/build_index.py
```

Reads FreeFred/CanFree source repos at `/home/user/workspace/src_{freefred,canfree}/`, writes `data/*.json`.
