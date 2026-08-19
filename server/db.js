// Bestenliste. Bewusst ohne Konten: jeder Browser bekommt einen anonymen
// Sechs-Zeichen-Code (wie die Pokemon-Cloud-Sicherung) und kann ihn auf ein
// anderes Geraet uebertragen.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DIR, { recursive: true });

export const db = new Database(path.join(DIR, 'brummer.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS players (
  code    TEXT PRIMARY KEY,
  name    TEXT NOT NULL DEFAULT 'Hund',
  games   INTEGER NOT NULL DEFAULT 0,
  wins    INTEGER NOT NULL DEFAULT 0,
  score   INTEGER NOT NULL DEFAULT 0,
  bites   INTEGER NOT NULL DEFAULT 0,
  best    INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  seen    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_players_score ON players(score DESC);
CREATE TABLE IF NOT EXISTS rounds (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  room    TEXT NOT NULL,
  ended   INTEGER NOT NULL,
  players INTEGER NOT NULL,
  top     TEXT NOT NULL
);
`);

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // ohne I L O 0 1

export function newCode() {
  for (let tries = 0; tries < 50; tries++) {
    let c = '';
    for (let i = 0; i < 6; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
    if (!db.prepare('SELECT 1 FROM players WHERE code=?').get(c)) return c;
  }
  throw new Error('kein freier Code');
}

export function ensurePlayer(code, name) {
  const now = Date.now();
  const row = db.prepare('SELECT * FROM players WHERE code=?').get(code);
  if (row) {
    if (name && name !== row.name) {
      db.prepare('UPDATE players SET name=?, seen=? WHERE code=?').run(name, now, code);
      row.name = name;
    } else {
      db.prepare('UPDATE players SET seen=? WHERE code=?').run(now, code);
    }
    return row;
  }
  const c = code && /^[A-Z2-9]{6}$/.test(code) ? code : newCode();
  db.prepare('INSERT INTO players (code,name,created,seen) VALUES (?,?,?,?)')
    .run(c, name || 'Hund', now, now);
  return db.prepare('SELECT * FROM players WHERE code=?').get(c);
}

export function recordRound(room, board) {
  const humans = board.filter(b => !b.bot);
  if (!humans.length) return;
  const now = Date.now();
  db.prepare('INSERT INTO rounds (room,ended,players,top) VALUES (?,?,?,?)')
    .run(room, now, humans.length, JSON.stringify(board.slice(0, 3)));
  const winner = board[0];
  const up = db.prepare(`UPDATE players
      SET games=games+1, wins=wins+?, score=score+?, bites=bites+?, best=MAX(best,?), seen=?
      WHERE code=?`);
  const tx = db.transaction(rows => {
    for (const r of rows) {
      if (!r.code) continue;
      up.run(winner && winner.id === r.id && !winner.bot ? 1 : 0, r.score, r.bites, r.score, now, r.code);
    }
  });
  tx(humans);
}

export function leaderboard(limit = 20) {
  return db.prepare(`SELECT name, score, games, wins, best, bites FROM players
                     WHERE games > 0 ORDER BY score DESC, best DESC LIMIT ?`).all(limit);
}

export function stats(code) {
  return db.prepare('SELECT code,name,games,wins,score,bites,best FROM players WHERE code=?').get(code) || null;
}
