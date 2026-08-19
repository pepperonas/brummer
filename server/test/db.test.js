import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-test-'));
const { ensurePlayer, recordRound, leaderboard, stats, newCode } = await import('../db.js');

test('Codes sind verwechslungsarm -- kein I, L, O, 0 oder 1', () => {
  for (let i = 0; i < 200; i++) {
    const c = newCode();
    assert.match(c, /^[A-HJ-NP-Z2-9]{6}$/, `zweideutiger Code: ${c}`);
    assert.ok(!/[ILO01]/.test(c), `verwechselbares Zeichen in ${c}`);
  }
});

test('Derselbe Code liefert dasselbe Konto, ein neuer Name wird uebernommen', () => {
  const a = ensurePlayer(null, 'Martin');
  const b = ensurePlayer(a.code, 'Martin');
  assert.equal(a.code, b.code, 'Code wechselt bei erneutem Aufruf');
  const c = ensurePlayer(a.code, 'Tyson');
  assert.equal(c.name, 'Tyson', 'Namensaenderung nicht uebernommen');
  assert.equal(c.code, a.code, 'Namensaenderung erzeugt neues Konto');
});

test('Ein unbekannter oder unsinniger Code erzeugt ein frisches Konto', () => {
  const a = ensurePlayer('kaputt!', 'X');
  assert.match(a.code, /^[A-HJ-NP-Z2-9]{6}$/);
  const b = ensurePlayer('', 'Y');
  assert.notEqual(a.code, b.code);
});

test('Rundenergebnis schreibt Punkte, Siege und Bestwert fort', () => {
  const p = ensurePlayer(null, 'Sieger');
  const q = ensurePlayer(null, 'Zweiter');
  recordRound('AAAA', [
    { id: 0, name: 'Sieger',  score: 7, bites: 3, code: p.code },
    { id: 1, name: 'Zweiter', score: 4, bites: 1, code: q.code },
  ]);
  const s = stats(p.code);
  assert.equal(s.games, 1); assert.equal(s.wins, 1);
  assert.equal(s.score, 7); assert.equal(s.best, 7); assert.equal(s.bites, 3);
  const z = stats(q.code);
  assert.equal(z.wins, 0, 'Zweiter bekam einen Sieg');

  // zweite Runde: Punkte summieren, Bestwert nur wenn hoeher
  recordRound('AAAA', [{ id: 0, name: 'Sieger', score: 3, bites: 1, code: p.code }]);
  const s2 = stats(p.code);
  assert.equal(s2.score, 10, 'Punkte summieren nicht');
  assert.equal(s2.best, 7, 'Bestwert wurde vom schlechteren Ergebnis ueberschrieben');
});

test('Bots landen NICHT in der Bestenliste', () => {
  const before = leaderboard(50).length;
  recordRound('BBBB', [
    { id: 0, name: 'Brutus', score: 99, bites: 9, bot: true },
    { id: 1, name: 'Rocky',  score: 98, bites: 8, bot: true },
  ]);
  const after = leaderboard(50);
  assert.equal(after.length, before, 'Bot in der Bestenliste');
  assert.ok(!after.some(r => r.score >= 98), 'Bot-Punktstand in der Tabelle');
});

test('Eine reine Bot-Runde wird gar nicht erst gespeichert', () => {
  const vorher = leaderboard(50).map(r => r.score).join(',');
  recordRound('CCCC', [{ id: 0, name: 'Nala', score: 42, bites: 4, bot: true }]);
  assert.equal(leaderboard(50).map(r => r.score).join(','), vorher);
});

test('Die Bestenliste sortiert absteigend nach Punkten', () => {
  const t = leaderboard(50);
  for (let i = 1; i < t.length; i++) {
    assert.ok(t[i - 1].score >= t[i].score, 'Bestenliste ist nicht sortiert');
  }
});
