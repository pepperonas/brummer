import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DT, ARENA, DOG, BITE, BARK, SNIFF, DIG, STAM, BTN,
  makePlayer, stepPlayer, biteHits, cacheAt, houseFor,
} from '../../shared/sim.js';

const W = { caches: [] };
const run = (p, inp, n, world = W) => { for (let i = 0; i < n; i++) stepPlayer(p, inp, world); return p; };
const fresh = (slot = 0) => { const p = makePlayer('t', 'T', slot); p.x = 900; p.y = 600; return p; };

test('Gehen erreicht genau die Sollgeschwindigkeit und nicht mehr', () => {
  const p = run(fresh(), { dx: 1, dy: 0, btn: 0 }, 120);
  assert.ok(Math.abs(Math.hypot(p.vx, p.vy) - DOG.walk) < 1,
    `Gehtempo ${Math.hypot(p.vx, p.vy)} statt ${DOG.walk}`);
});

test('Sprint ist schneller, kostet Ausdauer und erholt sich wieder', () => {
  const p = fresh();
  run(p, { dx: 1, dy: 0, btn: BTN.RUN }, 60);
  assert.ok(Math.hypot(p.vx, p.vy) > DOG.walk + 40, 'Sprint nicht schneller');
  assert.ok(p.stam < STAM.max - 20, 'Ausdauer wurde nicht verbraucht');
  const low = p.stam;
  run(p, { dx: 0, dy: 0, btn: 0 }, 120);
  assert.ok(p.stam > low, 'Ausdauer erholt sich nicht');
});

test('Leere Ausdauer erzwingt Gehtempo', () => {
  const p = fresh();
  p.stam = 2;
  run(p, { dx: 1, dy: 0, btn: BTN.RUN }, 90);
  assert.ok(Math.hypot(p.vx, p.vy) <= DOG.walk + 2, 'Sprint trotz leerer Ausdauer');
});

test('Diagonale ist nicht schneller als gerade (normalisierte Eingabe)', () => {
  const a = run(fresh(), { dx: 1, dy: 0, btn: 0 }, 120);
  const b = run(fresh(), { dx: 1, dy: 1, btn: 0 }, 120);
  assert.ok(Math.abs(Math.hypot(a.vx, a.vy) - Math.hypot(b.vx, b.vy)) < 2,
    'Diagonale schneller -- Eingabe wird nicht normalisiert');
});

test('Der Hund verlaesst die Arena nicht', () => {
  const p = fresh();
  run(p, { dx: -1, dy: -1, btn: BTN.RUN }, 600);
  assert.ok(p.x >= DOG.r + ARENA.pad - 0.01 && p.y >= DOG.r + ARENA.pad - 0.01, 'links/oben ausgebrochen');
  run(p, { dx: 1, dy: 1, btn: BTN.RUN }, 900);
  assert.ok(p.x <= ARENA.w - DOG.r - ARENA.pad + 0.01, 'rechts ausgebrochen');
  assert.ok(p.y <= ARENA.h - DOG.r - ARENA.pad + 0.01, 'unten ausgebrochen');
});

test('Biss trifft nur nach vorn, nicht nach hinten', () => {
  const a = fresh(); a.facing = 1;
  const vorn  = { ...fresh(), x: a.x + BITE.range * 0.6, y: a.y };
  const hint  = { ...fresh(), x: a.x - BITE.range * 0.6, y: a.y };
  const weit  = { ...fresh(), x: a.x + BITE.range + DOG.r + 30, y: a.y };
  assert.equal(biteHits(a, vorn), true,  'Ziel direkt vor der Schnauze nicht getroffen');
  assert.equal(biteHits(a, hint), false, 'Biss trifft nach hinten');
  assert.equal(biteHits(a, weit), false, 'Biss trifft ausserhalb der Reichweite');
});

test('Umgedrehter Hund trifft in die andere Richtung', () => {
  const a = fresh(); a.facing = -1;
  const links = { ...fresh(), x: a.x - BITE.range * 0.6, y: a.y };
  assert.equal(biteHits(a, links), true);
});

test('Biss hat eine Sperrzeit -- Dauerdruecken beisst nicht dauernd', () => {
  const p = fresh();
  stepPlayer(p, { dx: 0, dy: 0, btn: BTN.BITE }, W);
  const erster = p.biteCd;
  assert.ok(erster > 0, 'keine Sperrzeit gesetzt');
  run(p, { dx: 0, dy: 0, btn: BTN.BITE }, 5);
  assert.ok(p.biteCd < erster, 'Sperrzeit laeuft nicht ab');
  assert.ok(p.biteCd > BITE.cd - 0.3, 'Sperrzeit wurde neu gesetzt trotz Sperre');
});

test('Waehrend des Bisses kann man nicht steuern, aber der Hechtsprung traegt', () => {
  const p = fresh(); p.facing = 1;
  const x0 = p.x;
  stepPlayer(p, { dx: 0, dy: 0, btn: BTN.BITE }, W);
  run(p, { dx: -1, dy: 0, btn: 0 }, 6);            // versucht rueckwaerts zu laufen
  assert.ok(p.x > x0 + 20, 'Hechtsprung traegt nicht nach vorn');
});

test('Betaeubung friert die Bewegung ein', () => {
  const p = fresh();
  p.stunT = 1.0;
  const x0 = p.x;
  run(p, { dx: 1, dy: 0, btn: BTN.RUN }, 20);
  assert.ok(Math.abs(p.x - x0) < 6, `betaeubt trotzdem ${Math.abs(p.x - x0)} weit gelaufen`);
  assert.equal(p.anim, 'stunned');
});

test('Graben nur auf einem Depot und nur im Stehen', () => {
  const world = { caches: [{ x: 900, y: 600, taken: false }] };
  const p = fresh();
  run(p, { dx: 0, dy: 0, btn: BTN.NOSE }, 10, world);
  assert.ok(p.digT > 0, 'auf dem Depot wird nicht gegraben');

  const q = fresh(); q.x = 100 + ARENA.pad; q.y = 100 + ARENA.pad;
  run(q, { dx: 0, dy: 0, btn: BTN.NOSE }, 10, world);
  assert.equal(q.digT, 0, 'ausserhalb eines Depots wird gegraben');
  assert.ok(q.sniffT > 0, 'Nase ohne Depot loest kein Schnueffeln aus');

  const r = fresh();
  run(r, { dx: 1, dy: 0, btn: BTN.NOSE }, 10, world);
  assert.equal(r.digT, 0, 'Graben waehrend des Laufens');
});

test('Getragener Knochen bremst', () => {
  const frei = run(fresh(), { dx: 1, dy: 0, btn: 0 }, 120);
  const voll = fresh(); voll.carrying = 7;
  run(voll, { dx: 1, dy: 0, btn: 0 }, 120);
  assert.ok(Math.hypot(voll.vx, voll.vy) < Math.hypot(frei.vx, frei.vy) - 5,
    'Tragen bremst nicht');
});

test('Huetten liegen alle in der Arena und keine zwei aufeinander', () => {
  const seen = [];
  for (let i = 0; i < 8; i++) {
    const h = houseFor(i);
    assert.ok(h.x > 0 && h.x < ARENA.w && h.y > 0 && h.y < ARENA.h, `Huette ${i} ausserhalb`);
    for (const o of seen) assert.ok(Math.hypot(o.x - h.x, o.y - h.y) > 200, `Huetten ${i} zu dicht`);
    seen.push(h);
  }
});

test('Simulation ist deterministisch -- Grundlage der Vorhersage', () => {
  // Server und Client rechnen dieselbe Eingabefolge. Weichen sie ab,
  // ruckelt die eigene Figur bei jedem Schnappschuss.
  const folge = Array.from({ length: 200 }, (_, i) => ({
    dx: Math.sin(i * 0.3), dy: Math.cos(i * 0.17),
    btn: (i % 40 === 0 ? BTN.BITE : 0) | (i % 7 < 3 ? BTN.RUN : 0),
  }));
  const world = { caches: [{ x: 900, y: 600, taken: false }] };
  const a = fresh(), b = fresh();
  for (const inp of folge) stepPlayer(a, inp, world);
  for (const inp of folge) stepPlayer(b, inp, world);
  assert.equal(a.x, b.x); assert.equal(a.y, b.y);
  assert.equal(a.vx, b.vx); assert.equal(a.vy, b.vy);
  assert.equal(a.stam, b.stam); assert.equal(a.anim, b.anim);
});

test('cacheAt findet nur nicht gehobene Depots im Radius', () => {
  const world = { caches: [
    { x: 500, y: 500, taken: false },
    { x: 900, y: 600, taken: true },
  ]};
  assert.ok(cacheAt(world, 500, 500), 'Depot unter den Pfoten nicht gefunden');
  assert.ok(cacheAt(world, 500 + 20, 500 + 20), 'Depot im Radius nicht gefunden');
  assert.equal(cacheAt(world, 500, 500 + 200), null, 'Depot ausser Reichweite gefunden');
  assert.equal(cacheAt(world, 900, 600), null, 'bereits gehobenes Depot gefunden');
});
