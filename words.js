/* =====================================================================
   VOCAB STRIKE — the player's own words.

   Anyone can add terms + definitions from the menu. They persist in
   localStorage and join the playable pool immediately: as the deck
   "My words", and also inside "All systems".

   Normalisation mirrors build_data.py — every target string must be
   something a US keyboard can actually produce, so symbols are rewritten
   (theta -> theta, em-dash -> -, root -> sqrt) and anything unmapped is
   dropped. The menu previews the result before you commit it.

   Shape matches data.js so the engine never has to special-case:
     { id, t, T, d, D, f, deck, dom, mine }
       t/T  term you type / term displayed
       d/D  definition you type / original definition
       f    formula (display only)
   ===================================================================== */
window.VS_WORDS = (() => {
  'use strict';

  const KEY = 'vocabstrike.words.v1';
  const DECKS = ['mine', 'ml', 'controls', 'mech'];

  /* Mirror of build_data.py SYMBOLS (same keys, same replacements). */
  const SYMBOLS = {
    '—': '-', '–': '-', '‐': '-', '‑': '-', '−': '-',
    '…': '...',
    '‘': "'", '’': "'", '“': '"', '”': '"',
    '·': '*', '×': '*', '⋅': '*', '•': '*',
    '√': 'sqrt ',
    '≤': '<=', '≥': '>=',
    '°': ' deg',
    '²': '^2', '³': '^3', '⁰': '^0', '⁴': '^4',
    '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4',
    '½': '1/2', '¼': '1/4', '¾': '3/4',
    'Δ': 'Delta ', 'Σ': 'Sum ',
    'α': 'alpha ', 'β': 'beta ', 'γ': 'gamma ', 'δ': 'delta ',
    'ε': 'epsilon ', 'ζ': 'zeta ', 'η': 'eta ', 'θ': 'theta ',
    'ι': 'iota ', 'κ': 'kappa ', 'λ': 'lambda ', 'μ': 'mu ',
    'ν': 'nu ', 'ξ': 'xi ', 'π': 'pi ', 'ρ': 'rho ',
    'σ': 'sigma ', 'ς': 'sigma ', 'τ': 'tau ', 'υ': 'upsilon ',
    'φ': 'phi ', 'χ': 'chi ', 'ψ': 'psi ', 'ω': 'omega ',
    'Γ': 'Gamma ', 'Θ': 'Theta ', 'Λ': 'Lambda ', 'Ω': 'Ohm ',
  };

  /* Python's build_data.py sanitize(): whitespace -> space, mapped symbols
     -> ASCII, printable ASCII kept, everything else dropped, runs of
     spaces collapsed, ends trimmed. */
  function sanitize(s) {
    let out = '';
    for (const ch of String(s == null ? '' : s)) {
      const c = ch.charCodeAt(0);
      if (/\s/.test(ch)) out += ' ';
      else if (Object.prototype.hasOwnProperty.call(SYMBOLS, ch)) out += SYMBOLS[ch];
      else if (c < 128 && c >= 32 && c !== 127) out += ch;
    }
    return out.replace(/ {2,}/g, ' ').trim();
  }

  /* ---------------- storage ---------------- */
  let cache = null;
  const listeners = [];

  function emit() {
    for (const fn of listeners) { try { fn(entries()); } catch (err) { console.error(err); } }
  }

  function nextId() {
    return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function load() {
    if (cache) return cache;
    cache = [];
    try {
      const raw = localStorage.getItem(KEY);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) {
        for (const e of arr) {
          if (!e || typeof e.t !== 'string' || !e.t || typeof e.d !== 'string' || !e.d) continue;
          cache.push({
            id: String(e.id || nextId()),
            t: e.t, T: String(e.T || e.t),
            d: e.d, D: String(e.D || e.d),
            f: String(e.f || ''),
            deck: DECKS.indexOf(e.deck) >= 0 ? e.deck : 'mine',
            dom: 'custom',
            mine: true,
          });
        }
      }
    } catch (err) {
      console.warn('VS_WORDS: could not read saved words —', err.message);
      cache = [];
    }
    return cache;
  }

  function persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(cache));
    } catch (err) {
      console.warn('VS_WORDS: storage unavailable —', err.message);
    }
    emit();
  }

  /* ---------------- api ---------------- */
  function entries() { return load().slice(); }
  function count() { return load().length; }
  function find(t) {
    const key = String(t).toLowerCase();
    return load().find((e) => e.t.toLowerCase() === key) || null;
  }

  function makeEntry(term, def, formula, deck) {
    return {
      id: nextId(),
      t: sanitize(term), T: String(term).trim(),
      d: sanitize(def), D: String(def).trim(),
      f: String(formula == null ? '' : formula).trim(),
      deck: DECKS.indexOf(deck) >= 0 ? deck : 'mine',
      dom: 'custom',
      mine: true,
    };
  }

  function add(raw) {
    const term = String((raw && raw.term) || '').trim();
    const def = String((raw && raw.def) || '').trim();
    if (!term && !def) return { ok: false, error: 'Type a term and a definition first.' };
    const t = sanitize(term);
    const d = sanitize(def);
    if (!t) return { ok: false, error: 'Nothing typable in the term — use characters a keyboard can produce.' };
    if (!d) return { ok: false, error: 'Nothing typable in the definition — use characters a keyboard can produce.' };
    if (find(t)) return { ok: false, error: '"' + t + '" is already in your words.' };
    const entry = makeEntry(term, def, raw && raw.formula, raw && raw.deck);
    load().push(entry);
    persist();
    return { ok: true, entry };
  }

  function remove(id) {
    const list = load();
    const i = list.findIndex((e) => e.id === id);
    if (i < 0) return false;
    list.splice(i, 1);
    persist();
    return true;
  }

  function clear() {
    if (!load().length) return;
    cache = [];
    persist();
  }

  function exportJSON() {
    return JSON.stringify({ app: 'vocab-strike', kind: 'words', words: load() }, null, 2);
  }

  /* Accepts our own export file, a bare array of entries, or loose
     { term, definition } objects. De-duplicates against what is stored. */
  function importJSON(text) {
    const data = JSON.parse(text);
    const list = Array.isArray(data) ? data : (data && data.words);
    if (!Array.isArray(list)) throw new Error('expected a JSON array of words');
    let added = 0, skipped = 0;
    for (const raw of list) {
      const term = raw && (raw.t || raw.term || raw.T);
      const def = raw && (raw.d || raw.def || raw.D || raw.definition);
      if (typeof term !== 'string' || typeof def !== 'string') { skipped++; continue; }
      const t = sanitize(term), d = sanitize(def);
      if (!t || !d) { skipped++; continue; }
      if (find(t)) { skipped++; continue; }
      load().push(makeEntry(term, def, raw.f || raw.formula, raw.deck));
      added++;
    }
    persist();
    return { added, skipped };
  }

  function onChange(fn) {
    if (listeners.indexOf(fn) < 0) listeners.push(fn);
  }

  return { sanitize, entries, count, find, add, remove, clear, exportJSON, importJSON, onChange };
})();
