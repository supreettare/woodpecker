// Validates a puzzle JSON file against the vendored chess.js.
// Usage: node data/validate.mjs data/sample-puzzles.json
import { Chess } from '../vendor/chess.js';
import { readFileSync } from 'node:fs';

const path = process.argv[2] || 'data/sample-puzzles.json';
const set = JSON.parse(readFileSync(new URL('../' + path, import.meta.url), 'utf8'));

let failures = 0;
for (const p of set.puzzles) {
  const game = new Chess();
  try {
    game.load(p.fen);
  } catch (e) {
    console.log(`❌ ${p.id}: bad FEN — ${e.message}`);
    failures++;
    continue;
  }
  const moves = p.solution;
  let ok = true;
  let detail = '';
  for (let i = 0; i < moves.length; i++) {
    const uci = moves[i];
    const from = uci.slice(0, 2);
    const to = uci.slice(2, 4);
    const promotion = uci.length > 4 ? uci[4] : undefined;
    try {
      game.move({ from, to, promotion });
    } catch (e) {
      ok = false;
      detail = `illegal move #${i + 1} (${uci})`;
      break;
    }
  }
  if (ok) {
    const isMatePuzzle = /\bmate\b|checkmate/i.test(p.theme || '');
    if (isMatePuzzle && !game.isCheckmate()) {
      ok = false;
      detail = `line played but final position is not checkmate (theme says mate)`;
    }
  }
  if (ok) {
    console.log(`✅ ${p.id}: ${p.theme} — line legal${game.isCheckmate() ? ' (checkmate confirmed)' : ''}`);
  } else {
    console.log(`❌ ${p.id}: ${detail}`);
    failures++;
  }
}
console.log(`\n${set.puzzles.length - failures}/${set.puzzles.length} puzzles valid.`);
process.exit(failures ? 1 : 0);
