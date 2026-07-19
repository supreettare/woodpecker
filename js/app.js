// UI orchestration: wires the board, importer, storage, and session engine
// together and renders the two screens (Library + Trainer).

import { Board } from './board.js';
import { pieceSVG } from './pieces.js';
import { parseFile } from './import.js';
import { store } from './storage.js';
import { Session, fmtTime } from './trainer.js';
import { sound } from './sound.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Play the appropriate sound for a move based on its capture/check flags.
function moveSound(move) {
  if (!move) return;
  if (move.check) sound.check();
  else if (move.capture) sound.capture();
  else sound.move();
}

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

let board;
let session = null;
let activeSetId = null;
let puzzleTimer = null;
let puzzleDeadline = 0;
let cycleTicker = null;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  board = new Board($('#board'), { onMove });
  board.setPosition('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1');
  bindLibraryControls();
  migrateNames();
  await ensureDefaultSet();
  renderLibrary();
  showScreen('library');
}

// The bundled sets, ordered easiest → hardest. Each is loaded and tracked
// independently in the library.
const DEFAULT_SETS = [
  { id: 'set-woodpecker-beginner', file: 'woodpecker-beginner-1000.json', name: 'Beginner · 600–1000' },
  { id: 'set-woodpecker-1000', file: 'woodpecker-1000.json', name: 'Intermediate · 1300–1600' },
  { id: 'set-woodpecker-advanced', file: 'woodpecker-advanced-1000.json', name: 'Advanced · 1600–2000' },
];
const DEFAULT_SET_ID = 'set-woodpecker-1000'; // kept for backward-compatible migration

// Give existing users' stored intermediate set the new clearer name.
function migrateNames() {
  const s = store.getSet(DEFAULT_SET_ID);
  if (s && /Lichess CC0|^Woodpecker 1000$/.test(s.name)) {
    store.renameSet(DEFAULT_SET_ID, 'Intermediate · 1300–1600');
  }
}

// On first run (no sets yet), load all three bundled sets so the parent can
// pick the right level per child immediately. Fetch/parse (async) happens
// first, then the sets are written in one synchronous batch so their shared
// index can't be clobbered by an interleaved write.
let ensuring = false;
async function ensureDefaultSet() {
  if (ensuring || store.listSets().length) return;
  ensuring = true;
  const ready = [];
  for (const def of DEFAULT_SETS) {
    try {
      const res = await fetch('./data/' + def.file);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const parsed = parseFile(def.file, await res.text());
      ready.push({ def, puzzles: parsed.puzzles });
    } catch { /* skip a set that fails to load; others still load */ }
  }
  for (const { def, puzzles } of ready) {
    if (!store.getSet(def.id)) store.addSet({ id: def.id, name: def.name, puzzles });
  }
  renderLibrary();
  ensuring = false;
}

async function loadBundledSet(def, silent) {
  try {
    if (store.getSet(def.id)) { if (!silent) flash(`"${def.name}" is already loaded.`); return; }
    const res = await fetch('./data/' + def.file);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const parsed = parseFile(def.file, await res.text());
    store.addSet({ id: def.id, name: def.name, puzzles: parsed.puzzles });
    renderLibrary();
    if (!silent) flash(`Loaded "${def.name}" (${parsed.puzzles.length} puzzles).`);
  } catch (err) {
    if (!silent) alert(`Could not load "${def.name}": ` + err.message);
  }
}

function showScreen(name) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.dataset.screen === name));
}

// ---------------------------------------------------------------------------
// Library screen
// ---------------------------------------------------------------------------
function bindLibraryControls() {
  $('#file-input').addEventListener('change', onFilePicked);
  $('#load-sample').addEventListener('click', loadSample);
  renderDefaultSetButtons();
  $('#export-all').addEventListener('click', exportBackup);
  $('#import-backup').addEventListener('change', importBackup);

  // Settings
  const s = store.getSettings();
  $('#set-limit').value = s.perPuzzleLimitSec;
  $('#set-shuffle').checked = s.shuffle !== false;
  $('#set-autoadvance').checked = s.autoAdvance !== false;
  $('#set-retry').checked = s.allowRetry;
  $('#set-explain').checked = s.showExplanations;
  $('#set-sound').checked = s.sound !== false;
  sound.setEnabled(s.sound !== false);
  $('#set-limit').addEventListener('change', (e) =>
    store.saveSettings({ perPuzzleLimitSec: Math.max(0, parseInt(e.target.value, 10) || 0) }));
  $('#set-shuffle').addEventListener('change', (e) =>
    store.saveSettings({ shuffle: e.target.checked }));
  $('#set-autoadvance').addEventListener('change', (e) =>
    store.saveSettings({ autoAdvance: e.target.checked }));
  $('#set-retry').addEventListener('change', (e) =>
    store.saveSettings({ allowRetry: e.target.checked }));
  $('#set-explain').addEventListener('change', (e) =>
    store.saveSettings({ showExplanations: e.target.checked }));
  $('#set-sound').addEventListener('change', (e) => {
    store.saveSettings({ sound: e.target.checked });
    sound.setEnabled(e.target.checked);
    if (e.target.checked) { sound.unlock(); sound.move(); } // preview + prime audio
  });
}

// One load button per bundled set, reflecting whether it's already loaded.
function renderDefaultSetButtons() {
  const wrap = $('#default-set-buttons');
  if (!wrap) return;
  wrap.innerHTML = '';
  DEFAULT_SETS.forEach((def) => {
    const loaded = !!store.getSet(def.id);
    const b = el('button', 'btn block ' + (loaded ? 'subtle' : 'primary'));
    b.textContent = loaded ? `✓ ${def.name}` : `Load ${def.name}`;
    if (loaded) b.disabled = true;
    else b.addEventListener('click', () => loadBundledSet(def, false));
    wrap.appendChild(b);
  });
}

function renderLibrary() {
  renderDefaultSetButtons();
  const wrap = $('#set-list');
  wrap.innerHTML = '';
  const sets = store.listSets();
  if (!sets.length) {
    wrap.appendChild(el('p', 'muted', 'No puzzle sets yet. Import a file or load the sample set to begin.'));
    return;
  }
  for (const meta of sets) {
    const prog = store.getProgress(meta.id);
    const cycles = prog.cycles || [];
    const last = cycles[cycles.length - 1];
    const best = cycles.reduce((b, c) => (b == null || c.totalMs < b.totalMs ? c.totalMs : b), null);

    const card = el('div', 'card');
    const head = el('div', 'card-head');
    head.appendChild(el('h3', null, meta.name));
    head.appendChild(el('span', 'pill', `${meta.count} puzzles`));
    card.appendChild(head);

    const stats = el('div', 'card-stats');
    stats.appendChild(stat('Cycles done', String(cycles.length)));
    stats.appendChild(stat('Best time', best != null ? fmtTime(best) : '—'));
    stats.appendChild(stat('Last accuracy', last ? Math.round(last.accuracy * 100) + '%' : '—'));
    card.appendChild(stats);

    if (cycles.length > 1) card.appendChild(speedChart(cycles));

    // A cycle counts as "in progress" (resumable) only once at least one puzzle
    // has been completed in it.
    const inProgress = prog.current && prog.current.index > 0
      && prog.current.index < (prog.current.order ? prog.current.order.length : meta.count);
    if (inProgress) {
      card.appendChild(el('div', 'resume-note',
        `Cycle ${cycles.length + 1} in progress — resume at puzzle ${prog.current.index + 1} of ${meta.count}.`));
    }

    const actions = el('div', 'card-actions');
    const startBtn = el('button', 'btn primary',
      inProgress ? `Resume at puzzle ${prog.current.index + 1}` : `Start cycle ${cycles.length + 1}`);
    startBtn.addEventListener('click', () => startCycle(meta.id));
    actions.appendChild(startBtn);

    if (inProgress) {
      const restartBtn = el('button', 'btn', 'Restart cycle');
      restartBtn.addEventListener('click', () => {
        if (confirm('Discard progress in the current cycle and start it over from puzzle 1?')) {
          const p = store.getProgress(meta.id); p.current = null; store.saveProgress(meta.id, p);
          startCycle(meta.id);
        }
      });
      actions.appendChild(restartBtn);
    }

    const histBtn = el('button', 'btn', 'History');
    histBtn.addEventListener('click', () => showHistory(meta));
    actions.appendChild(histBtn);

    const delBtn = el('button', 'btn danger', 'Delete');
    delBtn.addEventListener('click', () => {
      if (confirm(`Delete "${meta.name}" and its progress?`)) { store.deleteSet(meta.id); renderLibrary(); }
    });
    actions.appendChild(delBtn);
    card.appendChild(actions);
    wrap.appendChild(card);
  }
}

function stat(label, value) {
  const d = el('div', 'stat');
  d.appendChild(el('div', 'stat-value', value));
  d.appendChild(el('div', 'stat-label', label));
  return d;
}

// Tiny inline SVG line chart of total time per cycle (the speed-up curve).
function speedChart(cycles) {
  const w = 260, h = 70, pad = 6;
  const times = cycles.map((c) => c.totalMs);
  const max = Math.max(...times), min = Math.min(...times);
  const span = max - min || 1;
  const pts = times.map((t, i) => {
    const x = pad + (i * (w - 2 * pad)) / Math.max(1, times.length - 1);
    const y = pad + (1 - (t - min) / span) * (h - 2 * pad);
    return [x, y];
  });
  const path = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
  const svg = `<svg viewBox="0 0 ${w} ${h}" class="spark" role="img" aria-label="Time per cycle">
    <polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" class="spark-line"/>
    ${pts.map((p) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.5" class="spark-dot"/>`).join('')}
  </svg>`;
  const box = el('div', 'chart');
  box.innerHTML = svg + `<div class="chart-cap">Time per cycle — lower is faster (${fmtTime(max)} → ${fmtTime(times[times.length - 1])})</div>`;
  return box;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
async function onFilePicked(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const text = await file.text();
    const parsed = parseFile(file.name, text);
    const name = prompt('Name this puzzle set:', parsed.name || file.name) || parsed.name || file.name;
    const id = 'set-' + Math.random().toString(36).slice(2, 9);
    store.addSet({ id, name, puzzles: parsed.puzzles });
    renderLibrary();
    flash(`Imported ${parsed.puzzles.length} puzzles into "${name}".`);
  } catch (err) {
    alert('Could not import that file:\n\n' + err.message);
  } finally {
    e.target.value = '';
  }
}

async function loadSample() {
  try {
    const res = await fetch('./data/sample-puzzles.json');
    const text = await res.text();
    const parsed = parseFile('sample-puzzles.json', text);
    const id = 'set-sample';
    store.addSet({ id, name: parsed.name, puzzles: parsed.puzzles });
    renderLibrary();
    flash(`Loaded ${parsed.puzzles.length} sample puzzles.`);
  } catch (err) {
    alert('Could not load sample: ' + err.message);
  }
}

function exportBackup() {
  const dump = store.exportAll();
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const a = el('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'woodpecker-backup.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function importBackup(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    store.importAll(JSON.parse(await file.text()));
    renderLibrary();
    flash('Backup restored.');
  } catch (err) {
    alert('Could not restore backup: ' + err.message);
  } finally {
    e.target.value = '';
  }
}

// ---------------------------------------------------------------------------
// Trainer screen
// ---------------------------------------------------------------------------
function startCycle(setId) {
  activeSetId = setId;
  const puzzles = store.getPuzzles(setId);
  if (!puzzles.length) { alert('This set has no puzzles.'); return; }
  const settings = store.getSettings();
  const prog = store.getProgress(setId);

  // Resume an in-progress cycle if one is saved and still valid, otherwise
  // start a fresh cycle. The saved order is replayed exactly so the learner
  // continues the same sequence from where they stopped.
  let ordered = null, resume = null;
  const cur = prog.current;
  if (cur && Array.isArray(cur.order) && cur.index > 0 && cur.index < cur.order.length) {
    const byId = new Map(puzzles.map((p) => [p.id, p]));
    const seq = cur.order.map((id) => byId.get(id));
    if (seq.every(Boolean)) {
      ordered = seq;
      resume = { index: cur.index, results: cur.results || [], startedAt: cur.startedAt };
    }
  }
  if (!ordered) ordered = settings.shuffle ? shuffle(puzzles.slice()) : puzzles.slice();
  session = new Session(ordered, settings, resume);

  const meta = store.getSet(setId);
  $('#trainer-title').textContent = meta.name;
  $('#cycle-label').textContent = `Cycle ${(prog.cycles.length || 0) + 1}`;
  if (resume) flash(`Resuming at puzzle ${session.number} of ${session.total}.`);

  saveCycleProgress();   // persist the (possibly fresh) in-progress cycle
  showScreen('trainer');
  startCycleTicker();
  loadCurrentPuzzle();
}

// Persist the in-progress cycle so it can be resumed in a later sitting.
function saveCycleProgress() {
  if (!activeSetId || !session) return;
  const prog = store.getProgress(activeSetId);
  prog.current = {
    startedAt: session.startedAt,
    order: session.puzzles.map((p) => p.id),
    index: session.index,
    results: session.results,
  };
  store.saveProgress(activeSetId, prog);
}

function startCycleTicker() {
  clearInterval(cycleTicker);
  const start = performance.now();
  cycleTicker = setInterval(() => {
    // Show accumulated puzzle time + time on the active puzzle.
    const done = session.results.reduce((a, r) => a + r.ms, 0);
    const live = session.solved ? 0 : performance.now() - session._puzzleStart;
    $('#cycle-timer').textContent = fmtTime(done + live);
  }, 200);
}

function loadCurrentPuzzle() {
  clearTimeout(autoAdvanceTimer);
  autoAdvanceTimer = null;
  clearFeedback();
  board.clearMarks();
  board.setInteractive(false);
  const info = session.startPuzzle();
  const p = session.current;

  $('#progress-label').textContent = `Puzzle ${session.number} / ${session.total}`;
  $('#progress-bar-fill').style.width = ((session.number - 1) / session.total * 100) + '%';
  $('#score-label').textContent = `Solved ${session.results.filter((r) => r.correct).length}`;
  $('#puzzle-theme').textContent = p.theme || '—';
  $('#puzzle-rating').textContent = p.rating ? `Rating ${p.rating}` : '';

  board.setOrientation(info.orientation);
  // For opponent-first puzzles, show the position BEFORE the setup move so we
  // can animate that move sliding in.
  board.setPosition(info.setupMove ? info.preSetupFen : info.fen);

  const toMove = info.sideToMove === 'w' ? 'White' : 'Black';
  $('#side-to-move').textContent = `${toMove} to move`;
  $('#side-to-move').className = 'side-to-move ' + (info.sideToMove === 'w' ? 'white' : 'black');

  const go = async () => {
    board.clearMarks();
    if (info.setupMove) {
      await sleep(280);
      await board.animateMove(info.setupMove.from, info.setupMove.to);
      board.setPosition(info.fen);
      board.markLastMove(info.setupMove.from, info.setupMove.to);
      moveSound(info.setupMove);
    }
    board.setInteractive(true);
    // Start the clock when the learner actually gets control, so the setup
    // animation delay isn't charged to them.
    session._puzzleStart = performance.now();
    armPuzzleTimer();
  };
  go();
}

function armPuzzleTimer() {
  clearInterval(puzzleTimer);
  const limit = store.getSettings().perPuzzleLimitSec;
  const box = $('#puzzle-timer');
  if (!limit) { box.textContent = ''; box.classList.remove('warn'); return; }
  puzzleDeadline = performance.now() + limit * 1000;
  const tick = () => {
    const left = Math.max(0, puzzleDeadline - performance.now());
    box.textContent = 'Time left: ' + fmtTime(left);
    box.classList.toggle('warn', left < 10000);
    if (left <= 0) {
      clearInterval(puzzleTimer);
      onTimeout();
    }
  };
  tick();
  puzzleTimer = setInterval(tick, 200);
}

async function onMove(from, to) {
  if (!session || session.solved) return;
  // Handle promotion choice if needed.
  let promotion;
  if (session.needsPromotion(from, to)) {
    promotion = await askPromotion(session.solverColor);
    if (!promotion) return;
  }
  const res = session.tryMove(from, to, promotion);
  await handleResult(res, from, to);
}

// Pacing (ms) for move playback. The pause before the opponent's reply is what
// gives your eye time to register your own move before theirs happens.
const PLAYER_SLIDE = 190;
const REPLY_PAUSE = 480;   // beat between your move landing and the reply starting
const REPLY_SLIDE = 300;   // the opponent's move slides a bit slower, to read clearly

// Slide `move` on the board, then snap to the exact resulting FEN, highlight the
// squares, and play its sound. The board DOM must still show the position
// before `move`.
async function animateAndPlace(move, fenAfter, { ms = PLAYER_SLIDE } = {}) {
  if (!move) { if (fenAfter) board.setPosition(fenAfter); return; }
  await board.animateMove(move.from, move.to, ms);
  board.setPosition(fenAfter);
  board.markLastMove(move.from, move.to);
  moveSound(move);
}

// Floating piece picker shown over the board for pawn promotions.
function askPromotion(color) {
  return new Promise((resolve) => {
    const wrap = $('.board-wrap');
    const old = $('#promo-picker'); if (old) old.remove();
    const picker = el('div', 'promo-picker'); picker.id = 'promo-picker';
    ['q', 'r', 'b', 'n'].forEach((pc) => {
      const b = el('button', 'promo-btn ' + (color === 'w' ? 'cb-white' : 'cb-black'));
      b.innerHTML = pieceSVG(pc);
      b.title = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' }[pc];
      b.addEventListener('click', () => { picker.remove(); resolve(pc); });
      picker.appendChild(b);
    });
    const cancel = el('button', 'promo-cancel', '✕');
    cancel.addEventListener('click', () => { picker.remove(); resolve(null); });
    picker.appendChild(cancel);
    wrap.appendChild(picker);
  });
}

async function handleResult(res, from, to) {
  if (res.status === 'illegal') return; // silently ignore illegal drops

  if (res.status === 'progress' || res.status === 'solved') {
    board.setInteractive(false);
    board.clearMarks();
    // Animate your move and let it land + highlight, then pause so you register
    // it before the opponent replies with its own (slightly slower) animation,
    // fresh highlight, and sound — so it's easy to see what moved.
    await animateAndPlace(res.playerMove, res.afterPlayerFen);
    if (res.reply) {
      await sleep(REPLY_PAUSE);
      board.clearMarks();
      await animateAndPlace(res.reply, res.finalFen, { ms: REPLY_SLIDE });
      board.pulse(res.reply.to);   // gentle emphasis on the opponent's landing square
      await sleep(120);
    }

    if (res.status === 'progress') {
      feedback('good', 'Correct — keep going.');
      board.setInteractive(true);
    } else {
      clearInterval(puzzleTimer);
      board.mark(res.playerMove.to, 'cb-good');
      board.pulse(res.playerMove.to);
      const first = session.results[session.results.length - 1];
      const clean = first && first.correct;
      sound.success();
      feedback('good', clean ? '✅ Solved!' : '✅ Solved (after a slip).');
      showExplanation();
      showContinue();
      // Auto-load the next puzzle after a short beat (the Next button stays
      // visible so it can still be tapped to skip ahead immediately).
      if (store.getSettings().autoAdvance !== false && session.hasNext()) {
        const hasExpl = !$('#explanation').classList.contains('hidden');
        scheduleAutoAdvance(hasExpl ? 1600 : 850);
      }
    }
    return;
  }

  if (res.status === 'wrong') {
    sound.error();
    board.mark(to, 'cb-bad');
    setTimeout(() => board.clearMarks(), 500);
    board.setPosition(session.game.fen()); // snap piece back (move wasn't applied)
    const msg = `✗ ${res.playedSan} isn't the solution here.`;
    if (res.canRetry) {
      feedback('bad', msg + ' Try again, or reveal the answer.');
      showRevealButton();
    } else {
      feedback('bad', msg);
      doReveal();
    }
  }
}

function onTimeout() {
  session.timeout();
  board.setInteractive(false);
  feedback('bad', '⏱ Time up.');
  doReveal();
}

// Step through the solution on the board, then let the learner continue.
function doReveal() {
  clearInterval(puzzleTimer);
  const line = session.reveal();
  board.setInteractive(false);
  let i = 0;
  const step = async () => {
    if (i >= line.length) {
      showExplanation();
      showContinue();
      return;
    }
    const uci = line[i++];
    board.clearMarks();
    await board.animateMove(uci.slice(0, 2), uci.slice(2, 4), 260);
    const mv = session.game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    board.setPosition(session.game.fen());
    if (mv) {
      board.markLastMove(mv.from, mv.to);
      moveSound({ capture: mv.san.includes('x'), check: /[+#]/.test(mv.san) });
    }
    setTimeout(step, 500);
  };
  feedback('bad', 'Here is the solution line:');
  step();
}

function showExplanation() {
  if (!store.getSettings().showExplanations) return;
  const p = session.current;
  if (!p.explanation) return;
  const box = $('#explanation');
  box.textContent = p.explanation;
  box.classList.remove('hidden');
}

// ---------------------------------------------------------------------------
// Feedback + controls
// ---------------------------------------------------------------------------
function feedback(kind, text) {
  const box = $('#feedback');
  box.className = 'feedback ' + kind;
  box.textContent = text;
}
function clearFeedback() {
  $('#feedback').className = 'feedback';
  $('#feedback').textContent = '';
  $('#explanation').classList.add('hidden');
  $('#explanation').textContent = '';
  $('#control-slot').innerHTML = '';
}

function showRevealButton() {
  const slot = $('#control-slot');
  slot.innerHTML = '';
  const b = el('button', 'btn', 'Reveal answer');
  b.addEventListener('click', doReveal);
  slot.appendChild(b);
}

function showContinue() {
  const slot = $('#control-slot');
  slot.innerHTML = '';
  const b = el('button', 'btn primary', session.hasNext() ? 'Next puzzle →' : 'Finish cycle');
  b.addEventListener('click', advance);
  slot.appendChild(b);
  // keyboard: Enter / space to continue
  b.focus();
}

let autoAdvanceTimer = null;
let advancing = false;

// Schedule an automatic advance to the next puzzle after `ms`.
function scheduleAutoAdvance(ms) {
  clearTimeout(autoAdvanceTimer);
  autoAdvanceTimer = setTimeout(() => { autoAdvanceTimer = null; advance(); }, ms);
}

function advance() {
  if (advancing) return;           // guard against a manual tap racing the timer
  advancing = true;
  clearTimeout(autoAdvanceTimer);
  autoAdvanceTimer = null;
  const more = session.next();
  $('#progress-bar-fill').style.width = (session.index / session.total * 100) + '%';
  if (more) {
    saveCycleProgress();   // checkpoint after every completed puzzle
    loadCurrentPuzzle();
  } else {
    finishCycle();
  }
  advancing = false;
}

function finishCycle() {
  clearInterval(cycleTicker);
  clearInterval(puzzleTimer);
  const summary = session.summary();
  const prog = store.getProgress(activeSetId);
  prog.cycles = prog.cycles || [];
  prog.cycles.push(summary);
  prog.current = null;
  store.saveProgress(activeSetId, prog);
  showCycleResult(summary, prog.cycles);
}

// ---------------------------------------------------------------------------
// Cycle result overlay
// ---------------------------------------------------------------------------
function showCycleResult(summary, cycles) {
  const prev = cycles.length > 1 ? cycles[cycles.length - 2] : null;
  const modal = $('#modal');
  const body = $('#modal-body');
  body.innerHTML = '';
  body.appendChild(el('h2', null, `Cycle ${cycles.length} complete`));

  const grid = el('div', 'result-grid');
  grid.appendChild(stat('Total time', fmtTime(summary.totalMs)));
  grid.appendChild(stat('Solved clean', `${summary.correct}/${summary.total}`));
  grid.appendChild(stat('Accuracy', Math.round(summary.accuracy * 100) + '%'));
  if (prev) {
    const delta = prev.totalMs - summary.totalMs;
    const faster = delta > 0;
    grid.appendChild(stat(faster ? 'Faster by' : 'Slower by',
      (faster ? '−' : '+') + fmtTime(Math.abs(delta))));
  }
  body.appendChild(grid);

  if (cycles.length > 1) {
    body.appendChild(el('h3', 'section-h', 'Your speed-up across cycles'));
    body.appendChild(speedChart(cycles));
  }

  // Slowest / missed puzzles to focus on next time.
  const missed = summary.perPuzzle.filter((r) => !r.correct);
  if (missed.length) {
    body.appendChild(el('h3', 'section-h', `Missed this cycle (${missed.length})`));
    const ul = el('ul', 'miss-list');
    missed.slice(0, 12).forEach((r) => {
      const p = session.puzzles.find((x) => x.id === r.id);
      ul.appendChild(el('li', null, `${p ? (p.theme || p.id) : r.id} — ${fmtTime(r.ms)}${r.revealed ? ' (revealed)' : ''}`));
    });
    body.appendChild(ul);
  } else {
    body.appendChild(el('p', 'all-clean', '🎉 Clean sweep — every puzzle solved first try!'));
  }

  const actions = el('div', 'modal-actions');
  const again = el('button', 'btn primary', 'Run this set again (next cycle)');
  again.addEventListener('click', () => { closeModal(); startCycle(activeSetId); });
  const home = el('button', 'btn', 'Back to library');
  home.addEventListener('click', () => { closeModal(); renderLibrary(); showScreen('library'); });
  actions.appendChild(again);
  actions.appendChild(home);
  body.appendChild(actions);

  modal.classList.remove('hidden');
}

function showHistory(meta) {
  const prog = store.getProgress(meta.id);
  const cycles = prog.cycles || [];
  const modal = $('#modal');
  const body = $('#modal-body');
  body.innerHTML = '';
  body.appendChild(el('h2', null, `${meta.name} — history`));
  if (!cycles.length) {
    body.appendChild(el('p', 'muted', 'No cycles completed yet.'));
  } else {
    if (cycles.length > 1) body.appendChild(speedChart(cycles));
    const table = el('table', 'hist');
    table.innerHTML = '<thead><tr><th>#</th><th>Date</th><th>Time</th><th>Accuracy</th></tr></thead>';
    const tb = el('tbody');
    cycles.forEach((c, i) => {
      const tr = el('tr');
      tr.innerHTML =
        `<td>${i + 1}</td>` +
        `<td>${new Date(c.finishedAt).toLocaleDateString()}</td>` +
        `<td>${fmtTime(c.totalMs)}</td>` +
        `<td>${Math.round(c.accuracy * 100)}%</td>`;
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    body.appendChild(table);
  }
  const actions = el('div', 'modal-actions');
  const close = el('button', 'btn', 'Close');
  close.addEventListener('click', closeModal);
  actions.appendChild(close);
  body.appendChild(actions);
  modal.classList.remove('hidden');
}

function closeModal() { $('#modal').classList.add('hidden'); }

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function flash(msg) {
  const f = $('#flash');
  f.textContent = msg;
  f.classList.add('show');
  setTimeout(() => f.classList.remove('show'), 2600);
}

// Quit back to library from within a cycle (progress for the cycle is dropped).
function bindTrainerNav() {
  $('#quit-cycle').addEventListener('click', () => {
    if (confirm('Leave this cycle? Your progress is saved — you can resume from this puzzle next time.')) {
      clearInterval(cycleTicker);
      clearInterval(puzzleTimer);
      clearTimeout(autoAdvanceTimer);
      autoAdvanceTimer = null;
      renderLibrary();
      showScreen('library');
    }
  });
}

document.addEventListener('DOMContentLoaded', () => {
  boot();
  bindTrainerNav();
  // Browsers block audio until a user gesture; prime the context on first tap.
  window.addEventListener('pointerdown', () => sound.unlock(), { once: true });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && $('#control-slot').firstChild) {
      // let the focused button handle it; nothing extra needed
    }
    if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) closeModal();
  });
});
