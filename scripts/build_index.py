#!/usr/bin/env python3
"""
Build the TJ console index — NB dockets edition.

The real intelligence in FreeFred is the docket index (29k rows of NB court appearances)
joined to CanLII decisions where they match. That is what TJ needs on the front of his
console: real people with real charges and real hearing dates that we already have public
sources for.

Reads:
  ../src_freefred/freefred/index/dockets.jsonl   (29k docket rows)
  ../src_freefred/freefred/index/canlii_nb.jsonl (9 curated CanLII cases)
  ../src_freefred/freefred/index/joins.jsonl     (11k dockets ↔ CanLII joins)
  ../src_freefred/freefred/canon/*.md            (doctrine)
  ../src_canfree/canfree/**                       (cross-reference source for shared names)

Outputs:
  ../tj-console/data/people.json      (NB persons, roles inferred, mentions with source URLs)
  ../tj-console/data/dockets.json     (compact docket rows: name, charge, date, court, PDF url)
  ../tj-console/data/cases.json       (CanLII cases with real URLs)
  ../tj-console/data/canon.json       (FreeFred doctrine files)
  ../tj-console/data/stats.json       (headline numbers for the console)
"""
import json
import re
from pathlib import Path
from collections import defaultdict, Counter

FF = Path("/home/user/workspace/src_freefred/freefred")
CF = Path("/home/user/workspace/src_canfree/canfree")
OUT = Path("/home/user/workspace/tj-console/data")
OUT.mkdir(parents=True, exist_ok=True)

FF_BLOB = "https://github.com/EVEglyphDesign/freefred/blob/main/"
CF_BLOB = "https://github.com/EVEglyphDesign/canfree/blob/main/"

# ---------- Charge code → plain-English map (Criminal Code + NB MVA highlights) ----------
CHARGE_MAP = {
    # Criminal Code sections seen in NB dockets
    "CC (266)": "Assault",
    "CC (267)": "Assault with a weapon / causing bodily harm",
    "CC (268)": "Aggravated assault",
    "CC (270)": "Assaulting a peace officer",
    "CC (271)": "Sexual assault",
    "CC (272)": "Sexual assault with a weapon",
    "CC (273)": "Aggravated sexual assault",
    "CC (279)": "Kidnapping / forcible confinement",
    "CC (320.14)": "Impaired operation",
    "CC (320.15)": "Refusal to provide sample",
    "CC (320.16)": "Impaired operation causing bodily harm",
    "CC (334)": "Theft",
    "CC (348)": "Break and enter",
    "CC (354)": "Possession of property obtained by crime",
    "CC (355)": "Trafficking in property obtained by crime",
    "CC (367)": "Forgery",
    "CC (380)": "Fraud",
    "CC (430)": "Mischief",
    "CC (733.1)": "Breach of probation",
    "CC (145)": "Failure to appear / breach of undertaking",
    # NB MVA
    "MV (345)": "Motor Vehicle Act — dangerous / careless driving",
}


def humanize_charge(code: str) -> str:
    if not code:
        return "Unknown"
    # Take just the section portion, e.g. "CC (354)(1)(a)" -> match "CC (354)"
    m = re.match(r"([A-Z]{2}\s+\(\d+(?:\.\d+)?\))", code)
    key = m.group(1) if m else code
    return CHARGE_MAP.get(key, code)


def normalize_name(raw: str) -> str:
    # Dockets store "Last, First Middle". Normalize to "First Middle Last".
    if "," in raw:
        last, rest = raw.split(",", 1)
        rest = rest.strip()
        return f"{rest} {last.strip()}".strip()
    return raw.strip()


# ---------- Load FreeFred dockets ----------
print("Loading FreeFred docket index...")
docket_rows = []
with open(FF / "index/dockets.jsonl") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            docket_rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
print(f"  {len(docket_rows)} docket rows")

# ---------- Load CanLII cases ----------
print("Loading CanLII NB case index...")
canlii_rows = []
with open(FF / "index/canlii_nb.jsonl") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            canlii_rows.append(json.loads(line))
        except json.JSONDecodeError:
            continue
print(f"  {len(canlii_rows)} CanLII cases")

# ---------- Load joins ----------
print("Loading docket↔CanLII joins...")
joins = []
with open(FF / "index/joins.jsonl") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            joins.append(json.loads(line))
        except json.JSONDecodeError:
            continue
matched_joins = [j for j in joins if j.get("match_status") == "matched"]
print(f"  {len(joins)} joins ({len(matched_joins)} matched)")

# ---------- Build person index from dockets ----------
print("\nBuilding person index from dockets...")
persons = defaultdict(lambda: {
    "name": "",
    "docket_rows": [],       # references to docket_ids
    "charges": Counter(),    # charge_code -> count
    "hearing_dates": set(),
    "courtrooms": set(),
    "locations": set(),
    "levels": set(),         # Prov / QB / CA
    "languages": set(),
    "canlii_cases": set(),   # matched case_ids
})

# Build map: file_number -> canlii URL for quick lookup
file_to_canlii = {}
for j in matched_joins:
    fn = j.get("docket_file_number")
    cid = j.get("canlii_case_id")
    if fn and cid:
        # find case URL
        for c in canlii_rows:
            if c.get("case_id") == cid:
                file_to_canlii[fn] = {
                    "url": c.get("url"),
                    "citation": c.get("citation"),
                    "style_of_cause": c.get("style_of_cause"),
                    "case_id": cid,
                    "confidence": j.get("match_confidence"),
                    "signals": j.get("match_signals", []),
                }
                break

NON_PERSON_ENTITIES = {
    "his majesty the king", "her majesty the queen", "his majesty", "her majesty",
    "the king", "the queen", "the crown", "the attorney general",
    "attorney general of new brunswick", "attorney general of canada",
}

for row in docket_rows:
    raw_name = row.get("name", "")
    if not raw_name or raw_name.strip() in {"", "-"}:
        continue
    name = normalize_name(raw_name)
    if name.lower() in NON_PERSON_ENTITIES:
        continue
    key = name.lower()
    p = persons[key]
    p["name"] = name
    # keep only a compact docket handle
    row_id = f"{row.get('location','?')}_{row.get('file_number','?')}_{row.get('hearing_date','?')}"
    p["docket_rows"].append({
        "id": row_id,
        "file_number": row.get("file_number"),
        "charge_code": row.get("charge_code"),
        "charge_desc": humanize_charge(row.get("charge_code", "")),
        "hearing_date": row.get("hearing_date"),
        "hearing_time": row.get("hearing_time"),
        "courtroom": row.get("courtroom"),
        "floor": row.get("floor"),
        "location": row.get("location"),
        "level": row.get("level"),
        "lang": row.get("lang"),
        "appearance_type": row.get("appearance_type"),
        "source_pdf_url": row.get("source_url"),
        "canlii": file_to_canlii.get(row.get("file_number")),
    })
    p["charges"][row.get("charge_code", "?")] += 1
    if row.get("hearing_date"):
        p["hearing_dates"].add(row["hearing_date"])
    if row.get("courtroom") is not None:
        p["courtrooms"].add(str(row["courtroom"]))
    if row.get("location"):
        p["locations"].add(row["location"])
    if row.get("level"):
        p["levels"].add(row["level"])
    if row.get("lang"):
        p["languages"].add(row["lang"])
    fn = row.get("file_number")
    if fn and fn in file_to_canlii:
        p["canlii_cases"].add(file_to_canlii[fn]["case_id"])

print(f"  {len(persons)} unique persons in docket index")

# Convert to serializable list
final_people = []
for key, p in persons.items():
    charges_sorted = p["charges"].most_common()
    final_people.append({
        "id": re.sub(r"[^a-z0-9]+", "-", key).strip("-"),
        "name": p["name"],
        "surname": p["name"].split()[-1] if p["name"] else "",
        "docket_count": len(p["docket_rows"]),
        "distinct_files": len({r["file_number"] for r in p["docket_rows"] if r["file_number"]}),
        "top_charges": [{"code": c, "count": n, "desc": humanize_charge(c)} for c, n in charges_sorted[:5]],
        "all_charge_codes": [c for c, _ in charges_sorted],
        "hearing_dates": sorted(p["hearing_dates"]),
        "next_hearing": min(p["hearing_dates"]) if p["hearing_dates"] else None,
        "courtrooms": sorted(p["courtrooms"]),
        "locations": sorted(p["locations"]),
        "levels": sorted(p["levels"]),
        "languages": sorted(p["languages"]),
        "canlii_cases": sorted(p["canlii_cases"]),
        "dockets": p["docket_rows"][:20],  # cap per-person docket detail
    })

# Sort by docket count desc
final_people.sort(key=lambda x: (-x["docket_count"], x["name"]))

# ---------- Canon docs ----------
print("\nCollecting canon...")
canon_entries = []
for path in sorted((FF / "canon").rglob("*.md")):
    rel = path.relative_to(FF).as_posix()
    text = path.read_text(errors="replace")
    title_match = re.search(r"^#\s+(.+)$", text, re.MULTILINE)
    title = title_match.group(1).strip() if title_match else rel.replace("canon/", "").replace(".md", "").replace("-", " ").title()
    first_para = ""
    for para in text.split("\n\n"):
        pp = para.strip()
        if pp and not pp.startswith("#"):
            first_para = pp[:500]
            break
    canon_entries.append({
        "id": rel,
        "title": title,
        "summary": first_para,
        "source": "freefred",
        "source_url": FF_BLOB + rel,
        "repo_path": rel,
    })
print(f"  {len(canon_entries)} canon entries")

# ---------- CanLII cases as flat list ----------
cases = []
for c in canlii_rows:
    cases.append({
        "case_id": c.get("case_id"),
        "citation": c.get("citation"),
        "style_of_cause": c.get("style_of_cause"),
        "decision_date": c.get("decision_date"),
        "keywords": c.get("keywords"),
        "canlii_url": c.get("url"),
        "database": c.get("db"),
        "language": c.get("language"),
        "source_url": FF_BLOB + c.get("file_path", "") if c.get("file_path") else None,
    })

# ---------- Stats ----------
stats = {
    "docket_rows": len(docket_rows),
    "unique_persons": len(final_people),
    "canlii_cases": len(canlii_rows),
    "matched_joins": len(matched_joins),
    "canon_entries": len(canon_entries),
    "locations": sorted({r.get("location") for r in docket_rows if r.get("location")}),
    "levels": sorted({r.get("level") for r in docket_rows if r.get("level")}),
    "top_charges": Counter(r.get("charge_code", "?") for r in docket_rows).most_common(10),
    "sources": {
        "freefred": {
            "repo": "https://github.com/EVEglyphDesign/freefred",
            "public": True,
        },
        "canfree": {
            "repo": "https://github.com/EVEglyphDesign/canfree",
            "public": False,
            "note": "Private — cross-reference material available to org members.",
        },
    },
}

# ---------- Write ----------
(OUT / "people.json").write_text(json.dumps(final_people, separators=(",", ":")))
(OUT / "cases.json").write_text(json.dumps(cases, indent=2))
(OUT / "canon.json").write_text(json.dumps(canon_entries, indent=2))
(OUT / "stats.json").write_text(json.dumps(stats, indent=2))

print("\n=== WRITTEN ===")
print(f"people.json      {len(final_people)} persons  ({(OUT/'people.json').stat().st_size/1024:.1f} KB)")
print(f"cases.json       {len(cases)} cases")
print(f"canon.json       {len(canon_entries)} canon files")
print(f"stats.json       headline numbers")

print("\nTop 12 persons by docket count:")
for p in final_people[:12]:
    charges = ", ".join(f"{c['desc']} x{c['count']}" for c in p["top_charges"][:3])
    canlii = f" [CanLII match: {p['canlii_cases'][0]}]" if p["canlii_cases"] else ""
    print(f"  {p['docket_count']:3d}  {p['name']:30s}  {charges}{canlii}")

print(f"\nStats: {json.dumps({k:v for k,v in stats.items() if k not in ('top_charges','sources')}, indent=2)[:400]}")
