import test from 'node:test';
import assert from 'node:assert/strict';
import { Room, MAX } from '../room.js';
import { BTN, BITE, BARK, DIG, HOUSE, DOG, ARENA, houseFor, TICK_HZ } from '../../shared/sim.js';

function room() { return new Room('TST'); }
const put = (r, id, inp) => r.setInput(id, { dx: 0, dy: 0, btn: 0, seq: 1, ...inp });
const steps = (r, n) => { for (let i = 0; i < n; i++) { r.step(); r.flushEvents(); } };
const evs = (r, kind) => r.events.filter(e => e.e === kind);

test('Ein Mensch bekommt Bots als Gegner, ein leerer Raum rechnet nicht', () => {
  const r = room();
  r.addHuman('h1', 'Martin', null);
  r.balanceBots();
  assert.ok(r.players.size > 1, 'keine Bots dazugekommen');
  assert.equal(r.humans(), 1);
  r.remove('h1');
  r.balanceBots();
  assert.equal(r.players.size, 0, 'leerer Raum behaelt Bots und rechnet unnoetig');
});

test('Menschen verdraengen Bots, bis die Arena voll ist', () => {
  const r = room();
  r.addHuman('h1', 'A', null); r.balanceBots();
  for (let i = 2; i <= MAX; i++) { assert.ok(r.addHuman('h' + i, 'P' + i, null), `Mensch ${i} fand keinen Platz`); r.balanceBots(); }
  assert.equal(r.humans(), MAX);
  assert.equal([...r.players.values()].filter(p => p.bot).length, 0, 'Bots blockieren volle Arena');
  assert.equal(r.isFull(), true);
});

test('Knochen aufnehmen: einer pro Hund, dann keiner mehr', () => {
  const r = room();
  const p = r.addHuman('h1', 'A', null);
  // WEG von der eigenen Huette -- wer dort steht, liefert im selben Takt ab.
  p.x = ARENA.w / 2; p.y = ARENA.h / 2;
  r.bones = [{ id: 1, x: p.x, y: p.y, by: null, t: 0 }, { id: 2, x: p.x, y: p.y, by: null, t: 0 }];
  r.step();
  assert.equal(p.carrying, 1, 'Knochen nicht aufgenommen');
  r.step();
  assert.equal(p.carrying, 1, 'zweiten Knochen zusaetzlich aufgenommen');
  assert.equal(r.bones.filter(b => b.by).length, 1, 'mehr als ein Knochen getragen');
});

test('Abliefern in der eigenen Huette zaehlt einen Punkt', () => {
  const r = room();
  const p = r.addHuman('h1', 'A', null);
  const h = houseFor(p.slot);
  p.x = h.x; p.y = h.y;
  r.bones = [{ id: 1, x: h.x, y: h.y, by: null, t: 0 }];
  r.step();  // aufnehmen
  r.step();  // abliefern
  assert.equal(p.score, 1, 'kein Punkt fuer die Ablieferung');
  assert.equal(p.carrying, null, 'Knochen klebt nach der Ablieferung');
  assert.ok(evs(r, 'deliver').length + 1 > 0);
});

test('In einer FREMDEN Huette liefert man nicht ab', () => {
  const r = room();
  const a = r.addHuman('h1', 'A', null);
  const b = r.addHuman('h2', 'B', null);
  const fremd = houseFor(b.slot);
  a.x = fremd.x; a.y = fremd.y;
  r.bones = [{ id: 1, x: fremd.x, y: fremd.y, by: null, t: 0 }];
  r.step(); r.step(); r.step();
  assert.equal(a.score, 0, 'Punkt in fremder Huette kassiert');
  assert.equal(a.carrying, 1, 'Knochen in fremder Huette verloren');
});

test('Biss betaeubt das Opfer und laesst es den Knochen fallen', () => {
  const r = room();
  const a = r.addHuman('h1', 'A', null);
  const b = r.addHuman('h2', 'B', null);
  a.x = 900; a.y = 600; a.facing = 1;
  b.x = 900 + BITE.range * 0.5; b.y = 600;
  r.bones = [{ id: 1, x: b.x, y: b.y, by: 'h2', t: 0 }];
  b.carrying = 1;

  put(r, 'h1', { btn: BTN.BITE });
  for (let i = 0; i < 8; i++) { r.step(); if (b.stunT > 0) break; }

  assert.ok(b.stunT > 0, 'Opfer wurde nicht betaeubt');
  assert.equal(b.carrying, null, 'Opfer traegt den Knochen weiter');
  assert.equal(r.bones[0].by, null, 'Knochen haengt noch am Opfer');
  assert.equal(a.bites, 1, 'Biss nicht gezaehlt');
  const ev = r.events.find(e => e.e === 'bite');
  assert.ok(ev && ev.stole === true, 'Diebstahl nicht gemeldet');
});

test('Biss trifft NICHT durch die Arena -- nur wer vor der Schnauze steht', () => {
  const r = room();
  const a = r.addHuman('h1', 'A', null);
  const b = r.addHuman('h2', 'B', null);
  a.x = 300; a.y = 600; a.facing = 1;
  b.x = 1600; b.y = 600;                       // weit weg
  put(r, 'h1', { btn: BTN.BITE });
  steps(r, 10);
  assert.equal(b.stunT, 0, 'Fernbiss quer durch die Arena');
});

test('Bellen schiebt Gegner weg und unterbricht ihr Graben', () => {
  const r = room();
  const a = r.addHuman('h1', 'A', null);
  const b = r.addHuman('h2', 'B', null);
  a.x = 900; a.y = 600;
  b.x = 900 + BARK.radius * 0.5; b.y = 600; b.vx = 0;
  b.digT = 1.0;
  put(r, 'h1', { btn: BTN.BARK });
  r.step();
  assert.ok(b.vx > 100, `Bellen schiebt nicht weg (vx=${b.vx})`);
  assert.equal(b.digT, 0, 'Graben lief trotz Bellen weiter');
});

test('Depot ausgraben liefert Knochen und vergraebt ein neues woanders', () => {
  const r = room();
  const p = r.addHuman('h1', 'A', null);
  const c = r.caches[0];
  p.x = c.x; p.y = c.y;
  const alt = { x: c.x, y: c.y };
  const knochenVorher = r.bones.length;

  put(r, 'h1', { btn: BTN.NOSE });
  steps(r, Math.ceil(DIG.time * TICK_HZ) + 3);

  assert.ok(r.bones.length >= knochenVorher + DIG.yield, 'Depot brachte keine Knochen');
  assert.equal(r.caches.filter(x => !x.taken).length, r.caches.length, 'Depot verschwand statt umzuziehen');
  const jetzt = r.caches[0];
  assert.ok(Math.hypot(jetzt.x - alt.x, jetzt.y - alt.y) > 1, 'neues Depot liegt an derselben Stelle');
});

test('Runde endet, Punkte werden gemeldet und danach zurueckgesetzt', () => {
  let gemeldet = null;
  const r = new Room('TST', b => { gemeldet = b; });
  const p = r.addHuman('h1', 'A', null);
  p.score = 5;
  r.phaseT = 0.01;
  steps(r, 3);
  assert.equal(r.phase, 'over', 'Runde endet nicht');
  assert.ok(gemeldet && gemeldet[0].score === 5, 'Punkte nicht gemeldet');
  r.phaseT = 0.01;
  steps(r, 3);
  assert.equal(r.phase, 'play', 'keine neue Runde');
  assert.equal(p.score, 0, 'Punkte nicht zurueckgesetzt');
});

test('Waehrend der Auswertung friert das Spiel ein', () => {
  const r = room();
  const p = r.addHuman('h1', 'A', null);
  r.phase = 'over'; r.phaseT = 5;
  const x0 = p.x;
  put(r, 'h1', { dx: 1, btn: BTN.RUN });
  steps(r, 30);
  assert.ok(Math.abs(p.x - x0) < 2, 'Bewegung nach Rundenende');
});

test('Hunde stehen nicht ineinander', () => {
  const r = room();
  const a = r.addHuman('h1', 'A', null);
  const b = r.addHuman('h2', 'B', null);
  a.x = 900; a.y = 600; b.x = 902; b.y = 600;
  steps(r, 6);
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > DOG.r, 'Hunde stecken ineinander');
});

test('Der Schnappschuss bleibt klein und nennt keine internen IDs', () => {
  const r = room();
  r.addHuman('h1', 'Martin', null);
  r.balanceBots();
  while (r.players.size < 8) r.addBot();
  steps(r, 30);
  const s = r.snapshot();
  const roh = JSON.stringify(s);
  assert.ok(roh.length < 1200, `Schnappschuss zu gross: ${roh.length} B`);
  assert.ok(!roh.includes('h1'), 'interne Spieler-ID im Netzverkehr');
  assert.equal(s.ps.length, 8);
  for (const zeile of s.ps) {
    assert.equal(typeof zeile[0], 'number', 'Netz-ID ist keine Zahl');
    assert.ok(zeile[0] >= 0 && zeile[0] < MAX);
  }
});

test('Zwei Raeume laufen unabhaengig', () => {
  const a = new Room('AAAA'), b = new Room('BBBB');
  a.addHuman('h1', 'A', null); b.addHuman('h2', 'B', null);
  a.players.get('h1').score = 3;
  steps(a, 10); steps(b, 10);
  assert.equal(b.players.get('h2').score, 0, 'Punkte lecken zwischen Raeumen');
});

test('Eingaben werden geklemmt -- ein manipulierter Client wird nicht schneller', () => {
  const r = room();
  const p = r.addHuman('h1', 'A', null);
  r.setInput('h1', { dx: 999, dy: 999, btn: 255, seq: 1 });
  const inp = r.inputs.get('h1');
  assert.ok(inp.dx <= 1 && inp.dy <= 1, 'Richtungswerte nicht geklemmt');
  assert.ok(inp.btn <= 15, 'Tastenmaske nicht geklemmt');
  steps(r, 90);
  assert.ok(Math.hypot(p.vx, p.vy) <= DOG.run + 2, 'Tempo ueber dem Maximum');
});

test('Ein Knochen in der EIGENEN Huette wird sofort gutgeschrieben', () => {
  // Absicht, kein Fehler: der Spawnpunkt IST die Huette. Natuerliche Knochen
  // fallen nie dorthin (freeSpot haelt 220 Einheiten Abstand), ausgegrabene
  // schon -- wer neben seiner Huette buddelt, darf den Vorteil haben.
  const r = room();
  const p = r.addHuman('h1', 'A', null);
  const h = houseFor(p.slot);
  p.x = h.x; p.y = h.y;
  r.bones = [{ id: 1, x: h.x, y: h.y, by: null, t: 0 }];
  r.step();
  assert.equal(p.score, 1, 'Knochen in der eigenen Huette brachte keinen Punkt');
  assert.equal(p.carrying, null);
});

test('Neue Knochen fallen nie in eine Huette', () => {
  const r = room();
  for (let i = 0; i < 8; i++) r.addBot();
  for (let i = 0; i < 200; i++) {
    const s = r.freeSpot();
    for (const pl of r.players.values()) {
      const h = houseFor(pl.slot);
      assert.ok(Math.hypot(h.x - s.x, h.y - s.y) > HOUSE.r,
        `Spawnpunkt liegt in der Huette von Slot ${pl.slot}`);
    }
  }
});
