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

// --- Kurze Druecke duerfen nicht verloren gehen -----------------------------

const { BTN } = await import('../../shared/sim.js');

/** Taste loslassen (keyup). */
function release(code) {
  handlers.keyup({ code });
}

test('Ein Druck kuerzer als ein Abtastschritt kommt trotzdem an', () => {
  // Live gemessen: unter 20 ms loeste kein Biss aus. Die Eingabe wird nur
  // 30x/s abgetastet -- ohne Raste faellt der Druck zwischen zwei Schritte.
  input.keys.clear(); input.tapped = 0; input.read();
  press('Space');
  release('Space');                       // beides VOR der naechsten Abtastung
  assert.equal(input.keys.has('Space'), false, 'Taste ist schon wieder los');
  assert.ok(input.read().btn & BTN.BITE, 'der Biss ging verloren');
});

test('Die Raste feuert genau EINMAL, nicht bei jeder Abtastung', () => {
  input.keys.clear(); input.tapped = 0; input.read();
  press('Space'); release('Space');
  assert.ok(input.read().btn & BTN.BITE);
  assert.equal(input.read().btn & BTN.BITE, 0, 'der Biss wiederholt sich von selbst');
});

test('Gehaltene Tasten funktionieren unveraendert weiter', () => {
  input.keys.clear(); input.tapped = 0; input.read();
  press('Space');                          // halten, kein keyup
  assert.ok(input.read().btn & BTN.BITE);
  assert.ok(input.read().btn & BTN.BITE, 'gehaltene Taste faellt nach einem Schritt aus');
  release('Space');
  assert.equal(input.read().btn & BTN.BITE, 0);
});

test('Bellen und Nase rasten ebenfalls', () => {
  for (const [code, bit] of [['KeyE', BTN.BARK], ['KeyQ', BTN.NOSE], ['KeyF', BTN.NOSE]]) {
    input.keys.clear(); input.tapped = 0; input.read();
    press(code); release(code);
    assert.ok(input.read().btn & bit, `${code} ging verloren`);
  }
});

test('⚠️ Sprint rastet NICHT -- das ist ein Halten, kein Antippen', () => {
  input.keys.clear(); input.tapped = 0; input.read();
  press('ShiftLeft'); release('ShiftLeft');
  assert.equal(input.read().btn & BTN.RUN, 0,
    'ein geraster Sprint waere ein Ein-Bild-Satz nach vorn');
});

test('Ein Leerzeichen im Namensfeld beisst nicht', () => {
  // Waere die Raste vor dem Textfeld-Tor gesetzt, wuerde jeder Leerschlag
  // beim Tippen einen Biss ausloesen.
  input.keys.clear(); input.tapped = 0; input.read();
  press('Space', { tag: 'INPUT' });
  assert.equal(input.read().btn & BTN.BITE, 0, 'Tippen loeste einen Biss aus');
});

test('isTypingTarget vertraegt fehlende Ziele', () => {
  assert.equal(isTypingTarget(null), false);
  assert.equal(isTypingTarget(undefined), false);
  assert.equal(isTypingTarget({ tagName: 'CANVAS' }), false);
  assert.equal(isTypingTarget({ tagName: 'TEXTAREA' }), true);
  assert.equal(isTypingTarget({ tagName: 'SELECT' }), true);
});
