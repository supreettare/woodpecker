// Parsers that turn an uploaded file into a normalized puzzle set.
//
// Normalized puzzle shape:
//   { id, fen, solution: [uci...], sideFirst: 'solver'|'opponent',
//     theme, rating, explanation, source }
//
// Supported inputs:
//   * JSON   — our native authoring format (see data/sample-puzzles.json)
//   * CSV    — Lichess puzzle database export (lichess.org/training/db)
//   * PGN    — games/puzzles with [FEN] tags; mainline becomes the solution
//
// The importer NEVER ships puzzle content itself. You bring your own file
// (the book you own, a Lichess export, your coach's PGN, etc.).

import { Chess } from '../vendor/chess.js';

function uid(prefix) {
  return prefix + '-' + Math.random().toString(36).slice(2, 9);
}

// ---- JSON (native format) -------------------------------------------------
function parseJson(text) {
  const data = JSON.parse(text);
  const arr = Array.isArray(data) ? data : data.puzzles;
  if (!Array.isArray(arr)) throw new Error('JSON must be an array of puzzles or {puzzles:[...]}.');
  const name = (!Array.isArray(data) && data.name) || 'Imported set';
  const puzzles = arr.map((p, i) => {
    let solution = p.solution || p.moves || p.line;
    if (typeof solution === 'string') solution = solution.trim().split(/\s+/);
    if (!p.fen || !Array.isArray(solution) || solution.length === 0) {
      throw new Error(`Puzzle #${i + 1} is missing a "fen" or "solution".`);
    }
    return {
      id: p.id || uid('p'),
      fen: p.fen,
      solution: solution.map(normalizeUci),
      sideFirst: p.sideFirst === 'opponent' ? 'opponent' : 'solver',
      theme: p.theme || (p.themes ? [].concat(p.themes).join(', ') : ''),
      rating: p.rating || null,
      explanation: p.explanation || '',
      source: p.source || '',
    };
  });
  return { name, puzzles };
}

// A solution move may be UCI ("e2e4") or SAN ("Nf3"). SAN is resolved against
// the running position at import time and converted to UCI.
function normalizeUci(m) {
  return m; // UCI passes through; SAN is handled during validation below.
}

// ---- Lichess CSV ----------------------------------------------------------
// Header: PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
// In Lichess data the FEN's side-to-move plays the FIRST move (the opponent's
// setup move); the solver replies with the second move. Hence sideFirst:'opponent'.
function parseLichessCsv(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('Empty CSV.');
  let start = 0;
  const header = lines[0].toLowerCase();
  const hasHeader = header.includes('fen') && header.includes('moves');
  if (hasHeader) start = 1;
  const puzzles = [];
  for (let i = start; i < lines.length; i++) {
    const cols = splitCsvLine(lines[i]);
    if (cols.length < 3) continue;
    const [id, fen, moves, rating, , , , themes] = cols;
    if (!fen || !moves) continue;
    puzzles.push({
      id: id || uid('lichess'),
      fen,
      solution: moves.trim().split(/\s+/),
      sideFirst: 'opponent',
      theme: (themes || '').replace(/\s+/g, ', '),
      rating: rating ? parseInt(rating, 10) : null,
      explanation: '',
      source: 'Lichess',
    });
  }
  if (!puzzles.length) throw new Error('No puzzles found in CSV.');
  return { name: 'Lichess puzzles', puzzles };
}

function splitCsvLine(line) {
  const out = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out;
}

// ---- PGN ------------------------------------------------------------------
// Each game with a [FEN "..."] tag becomes one puzzle whose solution is the
// mainline. The side to move in the FEN is the solver.
function parsePgn(text) {
  const chunks = text.split(/\n\s*\n(?=\[)/).filter((c) => c.trim());
  // The split above separates games; but header/movetext are separated by a
  // blank line too. Re-join into full games instead:
  const games = splitPgnGames(text);
  const puzzles = [];
  games.forEach((g, idx) => {
    const fenMatch = g.match(/\[FEN\s+"([^"]+)"\]/i);
    if (!fenMatch) return;
    const fen = fenMatch[1];
    const movetext = g.replace(/\[[^\]]*\]/g, ' ');
    const sans = extractSanTokens(movetext);
    if (!sans.length) return;
    const game = new Chess();
    try { game.load(fen); } catch { return; }
    const uci = [];
    for (const san of sans) {
      try {
        const mv = game.move(san);
        uci.push(mv.lan);
      } catch { break; }
    }
    if (!uci.length) return;
    const evtMatch = g.match(/\[Event\s+"([^"]+)"\]/i);
    puzzles.push({
      id: uid('pgn'),
      fen,
      solution: uci,
      sideFirst: 'solver',
      theme: evtMatch ? evtMatch[1] : '',
      rating: null,
      explanation: '',
      source: 'PGN',
    });
  });
  if (!puzzles.length) throw new Error('No puzzles with [FEN] tags found in PGN.');
  return { name: 'PGN puzzles', puzzles };
}

function splitPgnGames(text) {
  const games = [];
  let cur = '';
  let sawMoves = false;
  for (const line of text.split(/\r?\n/)) {
    const isTag = /^\s*\[/.test(line);
    if (isTag && sawMoves) {
      games.push(cur);
      cur = '';
      sawMoves = false;
    }
    if (!isTag && line.trim()) sawMoves = true;
    cur += line + '\n';
  }
  if (cur.trim()) games.push(cur);
  return games;
}

function extractSanTokens(movetext) {
  return movetext
    .replace(/\{[^}]*\}/g, ' ')       // comments
    .replace(/\([^)]*\)/g, ' ')        // variations
    .replace(/\d+\.(\.\.)?/g, ' ')     // move numbers
    .replace(/\$\d+/g, ' ')            // NAGs
    .replace(/\b(1-0|0-1|1\/2-1\/2|\*)\b/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t && /[a-hKQRBNO]/.test(t));
}

// ---- Dispatch + validation ------------------------------------------------
export function parseFile(filename, text) {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  let result;
  if (ext === 'json') result = parseJson(text);
  else if (ext === 'pgn') result = parsePgn(text);
  else if (ext === 'csv') result = parseLichessCsv(text);
  else {
    // Fall back to sniffing content.
    const t = text.trim();
    if (t.startsWith('{') || t.startsWith('[')) result = parseJson(text);
    else if (/\[FEN/i.test(t)) result = parsePgn(text);
    else result = parseLichessCsv(text);
  }
  result.puzzles = result.puzzles
    .map(validateAndNormalize)
    .filter(Boolean);
  if (!result.puzzles.length) throw new Error('No valid puzzles after checking legality.');
  return result;
}

// Ensure every solution move is legal from the FEN; convert any SAN to UCI.
// Drops puzzles whose lines don't play out legally, so bad data can't crash a
// training session later.
export function validateAndNormalize(p) {
  const game = new Chess();
  try { game.load(p.fen); } catch { return null; }
  const uci = [];
  for (const raw of p.solution) {
    let mv;
    try {
      if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(raw)) {
        mv = game.move({ from: raw.slice(0, 2), to: raw.slice(2, 4), promotion: raw[4] });
      } else {
        mv = game.move(raw); // SAN
      }
    } catch { return null; }
    if (!mv) return null;
    uci.push(mv.lan);
  }
  if (!uci.length) return null;
  return { ...p, solution: uci };
}
