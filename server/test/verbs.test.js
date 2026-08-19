// Die Verben, die in sim.test.js noch keine eigene Pruefung hatten: Bellen,
// Schnueffeln, die Erholungspause der Ausdauer und die Wahl der Pose.
// Jede haengt an einer Zahl aus sim.js -- genau die Sorte Wert, die man beim
// Nachjustieren aendert, ohne die Nebenwirkung zu bemerken.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BARK, SNIFF, STAM, DOG, BTN, DT, makePlayer, stepPlayer } from '../../shared/sim.js';

const WELT = { caches: [] };
const hund = () => makePlayer('t1', 'Tyson', 0);
const leer = { dx: 0, dy: 0, btn: 0 };

/** n Takte mit derselben Eingabe. */
function laufen(p, input, n, world = WELT) {
  for (let i = 0; i < n; i++) stepPlayer(p, input, world);
  return p;
}

// --- Bellen ----------------------------------------------------------------

test('Bellen hat eine Sperrzeit -- Dauerdruecken bellt nicht dauernd', () => {
  const p = hund();
  stepPlayer(p, { ...leer, btn: BTN.BARK }, WELT);
  assert.ok(p.barkT > 0, 'das erste Bellen kommt nicht');
  // Die Sperre wird NACH dem Herunterzaehlen gesetzt, steht also voll da.
  assert.equal(p.barkCd, BARK.cd);

  // gedrueckt halten, bis das Bellen vorbei ist: es darf nicht neu ausloesen
  laufen(p, { ...leer, btn: BTN.BARK }, Math.ceil(BARK.dur / DT) + 2);
  assert.equal(p.barkT, 0, 'Bellen wurde nachgeladen, obwohl die Sperre laeuft');

  // nach Ablauf der Sperre geht es wieder
  laufen(p, leer, Math.ceil(BARK.cd / DT));
  stepPlayer(p, { ...leer, btn: BTN.BARK }, WELT);
  assert.ok(p.barkT > 0, 'nach der Sperrzeit bellt der Hund nicht wieder');
});

test('Bellen laesst sich bewegen -- anders als Beissen', () => {
  const p = hund();
  const vorher = p.x;
  laufen(p, { dx: 1, dy: 0, btn: BTN.BARK }, 12);
  assert.ok(p.x > vorher + 20, 'der Hund blieb beim Bellen stehen');
});

test('Ein betaeubter Hund bellt nicht', () => {
  const p = hund();
  p.stunT = 1.0;
  laufen(p, { ...leer, btn: BTN.BARK }, 3);
  assert.equal(p.barkT, 0);
  assert.equal(p.barkCd, 0, 'die Sperre lief an, obwohl gar nicht gebellt wurde');
});

// --- Schnueffeln -----------------------------------------------------------

test('Schnueffeln laeuft nur abseits eines Depots -- darauf wird gegraben', () => {
  const aufWiese = hund();
  stepPlayer(aufWiese, { ...leer, btn: BTN.NOSE }, WELT);
  assert.ok(aufWiese.sniffT > 0, 'auf freier Wiese wird nicht geschnueffelt');
  assert.equal(aufWiese.digT, 0);

  const aufDepot = hund();
  const welt = { caches: [{ id: 1, x: aufDepot.x, y: aufDepot.y, taken: false }] };
  stepPlayer(aufDepot, { ...leer, btn: BTN.NOSE }, welt);
  assert.ok(aufDepot.digT > 0, 'auf dem Depot wird nicht gegraben');
  assert.equal(aufDepot.sniffT, 0, 'auf dem Depot wurde zusaetzlich geschnueffelt');
});

test('Wer sich bewegt, gräbt nicht -- er schnüffelt', () => {
  const p = hund();
  const welt = { caches: [{ id: 1, x: p.x, y: p.y, taken: false }] };
  laufen(p, { dx: 1, dy: 0, btn: BTN.NOSE }, 6, welt);
  assert.equal(p.digT, 0, 'im Laufen wurde gegraben');
  assert.ok(p.sniffT > 0);
});

test('Schnueffeln hat eine Sperrzeit', () => {
  const p = hund();
  stepPlayer(p, { ...leer, btn: BTN.NOSE }, WELT);
  const ersterRest = p.sniffT;
  laufen(p, { ...leer, btn: BTN.NOSE }, 5);
  assert.ok(p.sniffT < ersterRest, 'die Fährte wurde nachgeladen statt abzulaufen');
  assert.ok(p.sniffCd > 0);
});

// --- Ausdauer --------------------------------------------------------------

test('Nach dem Sprint vergeht eine Pause, bevor sich Ausdauer erholt', () => {
  const p = hund();
  const sprint = { dx: 1, dy: 0, btn: BTN.RUN };
  laufen(p, sprint, 20);
  const nachSprint = p.stam;
  assert.ok(nachSprint < STAM.max, 'der Sprint kostete nichts');

  // direkt nach dem Loslassen: noch keine Erholung (stamHold laeuft)
  stepPlayer(p, leer, WELT);
  assert.ok(p.stam <= nachSprint + 1e-9, 'die Erholung setzte ohne Pause ein');

  // nach Ablauf der Pause steigt sie wieder
  laufen(p, leer, Math.ceil(STAM.regenDelay / DT) + 4);
  assert.ok(p.stam > nachSprint, 'die Ausdauer erholt sich nicht');
});

test('Unter der Mindestausdauer wird aus Sprint wieder Gehen', () => {
  const p = hund();
  p.stam = STAM.runMin;                       // genau auf der Grenze
  laufen(p, { dx: 1, dy: 0, btn: BTN.RUN }, 40);
  const tempo = Math.hypot(p.vx, p.vy);
  assert.ok(tempo <= DOG.walk * 1.05, `lief mit ${tempo.toFixed(0)} statt Gehtempo ${DOG.walk}`);
});

// --- Pose ------------------------------------------------------------------

test('Die Pose folgt dem Zustand, nicht der Absicht', () => {
  const stehen = hund();
  stepPlayer(stehen, leer, WELT);
  assert.equal(stehen.anim, 'idle');

  const gehen = hund();
  laufen(gehen, { dx: 1, dy: 0, btn: 0 }, 15);
  assert.equal(gehen.anim, 'walk');

  const rennen = hund();
  laufen(rennen, { dx: 1, dy: 0, btn: BTN.RUN }, 15);
  assert.equal(rennen.anim, 'run');

  // Mit Knochen im Maul wird aus dem Gehen der Schleichgang.
  const tragen = hund();
  tragen.carrying = true;
  laufen(tragen, { dx: 1, dy: 0, btn: 0 }, 15);
  assert.equal(tragen.anim, 'prowl', 'der getragene Knochen zeigt keinen Schleichgang');

  const betaeubt = hund();
  betaeubt.stunT = 1;
  stepPlayer(betaeubt, { dx: 1, dy: 0, btn: 0 }, WELT);
  assert.equal(betaeubt.anim, 'stunned');
});

test('Betaeubung sticht jede andere Pose', () => {
  const p = hund();
  p.stunT = 1;
  p.carrying = true;
  stepPlayer(p, { dx: 1, dy: 0, btn: BTN.BITE | BTN.BARK | BTN.NOSE | BTN.RUN }, WELT);
  assert.equal(p.anim, 'stunned');
  assert.equal(p.biteT, 0, 'ein betaeubter Hund hat gebissen');
});
