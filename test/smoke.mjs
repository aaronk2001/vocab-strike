/* Play-tests Vocab Strike over the Chrome DevTools Protocol.
 *
 *   node test/smoke.mjs
 *
 * Loads index.html straight off file:// by default. Override the target with
 * VS_URL, and the browser with CHROME_PATH.
 *
 * Boots the page headless, starts a run, types real keystrokes through
 * VS.pressKey, walks DEFEND -> DECODE -> next wave -> hull loss -> game over,
 * captures screenshots, and fails on any console/page exception.
 */
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9341;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE_URL = process.env.VS_URL || pathToFileURL(path.join(HERE, '..', 'index.html')).href;
const SHOTS = path.join(HERE, 'shots');
const PROFILE = fs.mkdtempSync(path.join(os.tmpdir(), 'vocab-strike-'));

const problems = [];
const steps = [];
const ok = (m) => { steps.push('  ok   ' + m); console.log('  ok   ' + m); };
const fail = (m) => { problems.push(m); steps.push('  FAIL ' + m); console.log('  FAIL ' + m); };
function assert(cond, m) { if (cond) ok(m); else fail(m); }

/* injected into the page; returns the next key the player should hit */
const NEXT_KEY_HELPER = `(() => {
  window.__nextKey = function () {
    const S = window.VS.S;
    if (S.errKey) return 'Backspace';          // committed mistake: clear it first
    if (S.mode === 'defend') {
      const f = S.focus;
      if (f && f.prog < f.txt.length) return f.txt[f.prog];
      let n = null;
      for (const e of S.enemies) if (!n || e.x < n.x) n = e;
      return n ? n.txt[0] : null;
    }
    if (S.mode === 'decode') {
      if (S.cardState === 'typing' && S.cardProg < S.card.d.length) return S.card.d[S.cardProg];
      return null;
    }
    return null;
  };
  /* independent rAF heartbeat: if this stops ticking, requestAnimationFrame
     itself is dead (hidden page); if it keeps ticking while the game does
     not advance, the game's frame() loop died instead. */
  if (!window.__hbRunning) {
    window.__hbRunning = true;
    window.__hb = 0;
    (function tick() { window.__hb++; requestAnimationFrame(tick); })();
  }
  return true;
})()`;

/* samples page health across 1.5s of wall clock — used to explain stalls */
async function pageHealth() {
  const hb1 = await evalJS('window.__hb');
  const info = await evalJS(`({
    vis: document.visibilityState, hidden: document.hidden,
    mode: VS.S.mode, scene: VS.S.scene, cardState: VS.S.cardState,
    qi: VS.S.qi, prog: VS.S.cardProg, len: VS.S.card ? VS.S.card.d.length : null,
    hold: Math.round(VS.S.cardHold * 100) / 100, t: Math.round(VS.S.cardT * 100) / 100,
    queue: VS.S.queue.length
  })`);
  await sleep(1500);
  const hb2 = await evalJS('window.__hb');
  info.rafPerSec = Math.round(((hb2 - hb1) / 1.5) * 10) / 10;
  return info;
}

/* ---------------- chrome ---------------- */
function launch() {
  const proc = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
    '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--disable-background-networking',
    '--window-size=1440,900',
    `--user-data-dir=${PROFILE}`,
    `--remote-debugging-port=${PORT}`,
    '--remote-allow-origins=*',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  proc.stderr.on('data', () => {});
  return proc;
}

async function waitFor(fn, ms, what) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for ' + what);
    await sleep(80);
  }
}

/* ---------------- cdp ---------------- */
class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.onmessage = (e) => this.pump(e.data);
    ws.onerror = () => this.rejectAll(new Error('cdp socket error'));
    ws.onclose = () => this.rejectAll(new Error('cdp socket closed'));
  }
  rejectAll(err) {
    for (const [, p] of this.pending) p.rej(err);
    this.pending.clear();
  }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    return new CDP(ws);
  }
  on(fn) { this.handlers.push(fn); }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((res, rej) => this.pending.set(id, { res, rej }));
  }
  pump(raw) {
    const msg = JSON.parse(raw);
    if (msg.id) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
    } else {
      for (const h of this.handlers) h(msg);
    }
  }
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  console.log('[1] launching chrome');
  const chrome = launch();
  let cdp;

  try {
    const target = await waitFor(async () => {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await r.json();
      return list.find((t) => t.type === 'page');
    }, 20000, 'chrome target');
    console.log('[2] target found');

    cdp = await CDP.connect(target.webSocketDebuggerUrl);
    console.log('[3] cdp connected');
    cdp.on((m) => {
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        fail('page exception: ' + (d.exception?.description || d.text));
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        fail('console.error: ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
      }
      if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
        fail('log error: ' + m.params.entry.text);
      }
    });
    await Promise.all([cdp.send('Page.enable'), cdp.send('Runtime.enable'), cdp.send('Log.enable')]);

    const shot = async (name) => {
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SHOTS, name), Buffer.from(data, 'base64'));
    };
    const evalJS = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', {
        expression, awaitPromise: true, returnByValue: true,
      });
      if (r.exceptionDetails) throw new Error('eval failed: ' +
        (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    };

    /* ---------------- load ---------------- */
    console.log('[4] navigating');
    await cdp.send('Page.navigate', { url: PAGE_URL });
    await waitFor(() => evalJS('!!window.VS || "still-loading"').then((v) => v === true), 15000, 'game boot');
    console.log('[5] game booted');
    await sleep(600);
    await shot('1-menu.png');

    assert(await evalJS('VS.S.mode') === 'menu', 'boots into the menu');
    assert(await evalJS('document.querySelectorAll(".chip").length') >= 7,
      'deck + difficulty chips rendered');
    const nEntries = await evalJS('(window.VOCAB||[]).length');
    assert(nEntries === 286, `vocab loaded (${nEntries} entries)`);

    /* inject a helper that returns the next key the player should hit */
    await evalJS(NEXT_KEY_HELPER);

    /* ---------------- custom words ---------------- */
    console.log('[5b] custom word editor');
    assert(await evalJS('!!window.VS_WORDS'), 'custom word store is present');
    assert(await evalJS('VS_WORDS.count()') === 0, 'starts with no custom words');

    await evalJS('document.getElementById("addWordsBtn").click()');
    await sleep(250);
    assert(!(await evalJS('document.getElementById("wordsPanel").hidden')),
      '+ Add words opens the editor');
    assert(await evalJS('VS.S.mode') === 'menu', 'the editor keeps the game in the menu');

    await evalJS(`(() => {
      const set = (id, v) => { const el = document.getElementById(id);
        el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
      set('wTerm', 'flux capacitor');
      set('wDef', 'Stores \u03b8 energy \u2014 threshold \u2265 3 GW');
      set('wFormula', 'E = 1/2 C V^2');
      return true;
    })()`);
    const prev = await evalJS('document.getElementById("wPreview").textContent');
    assert(prev.indexOf('theta') >= 0, `preview shows what will be typed (${prev.slice(0, 60)}…)`);

    // a REAL Enter keystroke: must submit the form, not start a run
    await evalJS('document.getElementById("wTerm").focus()');
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, text: '\r',
    });
    await cdp.send('Input.dispatchKeyEvent', {
      type: 'keyUp', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13,
    });
    await sleep(300);

    assert(await evalJS('VS.S.mode') === 'menu', 'Enter in the term field does NOT start a run');
    assert(await evalJS('VS_WORDS.count()') === 1, 'Enter in the form adds the word');
    const w1 = await evalJS('VS_WORDS.entries()[0]');
    assert(w1 && w1.t === 'flux capacitor', `term stored as typed (${w1 && w1.t})`);
    assert(w1 && w1.d === 'Stores theta energy - threshold >= 3 GW',
      `definition normalised for typing (${w1 && w1.d})`);
    assert(w1 && w1.f === 'E = 1/2 C V^2', 'formula kept for display');
    assert(await evalJS('document.querySelectorAll("#wordsList li").length') === 1,
      'the word is listed in the editor');
    await shot('7-words.png');
    ok('captured the word editor');

    // duplicate protection
    await evalJS(`(() => {
      document.getElementById('wTerm').value = 'flux capacitor';
      document.getElementById('wDef').value = 'a different definition';
      return true;
    })()`);
    await evalJS('document.getElementById("wAdd").click()');
    await sleep(200);
    assert(await evalJS('VS_WORDS.count()') === 1, 'a duplicate term is rejected');
    assert((await evalJS('document.getElementById("wErr").textContent')).indexOf('already') >= 0,
      'the rejection explains itself');

    // export / import round trip
    const exp = JSON.parse(await evalJS('VS_WORDS.exportJSON()'));
    assert(Array.isArray(exp.words) && exp.words.length === 1, 'export produces a JSON word list');
    const again = await evalJS(`VS_WORDS.importJSON(${JSON.stringify(JSON.stringify(exp))})`);
    assert(again && again.added === 0 && again.skipped === 1,
      `re-importing the same file de-duplicates (${JSON.stringify(again)})`);
    const extra = [{ t: 'hall effect', d: 'Voltage proportional to a magnetic field' }];
    const got = await evalJS(`VS_WORDS.importJSON(${JSON.stringify(JSON.stringify(extra))})`);
    assert(got && got.added === 1, `importing a new word adds it (${JSON.stringify(got)})`);

    // play with the custom deck: your word becomes the ship
    await evalJS('document.getElementById("wordsClose").click()');
    await sleep(150);
    assert(await evalJS('document.getElementById("wordsPanel").hidden'), 'close button hides the editor');
    await evalJS(`[...document.querySelectorAll('#decks .chip')]
      .find((c) => /My words/.test(c.textContent)).click()`);
    assert(await evalJS('VS.S.deck') === 'mine', 'My words deck selected from the menu');
    const mineSub = await evalJS(`[...document.querySelectorAll('#decks .chip')]
      .find((c) => /My words/.test(c.textContent)).textContent`);
    assert(/2 terms/.test(mineSub), `deck chip counts the custom words (${mineSub})`);

    await evalJS('VS.start()');
    assert(await evalJS('VS.S.mode') === 'defend', 'the custom run starts in DEFEND');
    const tSpawn = Date.now();
    let shipTxt = null;
    while (Date.now() - tSpawn < 8000 && !shipTxt) {   // first spawn is timed at 0.55s
      shipTxt = await evalJS('VS.S.enemies.length ? VS.S.enemies[0].txt : null');
      if (!shipTxt) await sleep(100);
    }
    console.log('       first ship after ' + (Date.now() - tSpawn) + 'ms');
    assert(shipTxt === 'flux capacitor' || shipTxt === 'hall effect',
      `your word spawned as a ship (${shipTxt})`);

    let killedCustom = false;
    const tC = Date.now();
    while (Date.now() - tC < 20000) {
      const st = await evalJS('({ m: VS.S.mode, k: VS.S.killed, sal: VS.S.salvage.length })');
      if (st.k >= 1 && st.sal >= 1) { killedCustom = true; break; }
      if (st.m !== 'defend') break;
      const k = await evalJS('window.__nextKey()');
      if (k !== null) await evalJS(`VS.pressKey(${JSON.stringify(k)})`);
      await sleep(20);
    }
    assert(killedCustom, 'the custom term can be typed to destroy its ship');

    // clear the wave -> decode the salvaged custom definition
    await evalJS('VS.S.spawnLeft = 0; VS.S.enemies = [];');
    await sleep(1600);
    assert(await evalJS('VS.S.mode') === 'decode', 'clearing the wave opens DECODE');
    const card = await evalJS('VS.S.card ? { t: VS.S.card.t, d: VS.S.card.d } : null');
    const pairOK = card && (
      (card.t === 'flux capacitor' && card.d === 'Stores theta energy - threshold >= 3 GW') ||
      (card.t === 'hall effect' && card.d === 'Voltage proportional to a magnetic field'));
    assert(pairOK, `the salvaged card is your custom term + definition (${card && card.t})`);

    let decodedCustom = false;
    const tD = Date.now();
    while (Date.now() - tD < 30000) {
      const m = await evalJS('VS.S.mode');
      if (m === 'defend') { decodedCustom = (await evalJS('VS.S.decoded')) >= 1; break; }
      if (m !== 'decode') break;
      const k = await evalJS('window.__nextKey()');
      if (k !== null) await evalJS(`VS.pressKey(${JSON.stringify(k)})`);
      await sleep(20);
    }
    assert(decodedCustom, 'the custom definition types out and banks');

    await evalJS('VS.pressKey("Escape")'); await sleep(200);
    assert(await evalJS('VS.S.mode') === 'pause', 'Esc pauses the custom run');
    await evalJS('VS.pressKey("q")'); await sleep(200);
    assert(await evalJS('VS.S.mode') === 'menu', 'Q quits back to the menu');

    // wipe the test words and reboot to a pristine state
    await evalJS('VS_WORDS.clear()');
    await cdp.send('Page.navigate', { url: PAGE_URL });
    await waitFor(() => evalJS('!!window.VS || "still-loading"').then((v) => v === true),
      15000, 'reload after word cleanup');
    await sleep(500);
    assert(await evalJS('VS_WORDS.count()') === 0, 'custom words cleared from storage');
    assert(await evalJS('VS.S.deck') === 'all', 'deck reset to All systems');
    const badgeTxt = String(await evalJS('document.querySelector("#menu .badge").textContent'));
    assert(badgeTxt.indexOf('286') >= 0 && badgeTxt.indexOf('yours') < 0,
      `badge back to 286 terms (${badgeTxt.trim()})`);
    await evalJS(NEXT_KEY_HELPER);
    console.log('[5c] clean state restored');

    /* ---------------- start ---------------- */
    await evalJS('VS.start()');
    await sleep(400);
    assert(await evalJS('VS.S.mode') === 'defend', 'Enter starts a run -> DEFEND');
    assert(await evalJS('VS.S.waveSize') === 3, 'wave 1 sends 3 ships');
    assert(await evalJS('VS.S.hp') === 3, 'Operator difficulty = 3 hull');

    /* ---------------- backspace mechanic (DEFEND) ---------------- */
    const tS = Date.now();
    while (!(await evalJS('VS.S.enemies.length >= VS.S.waveSize'))) {
      if (Date.now() - tS > 12000) { fail('ships never finished spawning'); break; }
      await sleep(200);
    }
    const gb = await evalJS(`({
      wrong: ['q','x','z','j'].find((c) => !VS.S.enemies.some((e) => e.txt[0].toLowerCase() === c)),
      right: VS.S.enemies.slice().sort((a,b) => a.x - b.x)[0].txt[0],
      err0: VS.S.err
    })`);
    await evalJS(`VS.pressKey(${JSON.stringify(gb.wrong)})`);
    assert(await evalJS('VS.S.errKey') === gb.wrong, 'wrong key commits a pending mistake');
    assert(await evalJS('VS.S.err') === gb.err0 + 1, 'mistake costs accuracy');
    await evalJS(`VS.pressKey(${JSON.stringify(gb.right)})`);
    const dblk = await evalJS('({ f: VS.S.focus === null, e: VS.S.err, k: VS.S.errKey })');
    assert(dblk.f && dblk.e === gb.err0 + 1 && dblk.k === gb.wrong,
      'letters are ignored while a mistake is pending');
    await evalJS('VS.pressKey("Backspace")');
    assert(await evalJS('VS.S.errKey === null'), 'Backspace clears the pending mistake');
    await evalJS(`VS.pressKey(${JSON.stringify(gb.right)})`);
    const eng = await evalJS('({ f: !!VS.S.focus, p: VS.S.focus ? VS.S.focus.prog : 0 })');
    assert(eng.f && eng.p === 1, 'typing resumes after the clear (word engaged at 1/…)');

    /* ---------------- type wave 1 ---------------- */
    let sawShip = false, screenshots = 0;
    const t0 = Date.now();
    let mode = 'defend';
    while (Date.now() - t0 < 90000) {
      const r = await evalJS(`({
        mode: VS.S.mode, n: VS.S.enemies.length,
        p: VS.S.focus ? VS.S.focus.prog : 0,
        in: VS.S.enemies.every((e) => e.x < innerWidth - 190 && e.x > 140),
        key: window.__nextKey()
      })`);
      mode = r.mode;
      if (mode === 'decode') break;
      if (mode !== 'defend') { fail('unexpected mode during wave: ' + mode); break; }
      if (r.n > 0) sawShip = true;

      if (r.key !== null) {
        if (screenshots === 0) {
          // type a little first, then hold until every ship is fully in frame
          if (r.p >= 3 && r.in) {
            await shot('2-defend.png'); screenshots++;
            ok('captured DEFEND mid-run');
          } else if (r.p >= 3) {
            await sleep(150); continue;
          }
        }
        await evalJS(`VS.pressKey(${JSON.stringify(r.key)})`);
      }
      await sleep(15);
    }
    if (mode !== 'decode') console.log('       defend health:', JSON.stringify(await pageHealth()));
    assert(sawShip, 'ships spawned during DEFEND');
    assert(mode === 'decode', 'typing every term cleared the wave -> DECODE');

    const s1 = await evalJS('({ score: VS.S.score, adv: VS.S.adv, err: VS.S.err, killed: VS.S.killed, sal: VS.S.salvage.length })');
    console.log('       after defend:', JSON.stringify(s1));
    assert(s1.score > 0, `score accrued during DEFEND (${s1.score})`);
    assert(s1.adv > 10, `keystrokes counted (${s1.adv})`);
    assert(s1.killed === 3 && s1.sal === 3, 'all 3 ships destroyed and salvaged');

    /* ---------------- decode ---------------- */
    await sleep(1200);
    assert(await evalJS('VS.S.queue.length') === 3, 'decode queue holds 3 definitions');
    assert(await evalJS('VS.S.cardState') === 'typing', 'first definition is ready to type');
    await shot('3-decode.png');

    /* ---------------- backspace mechanic (DECODE) ---------------- */
    const dc = await evalJS(`({
      w: (VS.S.card.d[0].toLowerCase() === 'q' ? 'z' : 'q'),
      r: VS.S.card.d[0], p0: VS.S.cardProg, e0: VS.S.err
    })`);
    await evalJS(`VS.pressKey(${JSON.stringify(dc.w)})`);
    let dd = await evalJS('({ p: VS.S.cardProg, e: VS.S.err, k: VS.S.errKey })');
    assert(dd.k === dc.w && dd.p === dc.p0 && dd.e === dc.e0 + 1,
      'decode: wrong key commits a pending mistake');
    await evalJS(`VS.pressKey(${JSON.stringify(dc.r)})`);
    dd = await evalJS('({ p: VS.S.cardProg, e: VS.S.err, k: VS.S.errKey })');
    assert(dd.p === dc.p0 && dd.e === dc.e0 + 1 && dd.k === dc.w,
      'decode: letters are ignored while a mistake is pending');
    await evalJS('VS.pressKey("Backspace")');
    assert(await evalJS('VS.S.errKey === null'), 'decode: Backspace clears the mistake');

    let decodeShots = 0, bannerShots = 0;
    let lastState = '', stallSince = Date.now(), decodeStall = null;
    let it = 0, lastLog = Date.now();
    const t1 = Date.now();
    while (Date.now() - t1 < 150000) {
      const st = await evalJS(`({
        mode: VS.S.mode, s: VS.S.cardState, i: VS.S.qi, p: VS.S.cardProg,
        dec: VS.S.decoded, hb: window.__hb, key: window.__nextKey()
      })`);
      mode = st.mode;
      if (mode === 'defend') break;
      if (mode !== 'decode') { fail('unexpected mode during decode: ' + mode); break; }

      it++;
      if (Date.now() - lastLog > 5000) {
        lastLog = Date.now();
        console.log(`       decode t=${Math.round((Date.now() - t1) / 1000)}s it=${it} ` +
          `state=${st.s}/${st.i}/${st.p} dec=${st.dec} hb=${st.hb} last='${lastState}'`);
      }
      const stateKey = st.s + '/' + st.i + '/' + st.p;
      if (stateKey === lastState) {
        // banners legitimately hold up to ~2.1s; 15s of no movement is a stall
        if (!decodeStall && Date.now() - stallSince > 15000) {
          decodeStall = await pageHealth();
          fail('DECODE stalled: ' + JSON.stringify(decodeStall));
          break;
        }
      } else { lastState = stateKey; stallSince = Date.now(); }

      if (st.s !== 'typing' && bannerShots === 0) {
        await shot('4b-decode-done.png'); bannerShots++;
        ok('captured DECODE result banner');
      }
      if (st.key !== null) {
        await evalJS(`VS.pressKey(${JSON.stringify(st.key)})`);
        if (decodeShots === 0 && st.p > 15) {
          await shot('4-decode-progress.png'); decodeShots++;
          ok('captured DECODE mid-definition');
        }
      }
      await sleep(15);
    }
    if (mode !== 'defend' && !decodeStall) {
      console.log('       decode health:', JSON.stringify(await pageHealth()));
    }
    assert(mode === 'defend', 'finishing all definitions returns to DEFEND');
    const d1 = await evalJS('({ dec: VS.S.decoded, miss: VS.S.missed, wave: VS.S.wave, score: VS.S.score })');
    console.log('       after decode:', JSON.stringify(d1));
    assert(d1.dec === 3, `all 3 definitions typed correctly (${d1.dec})`);
    assert(d1.miss === 0, 'no definition timers expired');
    assert(d1.wave === 2, 'advanced to wave 2');
    assert(d1.score > s1.score, 'DECODE added score');

    /* ---------------- run it forward, then lose ---------------- */
    await sleep(500);
    assert(await evalJS('VS.S.waveSize') === 3, 'wave 2 also sends 3 ships');

    // stop typing and let a ship through with a single point of hull
    await evalJS('VS.S.hp = 1');
    const t2 = Date.now();
    let over = false;
    while (Date.now() - t2 < 60000) {
      mode = await evalJS('VS.S.mode');
      if (mode === 'over') { over = true; break; }
      if (mode === 'defend') {
        // deliberately miss: clear focus so nothing gets typed
        await evalJS('VS.S.focus = null');
      }
      await sleep(120);
    }
    assert(over, 'a ship reaching the hull ends the run');
    await sleep(500);
    await shot('5-gameover.png');
    assert(await evalJS('!document.getElementById("over").hidden'), 'game-over panel is visible');
    const fin = await evalJS(`({
      s: document.getElementById('oS').textContent,
      a: document.getElementById('oA').textContent,
      p: document.getElementById('oP').textContent,
      k: document.getElementById('oK').textContent,
      d: document.getElementById('oD').textContent
    })`);
    console.log('       results panel:', JSON.stringify(fin));
    assert(fin.a.endsWith('%'), 'accuracy rendered');
    assert(Number(fin.k) >= 3, 'ships stat rendered');
    assert(await evalJS('localStorage.getItem("vocabstrike.v1") !== null'), 'best score persisted to localStorage');

    /* ---------------- restart + pause ---------------- */
    await evalJS('VS.pressKey("Enter")');
    await sleep(300);
    assert(await evalJS('VS.S.mode') === 'defend', 'Enter restarts from game over');
    await evalJS('VS.pressKey("Escape")');
    await sleep(200);
    assert(await evalJS('VS.S.mode') === 'pause', 'Esc pauses');
    await shot('6-pause.png');
    await evalJS('VS.pressKey("Escape")');
    await sleep(200);
    assert(await evalJS('VS.S.mode') === 'defend', 'Esc resumes');

    /* ---------------- wrong keys cost accuracy ---------------- */
    const before = await evalJS('VS.S.err');
    await evalJS('VS.pressKey(String.fromCharCode(1))');
    const after = await evalJS('VS.S.err');
    assert(after === before + 1, 'a wrong key increments the error counter');

    if (screenshots === 0) await shot('2-defend.png');
  } catch (e) {
    fail(e.message);
  } finally {
    try { if (cdp) cdp.ws.close(); } catch {}
    try {   // page sockets can't close the browser; the browser socket can
      const v = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      await (await CDP.connect(v.webSocketDebuggerUrl)).send('Browser.close');
    } catch {}
    await Promise.race([new Promise((r) => chrome.once('exit', r)), sleep(5000)]);
    chrome.kill();
    try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }); } catch {}
  }

  console.log('\n' + '-'.repeat(58));
  const bad = problems.length;
  console.log(bad ? `${bad} FAILURE(S)` : 'ALL CHECKS PASSED');
  if (bad) problems.forEach((p) => console.log('  ! ' + p));
  console.log('screenshots -> ' + SHOTS);
  process.exit(bad ? 1 : 0);
}

main();
