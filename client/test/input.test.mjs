// Tastatur-Tor. Handgerollter DOM-Ersatz statt jsdom -- das Repo bleibt
// abhaengigkeitsfrei, so wie die Server-Suite auch.
import test from 'node:test';
import assert from 'node:assert/strict';

// --- DOM-Ersatz -------------------------------------------------------------
// Der Konstruktor haengt Handler ans Fenster und ans Canvas. Wir fangen sie
// ab, um sie danach von Hand zu feuern.
function mountInput() {
  const handlers = {};
  const canvas = {
    addEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    setPointerCapture() {},
  };
  globalThis.addEventListener = (type, fn) => { handlers[type] = fn; };
  return { handlers, canvas };
}

const { handlers, canvas } = mountInput();
const { Input, isTypingTarget } = await import('../src/input.js');
const input = new Input(canvas);

/** Feuert keydown und meldet, ob die Eingabe unterdrueckt wurde. */
function press(code, { tag = 'BODY', contentEditable = false, mods = {} } = {}) {
  let prevented = false;
  handlers.keydown({
    code,
    repeat: false,
    target: { tagName: tag, isContentEditable: contentEditable },
    ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, altKey: !!mods.alt,
    preventDefault() { prevented = true; },
  });
  return prevented;
}

// --- Das eigentliche Versprechen -------------------------------------------

test('im Textfeld kommt jede Spieltaste durch -- "Tyson" war "Tyon"', () => {
  for (const code of ['KeyS', 'KeyW', 'KeyA', 'KeyD', 'KeyQ', 'KeyE', 'KeyF', 'Space']) {
    assert.equal(press(code, { tag: 'INPUT' }), false, `${code} wurde im Feld verschluckt`);
  }
});

test('alle sieben Buchstaben des Code-Alphabets sind tippbar', () => {
  // ABCDEFGHJKMNPQRSTUVWXYZ23456789 enthaelt A D E F Q S W -- ohne das Tor
  // liessen sich 64 % der vierstelligen Arena-Codes nicht eingeben.
  for (const ch of 'ADEFQSW') {
    assert.equal(press(`Key${ch}`, { tag: 'INPUT' }), false, `${ch} nicht tippbar`);
  }
});

test('contentEditable zaehlt auch als Textfeld', () => {
  assert.equal(press('KeyS', { tag: 'DIV', contentEditable: true }), false);
});

test('ausserhalb von Feldern bleibt die Steuerung scharf', () => {
  for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space']) {
    assert.equal(press(code), true, `${code} steuert nicht mehr`);
  }
});

test('Tippen fuellt die Tastenmenge NICHT -- sonst laeuft der Hund beim Schreiben', () => {
  input.keys.clear();
  press('KeyD', { tag: 'INPUT' });
  assert.equal(input.keys.has('KeyD'), false);
  assert.equal(input.read().dx, 0, 'der Hund lief los, waehrend der Name getippt wurde');
});

test('Cmd+W und Strg+A gehoeren dem Browser', () => {
  assert.equal(press('KeyW', { mods: { meta: true } }), false, 'Cmd+W abgefangen');
  assert.equal(press('KeyA', { mods: { ctrl: true } }), false, 'Strg+A abgefangen');
});

test('isTypingTarget vertraegt fehlende Ziele', () => {
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget(undefined), false);
  assert.equal(isTypingTarget({ tagName: 'CANVAS' }), false);
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTypingTarget({ tagName: 'SELECT' }), true);
});
