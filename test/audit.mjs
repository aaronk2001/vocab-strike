/**
 * Vocab audit — verifies every built-in entry has a real, typable definition.
 *
 *   node test/audit.mjs          human-readable report, exit 1 on any problem
 *
 * Checks per entry:
 *   - term (t) and typable definition (d) present and non-empty after trim
 *   - display term (T) and display definition (D) present (they may hold the
 *     original non-ASCII notation the game shows but never types)
 *   - definition is not a placeholder (N/A, TBD, null, ??? ...)
 *   - definition is not just a copy of the term
 *   - typable definition is ASCII-normalisable to >= 12 chars
 *   - deck/dom are known values
 * plus whole-list checks:
 *   - duplicate terms (case-insensitive, raw and after typing normalisation)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(ROOT, 'data.js'), 'utf8');
const m = src.match(/VOCAB\s*=\s*(\[.*\])\s*;?\s*$/s);
if (!m) { console.error('FATAL: data.js does not end with VOCAB = [...]'); process.exit(2); }
const VOCAB = JSON.parse(m[1]);

/* same normalisation the game/types use (build_data.py + words.js) */
const SYMBOLS = {
  'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'δ': 'delta', 'ε': 'epsilon', 'ζ': 'zeta',
  'η': 'eta', 'θ': 'theta', 'ι': 'iota', 'κ': 'kappa', 'λ': 'lambda', 'μ': 'mu',
  'ν': 'nu', 'ξ': 'xi', 'π': 'pi', 'ρ': 'rho', 'σ': 'sigma', 'τ': 'tau',
  'υ': 'upsilon', 'φ': 'phi', 'χ': 'chi', 'ψ': 'psi', 'ω': 'omega',
  'Δ': 'Delta', 'Ω': 'Omega', 'Σ': 'Sigma',
  '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~=', '±': '+-', '×': 'x', '÷': '/',
  '−': '-', '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"',
  '…': '...', '√': 'sqrt', '∞': 'inf', '·': '*', '→': '->', '←': '<-',
  '↔': '<->', '°': ' deg', 'µ': 'u',
};
const norm = (s) => s
  .replace(/[^\x00-\x7F]/g, (c) => (SYMBOLS[c] !== undefined ? SYMBOLS[c] : ''))
  .replace(/\s+/g, ' ')
  .trim();

const DECKS = new Set(['all', 'ml', 'controls', 'mech', 'mine']);
const PLACEHOLDER = /^(n\/?a|tbd|todo|null|undefined|none|test|\?+|\.+|-+|=+)$/i;
const MIN_TYPEABLE = 12;

const bad = [], warn = [];
const lenOf = (s) => norm(s).length;
let shortest = { n: Infinity, t: null }, longest = { n: 0, t: null };

for (const [i, e] of VOCAB.entries()) {
  const t = (e.t ?? '').trim(), d = (e.d ?? '').trim();
  const T = (e.T ?? '').trim(), D = (e.D ?? '').trim();
  const at = `#${i} ${t || '(no term)'}`;

  if (!t) bad.push(`${at}: empty term`);
  if (!d) bad.push(`${at}: EMPTY typable definition (d)`);
  else {
    if (PLACEHOLDER.test(d)) bad.push(`${at}: placeholder definition ${JSON.stringify(d)}`);
    if (d.toLowerCase() === t.toLowerCase()) bad.push(`${at}: definition is just the term`);
    if (lenOf(d) < MIN_TYPEABLE) bad.push(`${at}: typable definition only ${lenOf(d)} chars: ${JSON.stringify(d)}`);
    if (/\b(null|undefined)\b/i.test(d)) warn.push(`${at}: mentions null/undefined: ${d}`);
    const L = lenOf(d);
    if (L < shortest.n) shortest = { n: L, t };
    if (L > longest.n) longest = { n: L, t };
  }
  if (!T) warn.push(`${at}: display term (T) empty`);
  if (!D) warn.push(`${at}: display definition (D) empty`);
  if (!DECKS.has(e.deck)) bad.push(`${at}: unknown deck ${JSON.stringify(e.deck)}`);
  if (!e.dom) warn.push(`${at}: no domain (dom)`);
}

/* exact duplicates are a defect; case-insensitive collisions are only a
   warning because typing is case-insensitive by design (mAP vs map) */
const rawSeen = new Map();
VOCAB.forEach((e, i) => {
  const raw = (e.t ?? '').trim();
  if (rawSeen.has(raw)) bad.push(`duplicate term "${e.t}" — #${rawSeen.get(raw)} and #${i}`);
  else rawSeen.set(raw, i);
});

/* terms that become the SAME thing once normalised for typing (case-insensitive) */
const nc = new Map();
for (const e of VOCAB) {
  const k = norm(e.t ?? '').toLowerCase();
  if (!nc.has(k)) nc.set(k, []);
  nc.get(k).push(e.t);
}
const collisions = [...nc.entries()].filter(([, v]) => v.length > 1);

console.log(`VOCAB AUDIT — ${VOCAB.length} entries`);
console.log(`typable definition length: shortest ${shortest.n} chars (${shortest.t}), longest ${longest.n} chars (${longest.t})`);
const byDeck = {};
for (const e of VOCAB) byDeck[e.deck] = (byDeck[e.deck] || 0) + 1;
console.log('decks:', JSON.stringify(byDeck));
console.log('');

let failed = false;
if (bad.length) {
  failed = true;
  console.log(`PROBLEMS (${bad.length}):`);
  for (const b of bad) console.log('  x ' + b);
} else console.log('problems: none');

if (collisions.length) {
  console.log(`\ntypable-term collisions (${collisions.length}):`);
  for (const [k, v] of collisions) console.log(`  ! "${k}" <- ${JSON.stringify(v)}`);
} 

const dedupedWarn = [...new Set(warn)];
if (dedupedWarn.length) {
  console.log(`\nwarnings (${dedupedWarn.length}):`);
  for (const w of dedupedWarn) console.log('  ~ ' + w);
}

console.log('');
console.log(failed ? 'AUDIT FAILED' : 'AUDIT PASSED — every word has a definition');
process.exit(failed ? 1 : 0);
