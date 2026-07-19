// Minimal, dependency-free chessboard renderer with click + drag input.
// It knows nothing about chess rules — it just displays a position and
// reports attempted moves (from -> to) to a callback. Rule checking is the
// caller's job (we use chess.js for that).

import { pieceSVG } from './pieces.js';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];

export class Board {
  constructor(container, { onMove } = {}) {
    this.container = container;
    this.onMove = onMove || (() => {});
    this.orientation = 'w';
    this.interactive = false;
    this.selected = null;      // currently selected square (click-to-move)
    this.position = {};        // square -> {type, color}
    this.squares = {};         // square -> element
    this.dragState = null;
    this._buildGrid();
  }

  _buildGrid() {
    this.container.classList.add('cb-board');
    this.container.innerHTML = '';
    this.grid = document.createElement('div');
    this.grid.className = 'cb-grid';
    this.container.appendChild(this.grid);
    this._layout();
  }

  _orderedSquares() {
    const ranks = [8, 7, 6, 5, 4, 3, 2, 1];
    const files = FILES.slice();
    if (this.orientation === 'b') { ranks.reverse(); files.reverse(); }
    const out = [];
    for (const r of ranks) for (const f of files) out.push(f + r);
    return out;
  }

  _layout() {
    this.grid.innerHTML = '';
    this.squares = {};
    for (const sq of this._orderedSquares()) {
      const file = sq[0], rank = parseInt(sq[1], 10);
      const el = document.createElement('div');
      const dark = (FILES.indexOf(file) + rank) % 2 === 0;
      el.className = 'cb-square ' + (dark ? 'cb-dark' : 'cb-light');
      el.dataset.square = sq;
      // coordinate labels on the edge squares
      if (sq[1] === (this.orientation === 'w' ? '1' : '8')) {
        const c = document.createElement('span');
        c.className = 'cb-coord cb-file';
        c.textContent = file;
        el.appendChild(c);
      }
      if (file === (this.orientation === 'w' ? 'a' : 'h')) {
        const c = document.createElement('span');
        c.className = 'cb-coord cb-rank';
        c.textContent = rank;
        el.appendChild(c);
      }
      el.addEventListener('pointerdown', (e) => this._onPointerDown(e, sq));
      el.addEventListener('click', () => this._onClick(sq));
      this.grid.appendChild(el);
      this.squares[sq] = el;
    }
    this._renderPieces();
  }

  setOrientation(color) {
    this.orientation = color === 'b' ? 'b' : 'w';
    this._layout();
  }

  flip() {
    this.setOrientation(this.orientation === 'w' ? 'b' : 'w');
  }

  setInteractive(on) {
    this.interactive = !!on;
    this.container.classList.toggle('cb-locked', !on);
    if (!on) this._clearSelection();
  }

  // Parse the placement field of a FEN into {square: {type,color}}.
  setPosition(fen) {
    const placement = fen.split(' ')[0];
    const pos = {};
    const rows = placement.split('/');
    for (let r = 0; r < 8; r++) {
      const rank = 8 - r;
      let file = 0;
      for (const ch of rows[r]) {
        if (/\d/.test(ch)) { file += parseInt(ch, 10); continue; }
        const square = FILES[file] + rank;
        pos[square] = {
          type: ch.toLowerCase(),
          color: ch === ch.toUpperCase() ? 'w' : 'b',
        };
        file++;
      }
    }
    this.position = pos;
    this._renderPieces();
  }

  _renderPieces() {
    for (const sq in this.squares) {
      const el = this.squares[sq];
      const existing = el.querySelector('.cb-piece');
      if (existing) existing.remove();
      const piece = this.position[sq];
      if (piece) {
        const p = document.createElement('div');
        p.className = 'cb-piece ' + (piece.color === 'w' ? 'cb-white' : 'cb-black');
        p.innerHTML = pieceSVG(piece.type);
        p.dataset.square = sq;
        el.appendChild(p);
      }
    }
  }

  clearMarks() {
    for (const sq in this.squares) {
      this.squares[sq].classList.remove(
        'cb-sel', 'cb-target', 'cb-last', 'cb-check', 'cb-good', 'cb-bad', 'cb-hint');
    }
  }

  mark(square, cls) {
    if (this.squares[square]) this.squares[square].classList.add(cls);
  }

  markLastMove(from, to) {
    if (from && this.squares[from]) this.squares[from].classList.add('cb-last');
    if (to && this.squares[to]) this.squares[to].classList.add('cb-last');
  }

  _clearSelection() {
    if (this.selected && this.squares[this.selected]) {
      this.squares[this.selected].classList.remove('cb-sel');
    }
    for (const sq in this.squares) this.squares[sq].classList.remove('cb-target');
    this.selected = null;
  }

  _select(sq) {
    this._clearSelection();
    if (this.position[sq]) {
      this.selected = sq;
      this.squares[sq].classList.add('cb-sel');
    }
  }

  _onClick(sq) {
    if (!this.interactive || this.dragState) return;
    // A click that immediately follows a pointerdown-driven move is a phantom;
    // swallow it so it doesn't re-select the destination square.
    if (this._suppressClick) { this._suppressClick = false; return; }
    if (this.selected && this.selected !== sq) {
      const from = this.selected;
      this._clearSelection();
      this.onMove(from, sq);
    } else {
      this._select(sq);
    }
  }

  _onPointerDown(e, sq) {
    if (!this.interactive) return;
    // If a piece is already selected and this is a different square, treat the
    // press as completing the move (this makes click-to-move CAPTURES work,
    // where the target square is occupied and would otherwise re-select).
    if (this.selected && this.selected !== sq) {
      e.preventDefault();
      const from = this.selected;
      this._clearSelection();
      this._suppressClick = true;
      this.onMove(from, sq);
      return;
    }
    const piece = this.position[sq];
    if (!piece) return;
    e.preventDefault();
    const pieceEl = this.squares[sq].querySelector('.cb-piece');
    if (!pieceEl) return;
    const rect = this.grid.getBoundingClientRect();
    const size = rect.width / 8;
    this.dragState = { from: sq, pieceEl, size, rect, moved: false };
    this._select(sq);
    pieceEl.classList.add('cb-dragging');

    const move = (ev) => {
      this.dragState.moved = true;
      const x = ev.clientX - this.rectLeft() - this.dragState.size / 2;
      const y = ev.clientY - this.rectTop() - this.dragState.size / 2;
      pieceEl.style.transform = `translate(${x - this._baseX(sq)}px, ${y - this._baseY(sq)}px)`;
    };
    const up = (ev) => {
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
      pieceEl.classList.remove('cb-dragging');
      pieceEl.style.transform = '';
      const target = this._squareFromPoint(ev.clientX, ev.clientY);
      const wasDrag = this.dragState.moved;
      this.dragState = null;
      if (wasDrag && target && target !== sq) {
        this._clearSelection();
        this._suppressClick = true;
        this.onMove(sq, target);
      } else if (wasDrag) {
        this._clearSelection();
        this._suppressClick = true;
      }
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  }

  rectLeft() { return this.grid.getBoundingClientRect().left; }
  rectTop() { return this.grid.getBoundingClientRect().top; }
  _baseX(sq) {
    const idx = this._orderedSquares().indexOf(sq);
    return (idx % 8) * (this.grid.getBoundingClientRect().width / 8);
  }
  _baseY(sq) {
    const idx = this._orderedSquares().indexOf(sq);
    return Math.floor(idx / 8) * (this.grid.getBoundingClientRect().width / 8);
  }

  _squareFromPoint(x, y) {
    const rect = this.grid.getBoundingClientRect();
    if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) return null;
    const size = rect.width / 8;
    const col = Math.floor((x - rect.left) / size);
    const row = Math.floor((y - rect.top) / size);
    const ordered = this._orderedSquares();
    return ordered[row * 8 + col] || null;
  }
}
