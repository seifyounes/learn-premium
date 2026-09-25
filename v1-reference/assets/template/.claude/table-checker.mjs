#!/usr/bin/env node
/* ============================================================
   table-checker.mjs — content gate for src/data/*.js
   Layers:
     1. schema      — every module has the required pieces; counts string
                      matches the real array lengths; group values valid
     2. structural  — every walkthrough fill/mark selector resolves against
                      the table active at that step (tables carry forward,
                      a step may swap in a fresh one via step.table)
     3. arithmetic  — Σ/sum rows recomputed from fully-numeric columns
     4. exam        — bank sections/marks are internally consistent
     5. custom      — per-example assertions registered in CUSTOM below
                      (extend this list while authoring new content)
   Exit code 1 on any failure. Run from the site root: node .claude/table-checker.mjs
   Ships with the crash-course template — extend CUSTOM while authoring, and add
   a per-example assertion for every number the source solutions give you.
   ============================================================ */
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "data");
const win = {};
const ctx = vm.createContext({ window: win });
/* index.html's order, NOT alphabetical. A bank that builds itself from
   window.MODULES (a mock paper assembled by reference) loads after them in the
   page; loading it first here silently produced an empty paper that every
   assertion then passed. Files on disk but not in index.html are appended, so
   nothing is skipped. */
const files = (() => {
  const html = readFileSync(join(here, "..", "index.html"), "utf8");
  const declared = [...html.matchAll(/<script src="data\/([^"]+)"><\/script>/g)].map(m => m[1]);
  const onDisk = readdirSync(dataDir).filter(f => f.endsWith(".js")).sort();
  const ordered = ["site.js"].concat(declared.filter(f => f !== "site.js" && onDisk.includes(f)));
  return ordered.concat(onDisk.filter(f => !ordered.includes(f)));
})();
for (const f of files) {
  vm.runInContext(readFileSync(join(dataDir, f), "utf8"), ctx, { filename: f });
}

let pass = 0, fail = 0;
const bad = [];
function ok(cond, label) { if (cond) { pass++; } else { fail++; bad.push(label); } }
function num(s) {
  if (typeof s === "number") return s;
  if (typeof s !== "string") return NaN;
  const t = s.replace(/[≈~\s]/g, "").replace(/,/g, "");
  return /^-?\d+(\.\d+)?$/.test(t) ? parseFloat(t) : NaN;
}

/* ---------- selector validation (0-INDEXED, per walkthrough.js cellInfo:
   cells are "r"+ri+"c"+ci from 0-based forEach; sum:cN and head:cN also 0-based) ---------- */
function validSelector(sel, t) {
  if (!t) return false;
  const C = (t.cols || []).length, R = (t.rows || []).length;
  sel = String(sel).trim();
  if (sel === "all") return true;
  if (sel === "sum") return !!t.sum;
  let m;
  if ((m = /^c(\d+)$/.exec(sel))) return +m[1] < C;
  if ((m = /^r(\d+)$/.exec(sel))) return +m[1] < R;
  if ((m = /^r(\d+)c(\d+)$/.exec(sel))) return +m[1] < R && +m[2] < C;
  if ((m = /^sum:c(\d+)$/.exec(sel))) return !!t.sum && +m[1] < C;
  if ((m = /^head:c(\d+)$/.exec(sel))) return +m[1] < C;
  return false;
}

/* ---------- arithmetic: recompute Σ rows ---------- */
function checkTableSums(t, label) {
  if (!t || !t.sum || !t.rows || !t.rows.length) return;
  (t.cols || []).forEach((_, ci) => {
    const body = t.rows.map(r => num(r[ci]));
    const target = num(t.sum[ci]);
    if (body.some(Number.isNaN) || Number.isNaN(target)) return; // non-numeric column — structural only
    const s = body.reduce((a, b) => a + b, 0);
    const tol = 0.011 * t.rows.length + 1e-9; // displayed-rounding tolerance
    ok(Math.abs(s - target) <= tol, `${label} Σ col${ci + 1}: recomputed ${s} vs shown ${target}`);
  });
}

/* ---------- "given" data tables (U.given contract: {cap,cols,rows,note} | [..]) ---------- */
function checkGiven(label, g) {
  if (g == null) return;
  const list = Array.isArray(g) ? g : [g];
  list.forEach((s, gi) => {
    ok(!!(s && Array.isArray(s.cols) && s.cols.length && Array.isArray(s.rows) && s.rows.length), `${label} given[${gi}] has cols + rows`);
    if (!s || !Array.isArray(s.cols)) return;
    (s.rows || []).forEach((r, ri) => ok(Array.isArray(r) && r.length === s.cols.length, `${label} given[${gi}] row${ri} width ${r && r.length} == ${s.cols.length}`));
  });
}
/* a question must never list a dataset as a run of tuples ("1: T,T,+ · 2: …" or
   "(167,51,UW) (182,62,N)") — that is what `given` is for */
const TUPLE_RUN = /\d+: [^·]{1,40}· \d+: |\(\d[\d.]*,\s?\d[\d.]*,\s?[A-Za-z+−-]+\)\s*[·(]/;
function checkNoTupleRun(label, text) {
  if (typeof text !== "string") return;
  ok(!TUPLE_RUN.test(text), `${label} states its data as a table, not a tuple run`);
}

/* ---------- walk one worked example ---------- */
function checkWorked(mid, wi, ex) {
  const label = `m${mid} worked[${wi}] "${(ex.title || "").slice(0, 40)}"`;
  ok(!!ex.table || !!ex.tree, `${label}: has a table or a tree (TABLE METHOD is non-negotiable)`);
  checkGiven(label, ex.given);
  checkNoTupleRun(label, ex.statement);
  let current = ex.table || null;
  if (current) checkTableSums(current, `${label} t0`);
  (ex.steps || []).forEach((st, si) => {
    if (st.table) { current = st.table; checkTableSums(current, `${label} step${si} swap`); }
    for (const sel of (st.fill || [])) ok(validSelector(sel, current), `${label} step${si} fill "${sel}" resolves`);
    for (const sel of (st.mark || [])) ok(validSelector(sel, current), `${label} step${si} mark "${sel}" resolves`);
  });
}

/* ---------- schema per module ---------- */
const MODS = win.MODULES || {};
const ids = Object.keys(MODS).sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
ok(ids.length >= 1, `module count ${ids.length} >= 1`);
const groupKeys = ((win.SITE || {}).groups || []).map(g => g.key);
for (const id of ids) {
  const m = MODS[id];
  const L = `m${id}`;
  ok(!!(m.title && m.short && m.weight && m.summaryHtml), `${L} core fields present`);
  ok(Array.isArray(m.worked) && Array.isArray(m.flashcards) && Array.isArray(m.written), `${L} content arrays present`);
  ok(Array.isArray(m.rules) && Array.isArray(m.formulas) && Array.isArray(m.tips), `${L} rules/formulas/tips present`);
  if (m.group !== undefined && groupKeys.length) ok(groupKeys.includes(m.group), `${L} group "${m.group}" is declared in SITE.groups`);
  if (Array.isArray(m.videos)) {
    for (const v of m.videos) {
      ok(!!v.topic, `${L} video entry has topic`);
      if (!v.status && !v.local) ok(typeof v.url === "string" && v.url.startsWith("https://"), `${L} video "${v.topic}" url is https`);
      if (v.local) ok(typeof v.local === "string" && v.local.startsWith("_sources/"), `${L} local video "${v.topic}" points into _sources/`);
    }
  }
  if (typeof m.counts === "string") {
    const grab = re => { const g = re.exec(m.counts); return g ? +g[1] : null; };
    const w = grab(/(\d+)\s*worked/), c = grab(/(\d+)\s*cards/), q = grab(/(\d+)\s*written/);
    if (w !== null) ok(w === (m.worked || []).length, `${L} counts worked ${w} == ${(m.worked || []).length}`);
    if (c !== null) ok(c === (m.flashcards || []).length, `${L} counts cards ${c} == ${(m.flashcards || []).length}`);
    if (q !== null) ok(q === (m.written || []).length, `${L} counts written ${q} == ${(m.written || []).length}`);
  }
  (m.worked || []).forEach((ex, wi) => checkWorked(id, wi, ex));
  (m.written || []).forEach((q, qi) => { checkGiven(`${L} written[${qi}]`, q.given); checkNoTupleRun(`${L} written[${qi}]`, q.prompt); });
}

/* ---------- past-exam / final-problems vault (same walkthrough contract) ---------- */
for (const exam of (win.FINALS || [])) {
  ok(!!(exam.id && exam.title && Array.isArray(exam.questions) && exam.questions.length), `FINALS "${exam.id}" has id/title/questions`);
  (exam.questions || []).forEach((q, qi) => {
    if (q.placeholder) return;
    ok(!!q.id, `FINALS ${exam.id} q${qi} has id`);
    checkWorked("F:" + exam.id, qi, q);
  });
}

/* ---------- exam banks ---------- */
for (const key of ["MOCK_MIDTERM", "FINAL_SIM", "MOCK_FINAL"]) {
  const bank = win[key];
  if (!bank) continue;
  ok(Array.isArray(bank.sections) && bank.sections.length > 0, `${key} has sections`);
  let total = 0, qn = 0;
  for (const s of bank.sections || []) {
    for (const q of s.questions || []) {
      qn++;
      if (typeof q.marks === "number") total += q.marks;
      ok(!!(q.module && MODS[q.module]), `${key} q${qn} module tag "${q.module}" exists`);
      checkGiven(`${key} q${qn}`, q.given);
      checkNoTupleRun(`${key} q${qn}`, q.prompt || q.q);
    }
  }
  if (typeof bank.totalMarks === "number" && total > 0) {
    ok(total === bank.totalMarks, `${key} marks sum ${total} == declared ${bank.totalMarks}`);
  }
}

/* ---------- master rules: schema + every division in a formula is a stacked {a}/{b} ---------- */
{
  let nRules = 0;
  (win.RULES_MASTER || []).forEach((g, gi) => {
    ok(!!(g.title && Array.isArray(g.rules) && g.rules.length), `RULES group ${gi} has title + rules`);
    for (const r of g.rules || []) {
      nRules++;
      ok(!!(r.name && r.formula), `RULES group ${gi} rule "${r.name}" has name + formula`);
      const stripped = String(r.formula || "").replace(/\{[^{}]+\}\s*\/\s*\{[^{}]+\}/g, "");
      ok(!/\//.test(stripped), `RULES "${r.name}": every division in the formula is a stacked {a}/{b}`);
      ok(!/\{[^{}]*\{/.test(String(r.formula || "")), `RULES "${r.name}": no nested braces (one fraction level)`);
    }
  });
  ok(nRules > 0, `RULES_MASTER has ${nRules} rules`);
}

/* ---------- custom per-example assertions (extend while authoring) ---------- */
const CUSTOM = [
  // { label: "m8 SVM board example: W = [1, 0, -3]", fn: (w) => { ... return true; } },
];
for (const c of CUSTOM) {
  try { ok(!!c.fn(win), `custom: ${c.label}`); }
  catch (e) { ok(false, `custom threw: ${c.label} (${e.message})`); }
}

/* ---------- report ---------- */
console.log(`modules: ${ids.length} [${ids.join(", ")}]`);
console.log(`PASS ${pass}  FAIL ${fail}`);
if (fail) { console.log("Failures:"); for (const b of bad) console.log("  ✗ " + b); process.exit(1); }
