/* TJ Console — client-only cross-reference over FreeFred + CanFree public indexes */

const state = {
  people: [],
  cases: [],
  canon: [],
  stats: null,
  filtered: [],
  byName: new Map(),         // lowercase full name -> person
  bySurname: new Map(),      // lowercase surname -> [persons]
  byFileNumber: new Map(),   // file_number -> [persons]
  chargeCodes: new Set(),    // set of charge codes seen
};

// ---------- load ----------
async function loadJSON(path) {
  const r = await fetch(path, { cache: "no-store" });
  if (!r.ok) throw new Error(`fetch ${path}: ${r.status}`);
  return r.json();
}

async function boot() {
  try {
    const [people, cases, canon, stats] = await Promise.all([
      loadJSON("data/people.json"),
      loadJSON("data/cases.json"),
      loadJSON("data/canon.json"),
      loadJSON("data/stats.json"),
    ]);
    state.people = people;
    state.cases = cases;
    state.canon = canon;
    state.stats = stats;

    // build lookups
    for (const p of people) {
      state.byName.set(p.name.toLowerCase(), p);
      const s = p.surname.toLowerCase();
      if (!state.bySurname.has(s)) state.bySurname.set(s, []);
      state.bySurname.get(s).push(p);
      for (const d of p.dockets || []) {
        if (d.file_number) {
          if (!state.byFileNumber.has(d.file_number)) state.byFileNumber.set(d.file_number, []);
          state.byFileNumber.get(d.file_number).push({ person: p, docket: d });
        }
      }
      for (const c of p.top_charges || []) if (c && c.code) state.chargeCodes.add(c.code);
      for (const d of p.dockets || []) if (d && d.charge_code) state.chargeCodes.add(d.charge_code);
    }

    renderStats();
    populateFilters();
    applyFilters();
    renderCases();
    renderCanon();
    wireTabs();
    wireDropin();
  } catch (e) {
    console.error(e);
    document.getElementById("stat-row").innerHTML =
      `<div class="stat"><span class="n">!</span><span class="l">failed to load: ${e.message}</span></div>`;
  }
}

// ---------- stats ----------
function renderStats() {
  const s = state.stats;
  document.getElementById("stat-persons").textContent = state.people.length.toLocaleString();
  document.getElementById("stat-dockets").textContent = s.docket_rows.toLocaleString();
  document.getElementById("stat-locations").textContent = (s.locations || []).length;
  document.getElementById("stat-cases").textContent = s.canlii_cases.toLocaleString();
  document.getElementById("stat-matched").textContent = s.matched_joins.toLocaleString();
}

// ---------- filters ----------
function populateFilters() {
  const locSel = document.getElementById("filter-location");
  const lvlSel = document.getElementById("filter-level");
  const locations = new Set();
  const levels = new Set();
  for (const p of state.people) {
    (p.locations || []).forEach(l => locations.add(l));
    (p.levels || []).forEach(l => levels.add(l));
  }
  for (const l of [...locations].sort()) {
    const o = document.createElement("option");
    o.value = l; o.textContent = l.replace(/_/g, " ");
    locSel.appendChild(o);
  }
  for (const l of [...levels].sort()) {
    const o = document.createElement("option");
    o.value = l; o.textContent = l === "Prov" ? "Provincial Court" : (l === "QB" ? "Queen's / King's Bench" : l);
    lvlSel.appendChild(o);
  }
  document.getElementById("search").addEventListener("input", applyFilters);
  locSel.addEventListener("change", applyFilters);
  lvlSel.addEventListener("change", applyFilters);
  document.getElementById("filter-canlii").addEventListener("change", applyFilters);
}

function applyFilters() {
  const q = document.getElementById("search").value.trim().toLowerCase();
  const loc = document.getElementById("filter-location").value;
  const lvl = document.getElementById("filter-level").value;
  const onlyCanlii = document.getElementById("filter-canlii").value === "1";
  const words = q.split(/\s+/).filter(Boolean);

  const out = state.people.filter(p => {
    if (loc && !(p.locations || []).includes(loc)) return false;
    if (lvl && !(p.levels || []).includes(lvl)) return false;
    if (onlyCanlii && !(p.canlii_cases && p.canlii_cases.length)) return false;
    if (!words.length) return true;
    // combined haystack
    const hay = [
      p.name,
      p.surname,
      ...(p.locations || []),
      ...(p.top_charges || []).map(c => c.desc + " " + c.code),
      ...(p.dockets || []).map(d => (d.file_number || "") + " " + (d.charge_desc || "")),
    ].join(" ").toLowerCase();
    return words.every(w => hay.includes(w));
  });

  state.filtered = out;
  document.getElementById("results-count").textContent = out.length.toLocaleString();
  renderPeople(out.slice(0, 200));  // cap visible for perf
}

// ---------- people render ----------
function renderPeople(list) {
  const host = document.getElementById("people-list");
  host.innerHTML = "";
  const tpl = document.getElementById("person-card-tpl");
  for (const p of list) {
    const node = tpl.content.cloneNode(true);
    node.querySelector(".person-name").textContent = p.name;

    const tags = node.querySelector(".person-tags");
    if (p.canlii_cases && p.canlii_cases.length) {
      const t = document.createElement("span");
      t.className = "tag canlii";
      t.textContent = `CanLII · ${p.canlii_cases[0]}`;
      tags.appendChild(t);
    }
    const ct = document.createElement("span");
    ct.className = "tag count";
    ct.textContent = `${p.docket_count} appearances`;
    tags.appendChild(ct);

    const charges = node.querySelector(".person-charges");
    charges.innerHTML = (p.top_charges || []).slice(0, 3).map(c => {
      const desc = escapeHTML(c.desc);
      const code = escapeHTML(c.code);
      // if we don't have a plain-English description (desc === code), show just the code once
      if (desc === code) {
        return `<div>· <code>${code}</code> × ${c.count}</div>`;
      }
      return `<div>· ${desc} <code>${code}</code> × ${c.count}</div>`;
    }).join("");

    const meta = node.querySelector(".person-meta");
    const parts = [];
    if (p.locations && p.locations.length) parts.push(p.locations.map(l => l.replace(/_/g, " ")).join(", "));
    if (p.next_hearing) parts.push(`next: ${escapeHTML(p.next_hearing)}`);
    if (p.distinct_files) parts.push(`${p.distinct_files} file no.`);
    meta.textContent = parts.join(" · ");

    const rows = node.querySelector(".docket-rows");
    for (const d of (p.dockets || []).slice(0, 15)) {
      const row = document.createElement("div");
      row.className = "docket-row";
      const canliiBit = d.canlii
        ? ` · <a href="${d.canlii.url}" target="_blank" rel="noreferrer">${escapeHTML(d.canlii.citation || d.canlii.case_id)}</a>`
        : "";
      row.innerHTML = `
        <div class="r1">${escapeHTML(d.charge_desc)} <code>${escapeHTML(d.charge_code || "")}</code></div>
        <div class="r2">${escapeHTML(d.hearing_date || "?")} · ${escapeHTML(d.hearing_time || "")} · ${escapeHTML(d.location || "")} ${escapeHTML(d.level || "")} · CR ${escapeHTML(String(d.courtroom || "?"))} · file <code>${escapeHTML(d.file_number || "?")}</code>${canliiBit}</div>
        <div class="r2"><a href="${d.source_pdf_url}" target="_blank" rel="noreferrer">Docket PDF</a></div>
      `;
      rows.appendChild(row);
    }

    host.appendChild(node);
  }
}

// ---------- cases render ----------
function renderCases() {
  const host = document.getElementById("cases-list");
  host.innerHTML = state.cases.map(c => `
    <div class="case-card">
      <h3>${escapeHTML(c.style_of_cause || c.case_id)} — <span style="color:var(--muted);font-weight:400">${escapeHTML(c.citation || "")}</span></h3>
      <div class="meta">${escapeHTML(c.decision_date || "")} · ${escapeHTML((c.database || "").toUpperCase())} · ${escapeHTML((c.language || "").toUpperCase())}</div>
      ${c.keywords ? `<div class="keywords">${escapeHTML(c.keywords)}</div>` : ""}
      <div class="links">
        ${c.canlii_url ? `<a href="${c.canlii_url}" target="_blank" rel="noreferrer">CanLII source</a>` : ""}
        ${c.source_url ? `<a href="${c.source_url}" target="_blank" rel="noreferrer">Mirror in repo</a>` : ""}
      </div>
    </div>
  `).join("");
}

// ---------- canon render ----------
function renderCanon() {
  const host = document.getElementById("canon-list");
  host.innerHTML = state.canon.map(c => `
    <div class="canon-card">
      <h3>${escapeHTML(c.title)}</h3>
      <p>${escapeHTML(c.summary || "").slice(0, 320)}</p>
      <a href="${c.source_url}" target="_blank" rel="noreferrer">Open ${escapeHTML(c.repo_path)}</a>
    </div>
  `).join("");
}

// ---------- tabs ----------
function wireTabs() {
  const tabs = document.querySelectorAll(".tab");
  tabs.forEach(t => t.addEventListener("click", () => {
    tabs.forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    const which = t.dataset.tab;
    document.querySelectorAll(".tab-panel").forEach(p => {
      p.hidden = p.dataset.panel !== which;
    });
  }));
}

// ---------- drop-in cross-reference ----------
function wireDropin() {
  document.getElementById("btn-crossref").addEventListener("click", runCrossref);
  document.getElementById("btn-clear").addEventListener("click", () => {
    document.getElementById("dropin").value = "";
    document.getElementById("crossref-results").hidden = true;
  });
  document.getElementById("btn-sample").addEventListener("click", () => {
    document.getElementById("dropin").value = SAMPLE_BRIEF;
    runCrossref();
  });
}

// Regex tokenizers for real signals in police / Crown / court text
const FILE_NUM_RE = /\b(\d{7,9})\b/g;                                  // NB file numbers are ~8 digits
const CHARGE_SEC_RE = /\b(?:s\.?|section)\s*(\d{2,3}(?:\.\d+)?(?:\(\d+\))*(?:\([a-z]\))?)/gi;
const CANLII_CITE_RE = /\b(20\d{2})\s*(NBPC|NBKB|NBQB|NBCA)\s*(\d+)\b/gi;
const NAME_RE = /\b([A-Z][a-zA-Z\u00C0-\u017F'\-]+)\s+([A-Z][a-zA-Z\u00C0-\u017F'\-]+)(?:\s+([A-Z][a-zA-Z\u00C0-\u017F'\-]+))?\b/g;
const LOCATION_RE = /\b(Fredericton|Moncton|Saint\s+John|Bathurst|Miramichi|Campbellton|Edmundston|Woodstock)\b/gi;

const LOCATION_STOPWORDS = new Set([
  "The Court", "The Crown", "The Accused", "The Defendant", "The Applicant", "The Respondent",
  "New Brunswick", "Provincial Court", "Court Bench", "Court Appeal", "Criminal Code",
  "Chief Justice", "Attorney General", "Legal Aid", "Law Society",
  "First Appearance", "Second Appearance", "Trial Continuation", "Case Management",
]);

function runCrossref() {
  const text = document.getElementById("dropin").value;
  const host = document.getElementById("crossref-results");
  if (!text.trim()) {
    host.hidden = true;
    return;
  }
  host.hidden = false;

  // 1. file numbers
  const fileMatches = new Map();  // file_number -> [{person, docket}]
  for (const m of text.matchAll(FILE_NUM_RE)) {
    const fn = m[1];
    if (state.byFileNumber.has(fn)) fileMatches.set(fn, state.byFileNumber.get(fn));
  }

  // 2. names
  const nameHits = new Map();  // person.id -> {person, matched_snippet}
  for (const m of text.matchAll(NAME_RE)) {
    const first = m[1], middle = m[3] ? ` ${m[2]} ${m[3]}` : "", last = m[3] || m[2];
    const combos = [];
    if (m[3]) combos.push(`${first} ${m[2]} ${last}`);
    combos.push(`${first} ${last}`);
    for (const combo of combos) {
      if (LOCATION_STOPWORDS.has(combo)) continue;
      const lc = combo.toLowerCase();
      if (state.byName.has(lc)) {
        const p = state.byName.get(lc);
        if (!nameHits.has(p.id)) nameHits.set(p.id, { person: p, snippet: contextSnippet(text, m.index, m[0].length) });
      }
    }
    // surname-only fallback (common in briefs: "Boudreau was arrested...")
    const lastLc = (m[3] || m[2]).toLowerCase();
    if (state.bySurname.has(lastLc)) {
      for (const p of state.bySurname.get(lastLc)) {
        if (!nameHits.has(p.id)) nameHits.set(p.id, { person: p, snippet: contextSnippet(text, m.index, m[0].length), viaSurname: true });
      }
    }
  }
  // pure surname pass (single-word capitalized surnames appearing standalone)
  const surnameRe = /\b([A-Z][A-Z]{2,}|[A-Z][a-z]{2,})\b/g;
  for (const m of text.matchAll(surnameRe)) {
    const w = m[1].toLowerCase();
    if (state.bySurname.has(w)) {
      for (const p of state.bySurname.get(w)) {
        if (!nameHits.has(p.id)) nameHits.set(p.id, { person: p, snippet: contextSnippet(text, m.index, m[0].length), viaSurname: true });
      }
    }
  }

  // 3. CanLII citations
  const caseHits = new Map();  // case_id -> case
  for (const m of text.matchAll(CANLII_CITE_RE)) {
    const cite = `${m[1]} ${m[2].toUpperCase()} ${m[3]}`;
    const c = state.cases.find(x => (x.citation || "").toUpperCase() === cite.toUpperCase());
    if (c) caseHits.set(c.case_id, c);
  }

  // 4. charge sections — match by root section number (e.g. "320.16" matches "CC (320.16)(1)")
  const chargeHits = new Set();
  for (const m of text.matchAll(CHARGE_SEC_RE)) {
    const sec = m[1];
    const root = sec.match(/^(\d+(?:\.\d+)?)/)?.[1];  // strip any (n) suffixes
    if (!root) continue;
    for (const c of state.chargeCodes) {
      if (!c) continue;
      // charge code looks like "CC (320.16)(1)" or "CC (320.16)"
      const inner = c.match(/\((\d+(?:\.\d+)?)\)/)?.[1];
      if (inner === root) chargeHits.add(c);
    }
  }

  // 5. locations
  const locHits = new Set();
  for (const m of text.matchAll(LOCATION_RE)) {
    locHits.add(m[1].replace(/\s+/g, "_"));
  }

  // ---- render ----
  const totalHits = fileMatches.size + nameHits.size + caseHits.size + chargeHits.size + locHits.size;
  let html = `<div class="crossref-summary">
    <strong>${totalHits}</strong> cross-reference${totalHits === 1 ? "" : "s"} in the repository:
    ${nameHits.size} person${nameHits.size===1?"":"s"} ·
    ${fileMatches.size} file number${fileMatches.size===1?"":"s"} ·
    ${caseHits.size} CanLII decision${caseHits.size===1?"":"s"} ·
    ${chargeHits.size} charge section${chargeHits.size===1?"":"s"} ·
    ${locHits.size} NB location${locHits.size===1?"":"s"}.
  </div>`;

  if (nameHits.size) {
    html += `<div class="crossref-group"><h3>Persons matched</h3>`;
    for (const [, hit] of nameHits) {
      const p = hit.person;
      const via = hit.viaSurname ? ` <span class="tag">surname match</span>` : "";
      const canliiBit = p.canlii_cases && p.canlii_cases.length
        ? ` · <span class="tag canlii">CanLII ${escapeHTML(p.canlii_cases[0])}</span>` : "";
      html += `<div class="crossref-hit">
        <div class="hit-name">${escapeHTML(p.name)}${via}${canliiBit}</div>
        <div class="hit-meta">${p.docket_count} appearance${p.docket_count===1?"":"s"} · ${(p.top_charges||[]).slice(0,2).map(c=>escapeHTML(c.desc)).join(" · ")} · ${(p.locations||[]).map(l=>l.replace(/_/g," ")).join(", ")}${p.next_hearing?` · next ${escapeHTML(p.next_hearing)}`:""}</div>
        <div class="hit-meta"><em>context:</em> …${highlight(escapeHTML(hit.snippet), p.surname)}…</div>
        <div class="hit-links">
          ${(p.dockets||[]).slice(0,1).map(d=>d.source_pdf_url?`<a href="${d.source_pdf_url}" target="_blank" rel="noreferrer">Docket PDF</a>`:"").join("")}
          ${(p.dockets||[]).filter(d=>d.canlii).slice(0,1).map(d=>`<a href="${d.canlii.url}" target="_blank" rel="noreferrer">${escapeHTML(d.canlii.citation)}</a>`).join("")}
        </div>
      </div>`;
    }
    html += `</div>`;
  }

  if (fileMatches.size) {
    html += `<div class="crossref-group"><h3>File numbers matched</h3>`;
    for (const [fn, hits] of fileMatches) {
      for (const h of hits.slice(0, 3)) {
        const d = h.docket, p = h.person;
        html += `<div class="crossref-hit">
          <div class="hit-name">${escapeHTML(fn)} — ${escapeHTML(p.name)}</div>
          <div class="hit-meta">${escapeHTML(d.charge_desc)} <code>${escapeHTML(d.charge_code||"")}</code> · ${escapeHTML(d.hearing_date||"")} · ${escapeHTML(d.location||"")} ${escapeHTML(d.level||"")} · CR ${escapeHTML(String(d.courtroom||"?"))}</div>
          <div class="hit-links"><a href="${d.source_pdf_url}" target="_blank" rel="noreferrer">Docket PDF</a>${d.canlii?` · <a href="${d.canlii.url}" target="_blank" rel="noreferrer">${escapeHTML(d.canlii.citation)}</a>`:""}</div>
        </div>`;
      }
    }
    html += `</div>`;
  }

  if (caseHits.size) {
    html += `<div class="crossref-group"><h3>CanLII decisions matched</h3>`;
    for (const [, c] of caseHits) {
      html += `<div class="crossref-hit">
        <div class="hit-name">${escapeHTML(c.style_of_cause || c.case_id)} — ${escapeHTML(c.citation||"")}</div>
        <div class="hit-meta">${escapeHTML(c.decision_date||"")} · ${escapeHTML(c.keywords||"")}</div>
        <div class="hit-links"><a href="${c.canlii_url}" target="_blank" rel="noreferrer">CanLII source</a>${c.source_url?` · <a href="${c.source_url}" target="_blank" rel="noreferrer">Mirror in repo</a>`:""}</div>
      </div>`;
    }
    html += `</div>`;
  }

  if (chargeHits.size) {
    html += `<div class="crossref-group"><h3>Charge sections referenced</h3>`;
    for (const c of chargeHits) {
      const desc = describeCharge(c);
      html += `<div class="crossref-hit"><div class="hit-name"><code>${escapeHTML(c)}</code> — ${escapeHTML(desc)}</div></div>`;
    }
    html += `</div>`;
  }

  if (locHits.size) {
    html += `<div class="crossref-group"><h3>NB locations referenced</h3>`;
    for (const l of locHits) {
      const count = state.people.filter(p => (p.locations||[]).includes(l)).length;
      html += `<div class="crossref-hit"><div class="hit-name">${escapeHTML(l.replace(/_/g," "))}</div><div class="hit-meta">${count} persons in this location's docket index</div></div>`;
    }
    html += `</div>`;
  }

  if (totalHits === 0) {
    html += `<div class="crossref-hit">No matches. Try pasting more text — file numbers, surnames, charge sections, or citations like "2024 NBPC 12".</div>`;
  }

  host.innerHTML = html;
}

// ---------- helpers ----------
function contextSnippet(text, index, len) {
  const start = Math.max(0, index - 90);
  const end = Math.min(text.length, index + len + 90);
  return text.slice(start, end).replace(/\s+/g, " ").trim();
}
function highlight(html, needle) {
  if (!needle) return html;
  try {
    const re = new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
    return html.replace(re, "<mark>$1</mark>");
  } catch { return html; }
}
function escapeHTML(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function describeCharge(code) {
  const CHARGE_MAP = {
    "CC (266)": "Assault", "CC (267)": "Assault with weapon / bodily harm",
    "CC (270)": "Assault peace officer", "CC (271)": "Sexual assault",
    "CC (320.14)": "Impaired operation", "CC (320.15)": "Refusal to provide sample",
    "CC (320.16)": "Impaired operation causing bodily harm",
    "CC (334)": "Theft", "CC (348)": "Break and enter",
    "CC (354)": "Possession of property obtained by crime", "CC (380)": "Fraud",
    "CC (430)": "Mischief", "CC (733.1)": "Breach of probation",
    "CC (145)": "Failure to appear",
  };
  const m = code.match(/^([A-Z]{2}\s+\(\d+(?:\.\d+)?\))/);
  return (m && CHARGE_MAP[m[1]]) || "Charge on file";
}

// ---------- sample ----------
const SAMPLE_BRIEF = `Disclosure — R v Brooks
Court file: 12821505
Provincial Court, Fredericton
Charge: s.320.16(1) — impaired operation causing bodily harm

Ms. Jessie Lynn Brooks is next scheduled for hearing on Thursday, 02 July 2026, 09:30 AM,
Courtroom 5, floor 2, Fredericton Provincial Court.

Prior related decision: R v Brooks, 2024 NBPC 18 — see keywords "impaired operation — s.320.16".

Investigating detachment: Fredericton. Please also cross-reference file 12806405 (R v Boudreau,
2024 NBPC 12) which is being cited as a comparable in the Crown's sentencing brief.

Additional names appearing in disclosure: Boudreau, and constable references pending.`;

boot();
