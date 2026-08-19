// Zeigersteuerung (Diablo-Art): linke Taste halten laesst den Hund zum
// Mauszeiger laufen, die rechte beisst.
//
// Der heikle Teil ist die Entzerrung: auf dem Schirm ist die Tiefe auf 62 %
// gestaucht (SQUASH). Wer den Bildschirmvektor ungerechnet als Weltrichtung
// nimmt, schickt den Hund bei jedem schraegen Ziel daneben.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(HERE, '..');

const noop = () => {};
const ctx2d = () => new Proxy({}, {
  get: (o, k) => (k in o ? o[k] : (o[k] = noop)),
  set: (o, k, v) => ((o[k] = v), true),
});
globalThis.matchMedia = () => ({ matches: false });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: ctx2d }) };
globalThis.devicePixelRatio = 1;

// Fenster-Handler auffangen, damit der Input-Konstruktor durchlaeuft
const fenster = {};
globalThis.addEventListener = (t, fn) => { fenster[t] = fn; };

const atlas = JSON.parse(fs.readFileSync(path.join(CLIENT, 'public/assets/atlas.json'), 'utf8'));
const { Renderer, SQUASH } = await import('../src/render.js');
const { Input } = await import('../src/input.js');
const { BTN } = await import('../../shared/sim.js');

function renderer() {
  const cv = { width: 1280, height: 720, clientWidth: 1280, clientHeight: 720, getContext: ctx2d };
  const r = new Renderer(cv, {}, atlas);
  r.dpr = 1; r.vw = 1280; r.vh = 720;
  r.cam = { x: 900, y: 600, zoom: 1 };
  return r;
}

/** Input mit aufgefangenen Canvas-Handlern. */
function eingabe() {
  const cv = {
    addEventListener: (t, fn) => { cv._h[t] = fn; },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    setPointerCapture: noop,
    _h: {},
  };
  const i = new Input(cv);
  const maus = (typ, button, x, y) => cv._h[typ]({
    pointerType: 'mouse', button, clientX: x, clientY: y,
    pointerId: 1, preventDefault: noop,
  });
  return { input: i, maus };
}

// --- Entzerrung -------------------------------------------------------------

test('⚠️ Die Weltrichtung rechnet die Stauchung heraus', () => {
  const r = renderer();
  const [sx, sy] = r.toScreen(900, 600);
  const a = r.aimDelta(sx + 100, sy + 100, 900, 600);   // 45 Grad auf dem SCHIRM

  assert.ok(Math.abs(a.dx - 100) < 1e-6, `dx ${a.dx}`);
  // 100 Bildschirmpunkte Tiefe sind 100/SQUASH Welteinheiten
  assert.ok(Math.abs(a.dy - 100 / SQUASH) < 1e-6,
    `dy ${a.dy.toFixed(1)} statt ${(100 / SQUASH).toFixed(1)} -- Stauchung nicht herausgerechnet`);
  assert.ok(a.dy > a.dx, 'in der Welt ist der Weg nach hinten LAENGER als er aussieht');
});

test('Gerade nach rechts bleibt gerade nach rechts', () => {
  const r = renderer();
  const [sx, sy] = r.toScreen(900, 600);
  const a = r.aimDelta(sx + 200, sy, 900, 600);
  assert.equal(a.dy, 0);
  assert.ok(a.dx > 0);
});

test('Der Zoom kuerzt sich aus der Richtung heraus', () => {
  const r1 = renderer(), r2 = renderer();
  r2.cam.zoom = 2.5;
  const [ax, ay] = r1.toScreen(900, 600);
  const [bx, by] = r2.toScreen(900, 600);
  const a = r1.aimDelta(ax + 100, ay + 60, 900, 600);
  const b = r2.aimDelta(bx + 250, by + 150, 900, 600);   // derselbe Punkt bei 2,5x
  const winkelA = Math.atan2(a.dy, a.dx), winkelB = Math.atan2(b.dy, b.dx);
  assert.ok(Math.abs(winkelA - winkelB) < 1e-9, 'die Richtung haengt am Zoom');
});

test('toWorld ist die Umkehrung von toScreen', () => {
  const r = renderer();
  for (const [wx, wy] of [[900, 600], [120, 1100], [1880, 70]]) {
    const [sx, sy] = r.toScreen(wx, wy);
    const [bx, by] = r.toWorld(sx, sy);
    assert.ok(Math.abs(bx - wx) < 1e-6 && Math.abs(by - wy) < 1e-6,
      `Rueckweg stimmt nicht: ${wx},${wy} -> ${bx},${by}`);
  }
});

// --- Tasten -----------------------------------------------------------------

test('Links laeuft, rechts beisst', () => {
  const { input, maus } = eingabe();
  maus('pointerdown', 0, 700, 400);
  assert.equal(input.mouse.held, true, 'linke Taste laeuft nicht');
  assert.ok(!(input.read().btn & BTN.BITE), 'linke Taste beisst -- sie soll laufen');

  maus('pointerup', 0, 700, 400);
  maus('pointerdown', 2, 700, 400);
  assert.ok(input.read().btn & BTN.BITE, 'rechte Taste beisst nicht');
  assert.equal(input.mouse.held, false, 'rechte Taste laesst den Hund laufen');
});

test('Die Zeigerposition wird auch ohne gedrueckte Taste mitgefuehrt', () => {
  // Sonst zeigt der erste Klick in die Richtung des VORIGEN Zeigerorts.
  const { input, maus } = eingabe();
  maus('pointermove', 0, 512, 333);
  assert.equal(input.mouse.x, 512);
  assert.equal(input.mouse.y, 333);
  assert.equal(input.mouse.inside, true);
});

test('Ein Fensterwechsel loest die Maustaste', () => {
  const { input, maus } = eingabe();
  maus('pointerdown', 0, 700, 400);
  fenster.blur();
  assert.equal(input.mouse.held, false, 'der Hund liefe nach dem Wechsel weiter');
});

// --- Bewegung ---------------------------------------------------------------

test('Ohne gedrueckte Taste bewegt der Zeiger nichts', () => {
  const { input, maus } = eingabe();
  maus('pointermove', 0, 900, 400);
  input.setAim({ dx: 300, dy: 0, dist: 300 });
  const { dx, dy } = input.read();
  assert.equal(dx, 0); assert.equal(dy, 0);
});

test('Innerhalb der Totzone bleibt der Hund stehen', () => {
  const { input, maus } = eingabe();
  maus('pointerdown', 0, 700, 400);
  input.setAim({ dx: 10, dy: 0, dist: 10 });          // dichter als AIM_DEAD
  assert.equal(input.read().dx, 0, 'zappelt auf dem Zielpunkt');
});

test('Weit weg laeuft er mit vollem Tempo, nah dran gebremst', () => {
  const { input, maus } = eingabe();
  maus('pointerdown', 0, 700, 400);

  input.setAim({ dx: 600, dy: 0, dist: 600 });
  const weit = input.read();
  assert.ok(Math.abs(weit.dx - 1) < 1e-9, `nicht volles Tempo: ${weit.dx}`);

  input.setAim({ dx: 40, dy: 0, dist: 40 });          // knapp ueber der Totzone
  const nah = input.read();
  assert.ok(nah.dx > 0 && nah.dx < 0.85,
    `keine Bremsrampe: ${nah.dx.toFixed(2)} -- ohne sie pendelt der Hund um das Ziel`);
});

test('Die Richtung wird normiert -- schraeg ist nicht schneller', () => {
  const { input, maus } = eingabe();
  maus('pointerdown', 0, 700, 400);
  input.setAim({ dx: 400, dy: 400, dist: Math.hypot(400, 400) });
  const { dx, dy } = input.read();
  assert.ok(Math.abs(Math.hypot(dx, dy) - 1) < 1e-9,
    `Betrag ${Math.hypot(dx, dy).toFixed(3)} statt 1`);
  assert.ok(Math.abs(dx - dy) < 1e-9, 'die Diagonale ist verzogen');
});

test('Ohne Ziel passiert nichts (kein Absturz)', () => {
  const { input, maus } = eingabe();
  maus('pointerdown', 0, 700, 400);
  input.setAim(null);
  const { dx, dy } = input.read();
  assert.equal(dx, 0); assert.equal(dy, 0);
});

test('Der Finger-Stick sticht den Zeiger -- beides zugleich waere Chaos', () => {
  const { input, maus } = eingabe();
  maus('pointerdown', 0, 700, 400);
  input.setAim({ dx: 600, dy: 0, dist: 600 });
  // Finger legt den Stick an
  input.stick = { active: true, id: 9, ox: 100, oy: 100, x: 100, y: 160 };
  const { dy } = input.read();
  assert.ok(dy > 0.5, 'der Stick wird vom Zeiger ueberschrieben');
});

// --- Arena-Code -------------------------------------------------------------

test('Der Arena-Code steht dauerhaft im HUD, nicht nur als Toast', () => {
  const html = fs.readFileSync(path.join(CLIENT, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(CLIENT, 'src/main.js'), 'utf8');

  assert.match(html, /id="arena-code"/, 'keine Anzeige im HUD');
  // Sie muss in der Kopfzeile des Spiels stehen, nicht irgendwo
  const kopf = html.slice(html.indexOf('hud-top'), html.indexOf('hud-bottom'));
  assert.match(kopf, /id="arena-code"/, 'steht nicht in der Kopfzeile');
  // und beim Beitritt gefuellt werden
  assert.match(js, /arena-code'\)\.textContent = net\.room/, 'wird nie gefuellt');
});

test('Das Menue verspricht die Anzeige -- und sie existiert', () => {
  const html = fs.readFileSync(path.join(CLIENT, 'index.html'), 'utf8');
  // Der Hinweistext im Menue sagt seit jeher "siehst du oben links".
  assert.match(html, /Code siehst du oben links/);
  assert.match(html, /id="arena"[^>]*type="button"/, 'nicht antippbar');
});

test('⚠️ Der Code-Knopf ist wirklich anklickbar', () => {
  // #hud steht auf pointer-events:none, damit man durch die Anzeige hindurch
  // spielen kann. Wer das vergisst, baut einen Knopf, den das Canvas abfaengt --
  // sichtbar, aber tot. Genau das ist hier passiert und fiel erst im Browser auf.
  const css = fs.readFileSync(path.join(CLIENT, 'src/style.css'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');                 // kommentarfrei pruefen
  const regel = css.slice(css.indexOf('.pill.code {'));
  const block = regel.slice(0, regel.indexOf('}'));
  assert.match(block, /pointer-events:\s*auto/,
    'der Knopf liegt unter dem Canvas und laesst sich nicht druecken');
});

test('Die Anzeige liegt oben LINKS, wie das Menue es verspricht', () => {
  const css = fs.readFileSync(path.join(CLIENT, 'src/style.css'), 'utf8');
  const html = fs.readFileSync(path.join(CLIENT, 'index.html'), 'utf8');
  // .hud-top ist links verankert, und die Pille steht direkt hinter der Uhr
  assert.match(css, /\.hud-top\s*\{[^}]*left:\s*10px/);
  const kopf = html.slice(html.indexOf('hud-top'), html.indexOf('hud-bottom'));
  assert.ok(kopf.indexOf('id="timer"') < kopf.indexOf('id="arena"'),
    'die Pille steht nicht direkt neben der Uhr');
  assert.ok(kopf.indexOf('id="arena"') < kopf.indexOf('id="btn-leave"'),
    'die Pille ist nach rechts gerutscht');
});
