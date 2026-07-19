// The training engine: runs one Woodpecker "cycle" (a full pass through a
// puzzle set), one puzzle at a time. It owns timing, scoring, and the logic
// for validating the learner's moves against each puzzle's solution line.
//
// The Woodpecker method: solve the whole set, repeat the same set again and
// again, getting faster each cycle while keeping accuracy high. This engine
// records per-puzzle time + correctness and rolls it up into a cycle result,
// which the UI charts across repetitions to show the speed-up.

import { Chess } from '../vendor/chess.js';

export class Session {
  constructor(puzzles, { perPuzzleLimitSec = 0, allowRetry = true } = {}) {
    this.puzzles = puzzles;
    this.perPuzzleLimitSec = perPuzzleLimitSec;
    this.allowRetry = allowRetry;
    this.index = 0;
    this.results = [];        // per-puzzle: {id, ms, correct, attempts, revealed}
    this.startedAt = new Date().toISOString();
    this._puzzleStart = 0;
    this._attempts = 0;
    this._firstWrong = false;
    this._revealed = false;
    this.game = null;         // chess.js instance for the active puzzle
    this.ply = 0;             // index into current puzzle's solution
    this.solverColor = 'w';
    this.solved = false;
  }

  get total() { return this.puzzles.length; }
  get current() { return this.puzzles[this.index]; }
  get number() { return this.index + 1; }

  // Begin the puzzle at the current index. Returns display info; if the puzzle
  // is "opponent moves first" (Lichess style), the setup move is returned so
  // the UI can animate it before handing control to the learner.
  startPuzzle() {
    const p = this.current;
    this.game = new Chess();
    this.game.load(p.fen);
    this.ply = 0;
    this.solved = false;
    this._attempts = 0;
    this._firstWrong = false;
    this._revealed = false;
    this._puzzleStart = performance.now();

    let setupMove = null;
    if (p.sideFirst === 'opponent') {
      const uci = p.solution[0];
      setupMove = this._applyUci(uci);
      this.ply = 1;
    }
    this.solverColor = this.game.turn();
    return {
      fen: this.game.fen(),
      orientation: this.solverColor,
      setupMove,               // {from,to} played automatically, or null
      sideToMove: this.solverColor,
    };
  }

  _applyUci(uci) {
    const mv = this.game.move({
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : undefined,
    });
    return mv ? { from: mv.from, to: mv.to, san: mv.san, lan: mv.lan } : null;
  }

  // Is the given from/to (with optional promotion) even a legal move here?
  isLegal(from, to, promotion) {
    const moves = this.game.moves({ verbose: true });
    return moves.some((m) =>
      m.from === from && m.to === to &&
      (!m.promotion || !promotion || m.promotion === promotion));
  }

  needsPromotion(from, to) {
    const moves = this.game.moves({ verbose: true });
    return moves.some((m) => m.from === from && m.to === to && m.promotion);
  }

  // Attempt the learner's move. Returns one of:
  //  {status:'illegal'}                       — not a legal chess move; ignore
  //  {status:'progress', reply, done:false}   — correct, opponent replied
  //  {status:'solved'}                        — puzzle complete & correct
  //  {status:'wrong', expected, playedSan}    — legal but not the solution
  tryMove(from, to, promotion) {
    if (!this.isLegal(from, to, promotion)) return { status: 'illegal' };

    const expected = this.current.solution[this.ply];
    const played = from + to + (promotion || '');
    const playedNorm = this._normalizePromo(from, to, promotion);

    // Snapshot to test whether the played move is a valid solution.
    const trial = new Chess();
    trial.load(this.game.fen());
    const mv = trial.move({ from, to, promotion: promotion || undefined });
    const playedSan = mv ? mv.san : played;

    const matches = playedNorm === expected;
    // Accept any move that delivers checkmate as solving a mate puzzle, even
    // if it's a different mate than the recorded line.
    const isMate = mv && trial.isCheckmate();

    if (matches || isMate) {
      this._applyUci(playedNorm);
      this.ply++;
      // Play the opponent's scripted reply, if any.
      if (this.ply < this.current.solution.length && !this.game.isGameOver()) {
        const reply = this._applyUci(this.current.solution[this.ply]);
        this.ply++;
        if (this.ply >= this.current.solution.length || this.game.isGameOver()) {
          return this._finish(true, { status: 'solved', reply });
        }
        return { status: 'progress', reply, fen: this.game.fen(), done: false };
      }
      return this._finish(true, { status: 'solved', reply: null });
    }

    // Legal but wrong.
    this._attempts++;
    if (this._attempts === 1) this._firstWrong = true;
    return {
      status: 'wrong',
      expected,
      playedSan,
      canRetry: this.allowRetry,
    };
  }

  _normalizePromo(from, to, promotion) {
    // If the move is a promotion but no piece was chosen, default to queen so
    // it can still match a recorded "...q" solution.
    if (this.needsPromotion(from, to)) return from + to + (promotion || 'q');
    return from + to;
  }

  // The learner gave up (or time ran out): reveal and step through the line.
  reveal() {
    this._revealed = true;
    if (!this._firstWrong) this._firstWrong = true; // reveal counts as not solved
    const line = this.current.solution.slice(this.ply);
    return line;
  }

  // Called when the per-puzzle timer expires.
  timeout() {
    this._firstWrong = true;
    this._revealed = true;
    return this._finish(false, { status: 'timeout' });
  }

  _finish(correct, payload) {
    if (this.solved) return payload;
    this.solved = true;
    const ms = Math.round(performance.now() - this._puzzleStart);
    this.results.push({
      id: this.current.id,
      ms,
      correct: correct && !this._firstWrong && !this._revealed,
      attempts: this._attempts + 1,
      revealed: this._revealed,
    });
    return payload;
  }

  // Force-close the current puzzle as failed (used after reveal/skip).
  concludeFailed() {
    if (this.solved) return;
    this._finish(false, { status: 'closed' });
  }

  hasNext() { return this.index < this.puzzles.length - 1; }

  next() {
    if (!this.solved) this.concludeFailed();
    this.index++;
    return this.index < this.puzzles.length;
  }

  // Roll the per-puzzle results into a cycle summary for storage/charting.
  summary() {
    const totalMs = this.results.reduce((a, r) => a + r.ms, 0);
    const correct = this.results.filter((r) => r.correct).length;
    return {
      startedAt: this.startedAt,
      finishedAt: new Date().toISOString(),
      totalMs,
      correct,
      total: this.results.length,
      accuracy: this.results.length ? correct / this.results.length : 0,
      perPuzzle: this.results.slice(),
    };
  }
}

// Format milliseconds as m:ss (or h:mm:ss for long sessions).
export function fmtTime(ms) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
