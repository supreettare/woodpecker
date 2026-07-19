// All persistence lives in localStorage so the app needs no server and no
// account. Everything is scoped to one device / one learner — exactly the
// single-individual use case this trainer is built for.

const K = {
  sets: 'woodpecker.sets',                 // [{id,name,count,importedAt}]
  puzzles: (id) => `woodpecker.set.${id}.puzzles`,
  progress: (id) => `woodpecker.set.${id}.progress`,
  settings: 'woodpecker.settings',
};

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}
function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

export const store = {
  listSets() {
    return read(K.sets, []);
  },

  getSet(id) {
    return this.listSets().find((s) => s.id === id) || null;
  },

  addSet({ id, name, puzzles }) {
    const meta = {
      id,
      name,
      count: puzzles.length,
      importedAt: new Date().toISOString(),
    };
    const sets = this.listSets().filter((s) => s.id !== id);
    sets.push(meta);
    write(K.sets, sets);
    write(K.puzzles(id), puzzles);
    if (!read(K.progress(id), null)) {
      write(K.progress(id), { cycles: [], current: null });
    }
    return meta;
  },

  renameSet(id, name) {
    const sets = this.listSets();
    const s = sets.find((x) => x.id === id);
    if (s) { s.name = name; write(K.sets, sets); }
  },

  deleteSet(id) {
    write(K.sets, this.listSets().filter((s) => s.id !== id));
    localStorage.removeItem(K.puzzles(id));
    localStorage.removeItem(K.progress(id));
  },

  getPuzzles(id) {
    return read(K.puzzles(id), []);
  },

  getProgress(id) {
    return read(K.progress(id), { cycles: [], current: null });
  },

  saveProgress(id, progress) {
    write(K.progress(id), progress);
  },

  getSettings() {
    const defaults = {
      perPuzzleLimitSec: 0,   // 0 = no per-puzzle limit (still tracks time)
      shuffle: true,          // randomize order for each new cycle
      showExplanations: true,
      allowRetry: true,       // let the learner retry after a wrong first move
      sound: true,            // move/capture/success sound effects
      autoAdvance: true,      // auto-load the next puzzle after solving
    };
    // Merge over defaults so settings saved before a new option existed still
    // pick up that option's default.
    return { ...defaults, ...read(K.settings, {}) };
  },

  saveSettings(s) {
    write(K.settings, { ...this.getSettings(), ...s });
  },

  // Rough export/backup of everything, so progress can be moved between
  // devices or kept safe.
  exportAll() {
    const dump = { sets: [], settings: this.getSettings() };
    for (const meta of this.listSets()) {
      dump.sets.push({
        meta,
        puzzles: this.getPuzzles(meta.id),
        progress: this.getProgress(meta.id),
      });
    }
    return dump;
  },

  importAll(dump) {
    if (dump.settings) this.saveSettings(dump.settings);
    for (const s of dump.sets || []) {
      this.addSet({ id: s.meta.id, name: s.meta.name, puzzles: s.puzzles });
      if (s.progress) this.saveProgress(s.meta.id, s.progress);
    }
  },
};
