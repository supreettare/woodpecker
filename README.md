# 🪵🔨 Woodpecker Trainer

A small, offline web app for training tactics the **Woodpecker way**: solve a
fixed set of puzzles, then repeat the *same* set again and again — faster each
cycle — until the patterns become automatic. Built for one learner on one
device, with time tracking, scoring, and a speed-up chart across repetitions.

> **Bring your own puzzles.** This app ships **no** puzzle-book content. It's an
> empty trainer: you import a puzzle file you have the right to use (a set you
> own, a free [Lichess](https://database.lichess.org/#puzzles) export, your
> coach's PGN, etc.). A tiny sample set of generic teaching positions is
> included just so the app works on first launch.

---

## What it does

- **Import a puzzle set** from JSON, Lichess CSV, or PGN.
- **Run a cycle** — play through every puzzle once, in order (the Woodpecker
  method keeps the order fixed across cycles).
- **Time-boxed** — a live cycle clock, plus an optional per-puzzle time limit.
- **Scoring** — first-attempt accuracy per cycle; retries and reveals count as
  "not clean".
- **Answers & explanations** — a wrong move is named in algebraic notation and
  you can reveal the full solution, which plays out on the board with the
  puzzle's written explanation.
- **Speed-up tracking** — every completed cycle is saved; a chart shows total
  time dropping cycle over cycle. This is the whole point of the method.
- **All local** — progress lives in your browser (localStorage). No account, no
  server, no internet. Export/restore a backup file to move between devices.

---

## Running it

The app uses JavaScript modules, so it needs to be *served* over `http://`
(opening `index.html` directly as a `file://` won't load the modules in most
browsers). Any static server works — pick one:

**Easiest (Python, pre-installed on macOS/Linux):**
```bash
cd woodpecker
python3 -m http.server 8000
# then open http://localhost:8000 in your browser
```

**Node:**
```bash
cd woodpecker
npx serve .          # or: npx http-server .
```

**Convenience script** (starts a server and opens your browser):
```bash
./start.sh           # macOS / Linux
```

---

## Importing your own puzzle book

Pick whichever format is easiest for the source you have.

### 1. JSON (native format — best for hand-entering a book)

```json
{
  "name": "My Woodpecker Set",
  "puzzles": [
    {
      "fen": "6k1/5ppp/8/8/8/8/8/R6K w - - 0 1",
      "solution": ["a1a8"],
      "theme": "Back-rank mate",
      "explanation": "Ra8# — the king is trapped by its own pawns."
    },
    {
      "fen": "r4rk1/pp3ppp/8/8/8/8/PP3PPP/2R1R1K1 w - - 0 1",
      "solution": ["Re1e8", "Rf8e8", "Rc1e8"],
      "theme": "Back-rank, deflection",
      "explanation": "Doubling on the open file wins the back rank."
    }
  ]
}
```

Field reference (per puzzle):

| Field         | Required | Notes |
|---------------|----------|-------|
| `fen`         | ✅ | Starting position. The side to move in the FEN is the solver. |
| `solution`    | ✅ | The solution line. **UCI** (`e2e4`, `e7e8q`) **or SAN** (`Nf3`, `Rxe8+`). Include the opponent's replies too — the app auto-plays them. |
| `explanation` |  | Shown after solving or revealing. |
| `theme`       |  | Free text label (e.g. "Fork", "Back-rank"). |
| `rating`      |  | Optional difficulty number, displayed as-is. |
| `sideFirst`   |  | `"solver"` (default) or `"opponent"`. Use `"opponent"` if the first move in `solution` is the opponent's setup move (Lichess style). |
| `id`          |  | Optional stable id; auto-generated if omitted. |

Every puzzle is checked for legality at import time; anything whose line
doesn't play out legally is skipped (so a typo can't crash a session).

### 2. Lichess CSV

Drop in a CSV from the [Lichess puzzle database](https://database.lichess.org/#puzzles)
(or a filtered slice of it). The importer reads the standard header
`PuzzleId,FEN,Moves,Rating,…,Themes,…`. Lichess encodes the opponent's setup
move as the first move, which the importer handles automatically. This is the
easiest way to build a large, free, Woodpecker-style set at a chosen rating
band — great for a 1400-rated player who wants, say, 300 puzzles rated
1300–1600.

### 3. PGN

Any PGN where each game/puzzle has a `[FEN "…"]` tag. The mainline becomes the
solution; the side to move in the FEN is the solver. Comments, variations, and
NAGs are ignored.

---

## The method (how to actually use it)

1. Import a set (start with maybe 200–500 puzzles for a first project).
2. Run **cycle 1** end to end — don't worry about the clock, just solve.
3. Run the **same set again** as cycle 2, then 3, 4… Each cycle, aim to keep
   accuracy high while the total time drops.
4. Watch the speed-up chart on the set's card. When you can blitz the whole set
   quickly and accurately, the patterns are internalized — move to a new set.

The per-puzzle time limit (Training options) is optional; leave it at `0` while
learning a set and add a limit later to sharpen speed.

---

## Verifying the sample data

```bash
node data/validate.mjs data/sample-puzzles.json
```

Checks every puzzle's line for legality (and that "mate" puzzles actually end
in checkmate). Point it at your own JSON file to validate it before importing.

---

## Tech notes

- Vanilla JS, no build step, no framework.
- [`chess.js`](https://github.com/jhlywa/chess.js) (BSD-2-Clause) is vendored in
  `vendor/` for move legality and SAN/UCI conversion — the only third-party
  dependency.
- The board is a small self-contained renderer (`js/board.js`); no board
  library, no external images (Unicode piece glyphs).
- Data model and persistence: `js/storage.js`. Session/scoring engine:
  `js/trainer.js`. Import parsers: `js/import.js`. UI: `js/app.js`.
