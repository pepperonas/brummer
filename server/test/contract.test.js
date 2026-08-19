// Vertraege, die in ZWEI Dateien stehen.
//
// CLAUDE.md nennt den Schnappschuss "die zerbrechlichste Stelle im Repo, und
// sie steht in zwei Dateien". Genau das pinnen diese Tests: room.js baut die
// Zeilen, net.js liest sie ueber INDIZES -- wer eine Spalte einfuegt, ohne
// beide Seiten anzufassen, bekommt keinen Fehler, sondern still falsche Werte
// im Bild (Punktestand als Ausdauer, Betaeubung als Fortschritt).
//
// Geprueft wird der QUELLTEXT, nicht das Verhalten: room.js an die Testumgebung
// zu haengen hiesse, den halben Server hochzufahren, und der Client laesst sich
// aus dem Server-Paket ohnehin nicht importieren.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DIG, ROUND, TICK_HZ } from '../../shared/sim.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const ROOM = read('server/room.js');
const NET = read('client/src/net.js');
const INDEX = read('server/index.js');
const DB = read('server/db.js');

// Kommentare raus: die Doku dieses Hauses zitiert entfernte Regeln woertlich,
// eine Textpruefung wuerde sonst den Kommentar statt des Codes finden.
const pur = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

// --- Animationsliste -------------------------------------------------------

test('die Animationsliste steht in room.js und net.js -- die REIHENFOLGE ist der Vertrag', () => {
  // room.js: { idle: 0, walk: 1, ... }   net.js: ['idle', 'walk', ...]
  const map = pur(ROOM).match(/const ANIM = \{([^}]+)\}/);
  const arr = pur(NET).match(/const ANIM = \[([^\]]+)\]/);
  assert.ok(map, 'ANIM-Map in room.js nicht gefunden');
  assert.ok(arr, 'ANIM-Array in net.js nicht gefunden');

  const vomServer = [];
  for (const [, name, idx] of map[1].matchAll(/(\w+)\s*:\s*(\d+)/g)) vomServer[Number(idx)] = name;
  const vomClient = [...arr[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

  assert.deepEqual(vomClient, vomServer,
    'Server und Client ordnen die Posen verschieden -- der Hund zeigt die falsche Animation');
  assert.ok(vomServer.length >= 9);
  assert.equal(vomServer[0], 'idle', 'Index 0 ist der Rueckfall bei unbekannter Pose');
});

// --- Spaltenordnung des Schnappschusses ------------------------------------

/** Zerlegt einen Array-Rumpf an den Kommas der OBERSTEN Ebene. */
function spalten(rumpf) {
  const out = [];
  let tiefe = 0, start = 0;
  for (let i = 0; i < rumpf.length; i++) {
    const c = rumpf[i];
    if ('([{'.includes(c)) tiefe++;
    else if (')]}'.includes(c)) tiefe--;
    else if (c === ',' && tiefe === 0) { out.push(rumpf.slice(start, i)); start = i + 1; }
  }
  const rest = rumpf.slice(start).trim();
  if (rest) out.push(rest);
  return out.map((x) => x.trim()).filter(Boolean);
}

/**
 * Liest die ECHTE Spaltenordnung aus room.js, statt sie abzuschreiben.
 * ⚠️ Die erste Fassung dieses Tests verglich net.js nur gegen eine von Hand
 * getippte Liste -- eine eingeschobene Spalte in room.js liess ihn GRUEN.
 * Aufgefallen ist das erst durch die Mutationsprobe.
 */
function spaltenOrdnungAusRoom() {
  const m = pur(ROOM).match(/ps:\s*\[\.\.\.this\.players\.values\(\)\]\.map\(p\s*=>\s*\[([\s\S]*?)\]\s*\),/);
  assert.ok(m, 'Spielerzeile in room.js nicht gefunden');
  return spalten(m[1]).map((ausdruck) => {
    // "Math.round(p.stunT * 100)" -> "stunT", "p.carrying ? 1 : 0" -> "carrying"
    const feld = ausdruck.match(/\bp\.(\w+)/);
    return feld ? feld[1] : ausdruck;
  });
}

test('net.js liest die Spielerzeile an genau den Stellen, an denen room.js sie baut', () => {
  const vomServer = spaltenOrdnungAusRoom();
  assert.equal(vomServer.length, 14, `die Zeile hat 14 Spalten, room.js baut ${vomServer.length}`);
  assert.equal(vomServer[0], 'slot', 'die Zeile beginnt mit dem Slot');

  // "anim" wird durch die Nachschlagetabelle gereicht: anim: ANIM[row[6]]
  const gelesen = {};
  for (const [, feld, idx] of pur(NET).matchAll(/(\w+):\s*(?:ANIM\[)?row\[(\d+)\]/g)) {
    gelesen[Number(idx)] = feld;
  }
  assert.ok(Object.keys(gelesen).length >= 6, 'net.js liest kaum noch Spalten -- Muster veraltet?');

  // net nennt die Felder ohne das Zeit-T (stunT -> stun, digT -> dig)
  const gleich = (a, b) => a.replace(/T$/, '').toLowerCase() === b.replace(/T$/, '').toLowerCase();

  for (const [idx, netFeld] of Object.entries(gelesen)) {
    const serverFeld = vomServer[Number(idx)];
    assert.ok(serverFeld, `net.js liest Index ${idx}, room.js hat dort keine Spalte`);
    assert.ok(gleich(serverFeld, netFeld),
      `Spalte ${idx}: room.js legt dort "${serverFeld}" ab, net.js liest sie als "${netFeld}"`);
  }
});

test('skalierte Felder werden mit demselben Faktor gebaut und gelesen', () => {
  // stunT faehrt in Hundertsteln
  assert.match(pur(ROOM), /stunT \* 100/, 'room.js skaliert stunT nicht mehr mit 100');
  assert.match(pur(NET), /row\[10\] \/ 100/, 'net.js rechnet stunT nicht mehr durch 100');
});

test('⚠️ net.js rechnet die Grabzeit mit einer HART NOTIERTEN 2.0', () => {
  // Bekannte Stelle aus CLAUDE.md: room.js teilt durch DIG.time, net.js
  // multipliziert mit einer getippten 2.0. Solange DIG.time 2.0 ist, stimmt
  // das Bild. Wer die Grabzeit aendert, MUSS net.js mitziehen -- dieser Test
  // ist der Alarm dafuer.
  assert.match(pur(ROOM), /digT \/ DIG\.time \* 100/);
  assert.equal(DIG.time, 2.0,
    'DIG.time wurde geaendert -- die hart notierte 2.0 in client/src/net.js mitziehen, ' +
    'sonst zeigt der Grabbalken den falschen Fortschritt und die Vorhersage laeuft ab');
});

test('Knochen- und Depotzeilen behalten ihre Form', () => {
  assert.match(pur(ROOM), /\[b\.id,[^\]]*b\.x[^\]]*b\.y/s, 'Knochenzeile: [id, x, y, traeger]');
  assert.match(pur(ROOM), /\[c\.id,[^\]]*c\.x[^\]]*c\.y/s, 'Depotzeile: [id, x, y]');
  // -1 heisst "niemand traegt ihn" -- der Client unterscheidet daran
  assert.match(pur(ROOM), /:\s*-1\s*:|=== null \? -1/, 'die -1 fuer "ungetragen" fehlt');
});

test('Netz-IDs sind Slots, keine internen IDs', () => {
  // Mit String-IDs war ein Schnappschuss 1673 B statt 565 B bei acht Spielern.
  const zeile = pur(ROOM).match(/ps:\s*\[\.\.\.this\.players\.values\(\)\]\.map\([\s\S]*?\]\),/);
  assert.ok(zeile, 'Spielerzeile nicht gefunden');
  assert.match(zeile[0], /p\.slot/, 'die Zeile beginnt nicht mit dem Slot');
  assert.doesNotMatch(zeile[0], /\bp\.id\b/, 'interne ID im Schnappschuss -- blaeht den 30-Hz-Strom auf');
});

// --- Code-Alphabet ---------------------------------------------------------

test('das Code-Alphabet steht doppelt (db.js und index.js) und muss gleich bleiben', () => {
  const a = pur(DB).match(/const ALPHABET = '([^']+)'/)?.[1];
  const b = pur(INDEX).match(/const A = '([^']+)'/)?.[1];
  assert.ok(a && b, 'Alphabet nicht in beiden Dateien gefunden');
  assert.equal(a, b, 'Spieler- und Arena-Codes nutzen verschiedene Alphabete');
});

test('das Alphabet meidet verwechselbare Zeichen', () => {
  const a = pur(DB).match(/const ALPHABET = '([^']+)'/)[1];
  for (const ch of 'ILO01') {
    assert.equal(a.includes(ch), false, `${ch} ist verwechselbar und gehoert nicht ins Alphabet`);
  }
  assert.equal(new Set(a).size, a.length, 'ein Zeichen kommt doppelt vor');
});

test('jeder Buchstabe des Alphabets ist im Browser eintippbar', () => {
  // Die Steuertasten sind mit preventDefault belegt. Waere das Eingabe-Tor in
  // client/src/input.js weg, liessen sich Codes mit diesen Buchstaben nicht
  // eingeben -- gemessen 64 % aller vierstelligen Arena-Codes.
  const alphabet = pur(DB).match(/const ALPHABET = '([^']+)'/)[1];
  const input = read('client/src/input.js');
  const spieltasten = [...pur(input).matchAll(/'Key([A-Z])'/g)].map((m) => m[1]);
  const kollision = spieltasten.filter((c) => alphabet.includes(c));

  assert.ok(kollision.length > 0, 'Annahme veraltet: keine Spieltaste liegt mehr im Alphabet');
  assert.match(pur(input), /isTypingTarget\(e\.target\)\)\s*return/,
    `Das Eingabe-Tor fehlt -- ${kollision.join('')} waeren nicht eintippbar`);
});

// --- Takt ------------------------------------------------------------------

test('der Takt steht nur in sim.js und wird im hello mitgeteilt', () => {
  assert.equal(TICK_HZ, 30);
  assert.match(pur(INDEX), /tickHz/, 'der Client erfaehrt den Takt nicht mehr');
  assert.equal(ROUND.play, 180, 'eine Runde dauert drei Minuten (README, Teilbild, Meta-Angaben)');
});
