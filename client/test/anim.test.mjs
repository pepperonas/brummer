// Animationsschicht. Handgerollter DOM-Ersatz wie in input.test.mjs -- das Repo
// bleibt abhaengigkeitsfrei.
//
// Geprueft wird die Eigenschaft, nicht der Zahlenwert: dass der Schritt an der
// STRECKE haengt (und damit unabhaengig von der Bildrate ist), dass der Biss
// erst zurueckzieht und dann zuschnappt, und dass beides spiegelverkehrt
// genauso funktioniert.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(HERE, '..');

// --- DOM-Ersatz -------------------------------------------------------------
const noop = () => {};
function ctx2d() {
  // Jede Methode ist ein Nichtstuer, jedes Feld beschreibbar.
  return new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : (o[k] = noop)),
    set: (o, k, v) => ((o[k] = v), true),
  });
}
globalThis.matchMedia = () => ({ matches: false });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: ctx2d }) };
globalThis.devicePixelRatio = 1;

const atlas = JSON.parse(fs.readFileSync(path.join(CLIENT, 'public/assets/atlas.json'), 'utf8'));
const { Renderer, STRIDE, BITE_DUR } = await import('../src/render.js');
const { BITE, DOG } = await import('../../shared/sim.js');

function renderer() {
  const cv = { width: 1280, height: 720, clientWidth: 1280, clientHeight: 720, getContext: ctx2d };
  const r = new Renderer(cv, {}, atlas);
  r.dpr = 1; r.vw = 1280; r.vh = 720;
  return r;
}

const hund = (o = {}) => ({ slot: 0, x: 500, y: 500, facing: 1, anim: 'run', stun: 0, ...o });

/** Laesst einen Hund `strecke` Welteinheiten in `schritte` Bildern laufen. */
function laufen(r, { strecke, schritte, anim = 'run', facing = 1 }) {
  const dt = 1 / schritte;                 // eine Sekunde, verschieden fein zerlegt
  const p = hund({ anim, facing });
  r.dogVisual(p, dt);                      // erstes Bild setzt nur die Position
  for (let i = 0; i < schritte; i++) {
    p.x += (strecke / schritte) * facing;
    r.dogVisual(p, dt);
  }
  return r._animState(p.slot);
}

// --- Schritt haengt an der Strecke -----------------------------------------

test('Gleiche Strecke ergibt gleiche Schrittphase -- egal bei welcher Bildrate', () => {
  // Das ist die Eigenschaft, die "foot sliding" verhindert: die Beine gehoeren
  // zum Boden, nicht zur Uhr des Geraets.
  const grob = laufen(renderer(), { strecke: 240, schritte: 15 });   // 15 fps
  const fein = laufen(renderer(), { strecke: 240, schritte: 144 });  // 144 fps
  assert.ok(Math.abs(grob.ph - fein.ph) < 1e-9,
    `Phase weicht ab: ${grob.ph} vs ${fein.ph}`);
  assert.ok(Math.abs(grob.ph - 240 / STRIDE.run) < 1e-9, 'Phase ist nicht Strecke/Schrittlaenge');
});

test('Doppelte Strecke ergibt doppelt so viele Schritte', () => {
  const a = laufen(renderer(), { strecke: 120, schritte: 60 });
  const b = laufen(renderer(), { strecke: 240, schritte: 60 });
  assert.ok(Math.abs(b.ph - 2 * a.ph) < 1e-9);
});

test('Wer steht, bewegt die Beine nicht', () => {
  const r = renderer();
  const p = hund({ anim: 'run' });
  r.dogVisual(p, 1 / 60);
  const vorher = r._animState(0).ph;
  for (let i = 0; i < 30; i++) r.dogVisual(p, 1 / 60);   // Position unveraendert
  assert.equal(r._animState(0).ph, vorher, 'die Beine liefen im Stand weiter');
});

test('⚠️ Der Sprint-Schritt ist LAENGER als der Geh-Schritt', () => {
  // Vorher war er kuerzer (52 gegen 119 Welteinheiten) -- der Hund trippelte
  // bei fast doppeltem Tempo. Genau das sah aus wie Flimmern.
  assert.ok(STRIDE.run > STRIDE.walk,
    `Sprint ${STRIDE.run} <= Gehen ${STRIDE.walk} -- der Hund trippelt wieder`);

  // und der Takt bleibt im Bereich eines echten Hundes: 2,5-3,5 Zyklen/s
  const zyklen = DOG.run / STRIDE.run;
  assert.ok(zyklen > 2.2 && zyklen < 3.8, `${zyklen.toFixed(2)} Galoppzyklen/s`);

  // Schrittlaenge in Koerperlaengen (der Hund ist 68 Einheiten lang)
  const koerper = STRIDE.run / 68;
  assert.ok(koerper > 1.5 && koerper < 2.6, `${koerper.toFixed(2)} Koerperlaengen je Sprung`);
});

test('Ein Positionssprung nach Paketverlust wandert nicht in die Phase', () => {
  const r = renderer();
  const p = hund();
  r.dogVisual(p, 1 / 60);
  const vorher = r._animState(0).ph;
  p.x += 400;                                  // Nachzieher nach verlorenem Paket
  r.dogVisual(p, 1 / 60);
  assert.equal(r._animState(0).ph, vorher, 'der Sprung hat die Beine weitergedreht');
});

test('Ein Bildaussetzer schleudert die Phase nicht', () => {
  const r = renderer();
  const p = hund();
  r.dogVisual(p, 1 / 60);
  p.x += 30;
  r.dogVisual(p, 3.0);                         // Tab war 3 s im Hintergrund
  const st = r._animState(0);
  assert.ok(st.ph < 1, `Phase sprang auf ${st.ph}`);
  assert.ok(Number.isFinite(st.lift) && Number.isFinite(st.squash));
});

// --- Galopp -----------------------------------------------------------------

test('Der Galopp hebt EINMAL je Zyklus ab, nicht zweimal', () => {
  const r = renderer();
  const p = hund({ anim: 'run' });
  r.dogVisual(p, 1 / 60);
  const hoehen = [];
  for (let i = 0; i < 120; i++) {              // zwei volle Zyklen abtasten
    p.x += STRIDE.run / 60;
    hoehen.push(-r.dogVisual(p, 1 / 60).lift); // lift ist negativ = oben
  }
  // Gipfel zaehlen: ein Galopp hat eine Schwebephase je Zyklus
  let gipfel = 0;
  for (let i = 1; i < hoehen.length - 1; i++) {
    if (hoehen[i] > hoehen[i - 1] && hoehen[i] >= hoehen[i + 1] && hoehen[i] > 1) gipfel++;
  }
  assert.equal(gipfel, 2, `${gipfel} Gipfel auf zwei Zyklen -- erwartet 2 (einer je Zyklus)`);
});

test('Schneller heisst hoeher und staerker vorgelehnt', () => {
  const langsam = renderer(), schnell = renderer();
  let maxL = 0, maxS = 0, rotL = 0, rotS = 0;
  const p1 = hund(), p2 = hund();
  langsam.dogVisual(p1, 1 / 60); schnell.dogVisual(p2, 1 / 60);
  for (let i = 0; i < 90; i++) {
    p1.x += 120 / 60; const a = langsam.dogVisual(p1, 1 / 60);
    p2.x += 340 / 60; const b = schnell.dogVisual(p2, 1 / 60);
    maxL = Math.max(maxL, -a.lift); rotL = Math.max(rotL, a.rot);
    maxS = Math.max(maxS, -b.lift); rotS = Math.max(rotS, b.rot);
  }
  assert.ok(maxS > maxL * 1.3, `Sprunghoehe skaliert nicht: ${maxL.toFixed(1)} -> ${maxS.toFixed(1)}`);
  assert.ok(rotS > rotL, 'die Vorlage waechst nicht mit dem Tempo');
});

// --- Biss -------------------------------------------------------------------

/**
 * Spielt einen Biss ab und liefert die Bilder als Liste.
 * ⚠️ `t` wird aus der Uhr des Renderers gelesen, nicht aus der Schleife: der
 * Zeitgeber startet an der Flanke und zaehlt im selben Aufruf schon ein dt
 * hoch. Mit der Schleifenvariablen lag jedes Bild um genau ein dt daneben --
 * das sah nach einem Fehler im Code aus und war einer im Test.
 */
function beissen(facing = 1) {
  const r = renderer();
  const p = hund({ anim: 'walk', facing });
  r.dogVisual(p, 1 / 60);
  p.anim = 'bite';
  const bilder = [];
  const dt = 1 / 240;                          // fein abtasten
  for (let i = 0; i < Math.ceil(BITE_DUR / dt); i++) {
    const bild = r.dogVisual(p, dt);
    bilder.push({ t: r._animState(p.slot).biteT, ...bild });
  }
  return bilder.filter((f) => f.t >= 0 && f.t <= BITE_DUR);
}

test('Der Biss zieht ERST zurueck und schnappt DANN zu', () => {
  const b = beissen(1);
  const anlauf = b.filter((f) => f.t < BITE.windup);
  const schlag = b.filter((f) => f.t >= BITE.windup);

  const minAnlauf = Math.min(...anlauf.map((f) => f.dx));
  const maxSchlag = Math.max(...schlag.map((f) => f.dx));

  assert.ok(minAnlauf < -3, `keine Anticipation: geringstes dx ${minAnlauf.toFixed(1)}`);
  assert.ok(maxSchlag > 8, `kein Ausfall nach vorn: groesstes dx ${maxSchlag.toFixed(1)}`);
  assert.ok(maxSchlag > Math.abs(minAnlauf), 'der Ausfall ist kuerzer als das Zurueckziehen');
});

test('Der Biss nutzt beide Bilder als Anlauf und Schlag -- nicht als Schleife', () => {
  const b = beissen(1);
  const imAnlauf = new Set(b.filter((f) => f.t < BITE.windup).map((f) => f.name));
  const imSchlag = new Set(b.filter((f) => f.t >= BITE.windup).map((f) => f.name));
  assert.deepEqual([...imAnlauf], ['bite0'], 'der Anlauf zeigt nicht durchgehend bite0');
  assert.deepEqual([...imSchlag], ['bite1'], 'der Schlag zeigt nicht durchgehend bite1');
});

test('Im Ausfall hebt der Hund ab und streckt sich', () => {
  const b = beissen(1).filter((f) => f.t >= BITE.windup);
  const hoch = Math.max(...b.map((f) => -f.lift));
  const duennste = Math.min(...b.map((f) => f.squash));
  assert.ok(hoch > 8, `kein Flugbogen: ${hoch.toFixed(1)}`);
  assert.ok(duennste < 0.94, `keine Streckung: squash ${duennste.toFixed(3)}`);
});

test('Nach links gebissen spiegelt sich alles sauber', () => {
  const rechts = beissen(1), links = beissen(-1);
  for (let i = 0; i < rechts.length; i++) {
    assert.ok(Math.abs(rechts[i].dx + links[i].dx) < 1e-9,
      `dx nicht gespiegelt bei Bild ${i}`);
    assert.ok(Math.abs(rechts[i].rot + links[i].rot) < 1e-9,
      `Drehung nicht gespiegelt bei Bild ${i} -- der linke Hund lehnt nach hinten`);
    assert.equal(rechts[i].name, links[i].name);
  }
});

test('Der Biss laeuft aus und gibt die Fortbewegung wieder frei', () => {
  const r = renderer();
  const p = hund({ anim: 'walk' });
  r.dogVisual(p, 1 / 60);
  p.anim = 'bite';
  for (let t = 0; t < BITE_DUR; t += 1 / 240) r.dogVisual(p, 1 / 240);
  p.anim = 'walk';
  // Nachschwingen: der Name kommt wieder aus der Fortbewegung
  const gleich = r.dogVisual(p, 1 / 240);
  assert.ok(gleich.name.startsWith('walk'), `haengt bei ${gleich.name}`);

  for (let i = 0; i < 200; i++) r.dogVisual(p, 1 / 240);
  const st = r._animState(0);
  assert.equal(st.biteT, -1, 'die Biss-Uhr laeuft weiter');
  assert.ok(Math.abs(st.dx) < 0.5, `Versatz nicht ausgeschwungen: ${st.dx.toFixed(2)}`);
  assert.ok(Math.abs(st.squash - 1) < 0.05, `Stauchung nicht ausgeschwungen: ${st.squash.toFixed(3)}`);
});

test('Ein zweiter Biss startet die Uhr neu', () => {
  const r = renderer();
  const p = hund({ anim: 'bite' });
  r.dogVisual(p, 1 / 60);
  r.dogVisual(p, 1 / 60);
  p.anim = 'walk'; r.dogVisual(p, 1 / 60);
  for (let i = 0; i < 40; i++) r.dogVisual(p, 1 / 60);
  p.anim = 'bite'; r.dogVisual(p, 1 / 60);
  const st = r._animState(0);
  assert.ok(st.biteT >= 0 && st.biteT < 0.05, `Uhr nicht neu gestartet: ${st.biteT}`);
});

// --- Glaettung --------------------------------------------------------------

test('Zwischen zwei Zustaenden gibt es keinen Sprung', () => {
  const r = renderer();
  const p = hund({ anim: 'walk' });
  r.dogVisual(p, 1 / 60);
  for (let i = 0; i < 30; i++) { p.x += 3; r.dogVisual(p, 1 / 60); }
  const vorher = r.dogVisual(p, 1 / 60);
  p.anim = 'run';                              // harter Zustandswechsel
  p.x += 6;
  const nachher = r.dogVisual(p, 1 / 60);
  assert.ok(Math.abs(nachher.lift - vorher.lift) < 6,
    `Sprung in der Hoehe: ${vorher.lift.toFixed(1)} -> ${nachher.lift.toFixed(1)}`);
  assert.ok(Math.abs(nachher.rot - vorher.rot) < 0.05, 'Sprung in der Drehung');
});
