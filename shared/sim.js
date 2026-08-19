// Geteilte Simulation. Laeuft WORTGLEICH im Server (autoritativ) und im Client
// (Vorhersage). Jede Abweichung zwischen beiden Seiten waere ein Ruckeln.
// Deshalb: keine Zufallszahlen, keine Uhrzeit, kein DOM -- nur Eingabe -> Zustand.

export const TICK_HZ = 30;
export const DT = 1 / TICK_HZ;

export const ARENA = { w: 1900, h: 1250, pad: 60 };

export const DOG = {
  r: 34,
  walk: 215,
  run: 340,
  accel: 2400,
  friction: 12,
  carryFactor: 0.88,
};

export const STAM = { max: 100, drain: 34, regen: 22, regenDelay: 0.55, runMin: 8 };

export const BITE  = { range: 86, cone: Math.cos(0.95), cd: 0.75, windup: 0.10, active: 0.16, lunge: 750, stun: 1.4 };
export const BARK  = { radius: 200, cd: 4.0, dur: 0.45, push: 300 };
export const SNIFF = { cd: 6.0, radius: 720, dur: 3.5 };
export const DIG   = { time: 2.0, yield: 3 };

export const BONE  = { r: 26, onField: 8, respawn: 2.0, pickupR: 46 };
export const CACHE = { count: 5, r: 70 };
export const HOUSE = { r: 105 };

export const ROUND = { warmup: 5, play: 180, over: 12 };

// Eingabe-Bitmaske
export const BTN = { RUN: 1, BITE: 2, BARK: 4, NOSE: 8 };

export function makePlayer(id, name, slot) {
  return {
    id, name, slot,
    x: 0, y: 0, vx: 0, vy: 0, facing: 1,
    anim: 'idle', animT: 0,
    stam: STAM.max, stamHold: 0,
    carrying: null,
    biteT: 0, biteCd: 0, barkCd: 0, barkT: 0, sniffCd: 0, sniffT: 0,
    digT: 0, stunT: 0,
    score: 0, bites: 0, delivered: 0,
    alive: true, lastSeq: 0,
  };
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function len(x, y) { return Math.sqrt(x * x + y * y); }

/** Ein Simulationsschritt fuer EINEN Spieler. Muetiert p. */
export function stepPlayer(p, input, world) {
  const dt = DT;

  // Zeitgeber herunterzaehlen
  p.biteCd  = Math.max(0, p.biteCd  - dt);
  p.barkCd  = Math.max(0, p.barkCd  - dt);
  p.sniffCd = Math.max(0, p.sniffCd - dt);
  p.barkT   = Math.max(0, p.barkT   - dt);
  p.sniffT  = Math.max(0, p.sniffT  - dt);
  p.stunT   = Math.max(0, p.stunT   - dt);
  if (p.biteT > 0) p.biteT = Math.max(0, p.biteT - dt);

  const stunned = p.stunT > 0;
  const biting  = p.biteT > 0;

  let dx = input.dx || 0, dy = input.dy || 0;
  const m = len(dx, dy);
  if (m > 1) { dx /= m; dy /= m; }

  // Beissen: Anlauf + aktives Fenster. Waehrend des Bisses steuert man nicht.
  if (!stunned && !biting && (input.btn & BTN.BITE) && p.biteCd <= 0) {
    p.biteT = BITE.windup + BITE.active;
    p.biteCd = BITE.cd;
    if (m > 0.15) { p.facing = dx >= 0 ? 1 : -1; }
    // Hechtsprung in Blickrichtung
    const lx = m > 0.15 ? dx : p.facing;
    const ly = m > 0.15 ? dy : 0;
    const ll = len(lx, ly) || 1;
    p.vx += (lx / ll) * BITE.lunge;
    p.vy += (ly / ll) * BITE.lunge;
  }

  // Bellen
  if (!stunned && !biting && (input.btn & BTN.BARK) && p.barkCd <= 0) {
    p.barkCd = BARK.cd;
    p.barkT = BARK.dur;
  }

  // Nase: kurz tippen = schnueffeln, halten auf einem Depot = graben
  const noseHeld = !!(input.btn & BTN.NOSE) && !stunned && !biting;
  const onCache = noseHeld ? cacheAt(world, p.x, p.y) : null;
  if (noseHeld && onCache && m < 0.2) {
    p.digT += dt;
  } else {
    p.digT = 0;
    if (noseHeld && p.sniffCd <= 0) { p.sniffCd = SNIFF.cd; p.sniffT = SNIFF.dur; }
  }
  const digging = p.digT > 0;

  // Sprinten
  const wantRun = !!(input.btn & BTN.RUN) && m > 0.1 && p.stam > STAM.runMin && !digging;
  if (wantRun) {
    p.stam = Math.max(0, p.stam - STAM.drain * dt);
    p.stamHold = STAM.regenDelay;
  } else {
    p.stamHold = Math.max(0, p.stamHold - dt);
    if (p.stamHold <= 0) p.stam = Math.min(STAM.max, p.stam + STAM.regen * dt);
  }

  // Zielgeschwindigkeit
  let speed = wantRun ? DOG.run : DOG.walk;
  if (p.carrying) speed *= DOG.carryFactor;
  const driven = !(stunned || biting || digging) && m > 0.05;

  if (driven) {
    // Auf die Zielgeschwindigkeit zu beschleunigen, begrenzt durch accel.
    const a = DOG.accel * dt;
    let ddx = dx * speed - p.vx, ddy = dy * speed - p.vy;
    const dl = len(ddx, ddy);
    if (dl > a) { ddx = ddx / dl * a; ddy = ddy / dl * a; }
    p.vx += ddx; p.vy += ddy;
  } else {
    // Kein Antrieb: ausrollen. Traegt den Hechtsprung-Impuls des Bisses
    // und den Rueckstoss des Bellens.
    const f = Math.exp(-DOG.friction * dt);
    p.vx *= f; p.vy *= f;
  }

  p.x += p.vx * dt;
  p.y += p.vy * dt;

  // Arenagrenzen
  p.x = clamp(p.x, DOG.r + ARENA.pad, ARENA.w - DOG.r - ARENA.pad);
  p.y = clamp(p.y, DOG.r + ARENA.pad, ARENA.h - DOG.r - ARENA.pad);

  if (!stunned && !biting && m > 0.15) p.facing = dx >= 0 ? 1 : -1;

  // Zustand fuer die Darstellung
  const sp = len(p.vx, p.vy);
  if (stunned)      p.anim = 'stunned';
  else if (biting)  p.anim = 'bite';
  else if (digging) p.anim = 'dig';
  else if (p.barkT > BARK.dur - 0.3) p.anim = 'bark';
  else if (p.sniffT > SNIFF.dur - 0.35 && sp < 40) p.anim = 'sniff';
  else if (sp > DOG.walk * 1.12) p.anim = 'run';
  else if (sp > 22) p.anim = p.carrying ? 'prowl' : 'walk';
  else p.anim = 'idle';

  return p;
}

/** Liegt (x,y) auf einem noch nicht gehobenen Depot? */
export function cacheAt(world, x, y) {
  for (const c of world.caches) {
    if (c.taken) continue;
    if (len(c.x - x, c.y - y) <= CACHE.r) return c;
  }
  return null;
}

/** Trifft der Biss von a den Spieler b? Kegel vor der Schnauze. */
export function biteHits(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = len(dx, dy);
  if (d > BITE.range + DOG.r) return false;
  if (d < 1) return true;
  const fx = a.facing, fy = 0;
  const dot = (dx / d) * fx + (dy / d) * fy;
  return dot >= BITE.cone;
}

export function houseFor(slot) {
  // Vier Ecken, dann vier Kantenmitten -- bis 8 Spieler
  const P = ARENA.pad + 150;
  const spots = [
    { x: P, y: P }, { x: ARENA.w - P, y: ARENA.h - P },
    { x: ARENA.w - P, y: P }, { x: P, y: ARENA.h - P },
    { x: ARENA.w / 2, y: P }, { x: ARENA.w / 2, y: ARENA.h - P },
    { x: P, y: ARENA.h / 2 }, { x: ARENA.w - P, y: ARENA.h / 2 },
  ];
  return spots[slot % spots.length];
}

export const util = { clamp, len };
