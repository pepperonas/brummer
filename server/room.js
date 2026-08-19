// Ein Raum = eine Arena. Der Server ist autoritativ: Clients schicken NUR
// Eingaben, niemals Positionen. Treffer werden ausschliesslich hier geprueft.
import {
  TICK_HZ, DT, ARENA, DOG, BITE, BARK, SNIFF, DIG, BONE, CACHE, HOUSE, ROUND, BTN,
  makePlayer, stepPlayer, biteHits, cacheAt, houseFor, util,
} from '../shared/sim.js';
import { botInput, BOT_NAMES } from './bots.js';

const { len, clamp } = util;
const MAX = 8;
const BOT_TARGET = 3;      // so viele Gegner soll ein einzelner Mensch vorfinden

let roomSeq = 0;

export class Room {
  constructor(code, onScore) {
    this.code = code;
    this.onScore = onScore || (() => {});
    this.players = new Map();   // id -> player (Mensch UND Bot)
    this.conns = new Map();     // id -> ws  (nur Menschen)
    this.inputs = new Map();    // id -> letzte Eingabe
    this.bones = [];
    this.caches = [];
    this.events = [];
    this.tick = 0;
    this.phase = 'play';
    this.phaseT = ROUND.play;
    this.boneSeq = 0;
    this.rng = 0x2f6e2b1 ^ (++roomSeq * 2654435761);
    this.reset();
  }

  // Eigener Zufall: reproduzierbar und unabhaengig von Math.random,
  // damit Runden aus einem Seed nachgespielt werden koennen.
  rnd() {
    this.rng ^= this.rng << 13; this.rng |= 0;
    this.rng ^= this.rng >>> 17;
    this.rng ^= this.rng << 5;  this.rng |= 0;
    return ((this.rng >>> 0) % 100000) / 100000;
  }
  rndIn(a, b) { return a + this.rnd() * (b - a); }

  reset() {
    this.bones = [];
    this.caches = [];
    this.boneSeq = 0;
    for (let i = 0; i < BONE.onField; i++) this.spawnBone();
    for (let i = 0; i < CACHE.count; i++) this.spawnCache();
    for (const p of this.players.values()) {
      p.score = 0; p.bites = 0; p.delivered = 0; p.carrying = null;
      p.stunT = 0; p.digT = 0; p.stam = 100;
      const h = houseFor(p.slot);
      p.x = h.x; p.y = h.y; p.vx = p.vy = 0;
    }
    this.phase = 'play';
    this.phaseT = ROUND.play;
    this.push({ e: 'round', phase: 'play' });
  }

  freeSpot(minDistToHouses = 220) {
    for (let tries = 0; tries < 40; tries++) {
      const x = this.rndIn(ARENA.pad + 120, ARENA.w - ARENA.pad - 120);
      const y = this.rndIn(ARENA.pad + 120, ARENA.h - ARENA.pad - 120);
      let ok = true;
      for (const p of this.players.values()) {
        const h = houseFor(p.slot);
        if (len(h.x - x, h.y - y) < minDistToHouses) { ok = false; break; }
      }
      if (ok) return { x, y };
    }
    return { x: ARENA.w / 2, y: ARENA.h / 2 };
  }

  spawnBone() {
    const s = this.freeSpot();
    this.bones.push({ id: ++this.boneSeq, x: s.x, y: s.y, by: null, t: 0 });
  }
  spawnCache() {
    const s = this.freeSpot(320);
    this.caches.push({ id: this.caches.length + 1, x: s.x, y: s.y, taken: false });
  }

  push(ev) { this.events.push(ev); }

  freeSlot() {
    const used = new Set([...this.players.values()].map(p => p.slot));
    for (let i = 0; i < MAX; i++) if (!used.has(i)) return i;
    return -1;
  }

  humans() { return [...this.players.values()].filter(p => !p.bot).length; }
  isFull()  { return this.humans() >= MAX; }

  addHuman(id, name, ws) {
    // Erst einen Bot verdraengen, damit Menschen immer Platz haben
    if (this.players.size >= MAX) {
      const bot = [...this.players.values()].find(p => p.bot);
      if (bot) this.remove(bot.id);
    }
    const slot = this.freeSlot();
    if (slot < 0) return null;
    const p = makePlayer(id, name, slot);
    p.bot = false;
    const h = houseFor(slot);
    p.x = h.x; p.y = h.y;
    this.players.set(id, p);
    this.conns.set(id, ws);
    this.inputs.set(id, { dx: 0, dy: 0, btn: 0, seq: 0 });
    this.push({ e: 'join', id: slot, name });
    return p;
  }

  addBot() {
    const slot = this.freeSlot();
    if (slot < 0) return null;
    const id = 'bot' + slot + '_' + this.code;
    const name = BOT_NAMES[slot % BOT_NAMES.length];
    const p = makePlayer(id, name, slot);
    p.bot = true;
    p.brain = { mode: 'seek', t: 0, target: null, jitter: this.rnd() };
    const h = houseFor(slot);
    p.x = h.x; p.y = h.y;
    this.players.set(id, p);
    this.inputs.set(id, { dx: 0, dy: 0, btn: 0, seq: 0 });
    this.push({ e: 'join', id: slot, name, bot: true });
    return p;
  }

  remove(id) {
    const p = this.players.get(id);
    if (p && p.carrying) this.dropBone(p);
    this.players.delete(id);
    this.conns.delete(id);
    this.inputs.delete(id);
    this.push({ e: 'leave', id: p ? p.slot : -1 });
  }

  setInput(id, inp) {
    const cur = this.inputs.get(id);
    if (!cur) return;
    cur.dx = clamp(+inp.dx || 0, -1, 1);
    cur.dy = clamp(+inp.dy || 0, -1, 1);
    cur.btn = (+inp.btn | 0) & 15;
    if (typeof inp.seq === 'number') cur.seq = inp.seq;
  }

  dropBone(p) {
    const b = this.bones.find(b => b.id === p.carrying);
    if (b) { b.by = null; b.x = p.x; b.y = p.y + 8; b.t = 0.5; }
    p.carrying = null;
  }

  balanceBots() {
    const h = this.humans();
    const bots = [...this.players.values()].filter(p => p.bot);
    if (h === 0) {
      for (const b of bots) this.remove(b.id);   // leerer Raum: keine Rechenlast
      return;
    }
    const want = Math.max(0, Math.min(BOT_TARGET, MAX - h));
    for (let i = bots.length; i < want; i++) this.addBot();
    for (let i = want; i < bots.length; i++) this.remove(bots[i].id);
  }

  step() {
    this.tick++;
    this.phaseT -= DT;

    if (this.phase === 'play' && this.phaseT <= 0) {
      this.phase = 'over';
      this.phaseT = ROUND.over;
      const board = [...this.players.values()]
        .sort((a, b) => b.score - a.score)
        .map(p => ({ id: p.slot, name: p.name, score: p.score, bites: p.bites, bot: !!p.bot }));
      this.push({ e: 'round', phase: 'over', board });
      this.onScore(board);
    } else if (this.phase === 'over' && this.phaseT <= 0) {
      this.reset();
    }

    const playing = this.phase === 'play';

    // Bot-Eingaben erzeugen
    for (const p of this.players.values()) {
      if (!p.bot) continue;
      this.inputs.set(p.id, botInput(p, this, playing));
    }

    // Bewegung
    for (const p of this.players.values()) {
      const inp = this.inputs.get(p.id) || { dx: 0, dy: 0, btn: 0 };
      if (!playing) { inp.btn = 0; inp.dx = 0; inp.dy = 0; }
      const wasBite = p.biteT;
      stepPlayer(p, inp, this);
      p.lastSeq = inp.seq || p.lastSeq;
      // Biss ist genau im aktiven Fenster scharf
      const inActive = p.biteT > 0 && p.biteT <= BITE.active;
      const enteredActive = inActive && (wasBite > BITE.active);
      if (enteredActive) this.resolveBite(p);
      if (p.barkT > BARK.dur - DT * 1.5) this.resolveBark(p);
    }

    // Trennung: Hunde duerfen nicht ineinander stehen
    const list = [...this.players.values()];
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i], b = list[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = len(dx, dy);
        const min = DOG.r * 1.7;
        if (d > 0.01 && d < min) {
          const push = (min - d) / 2;
          const nx = dx / d, ny = dy / d;
          a.x -= nx * push; a.y -= ny * push;
          b.x += nx * push; b.y += ny * push;
        }
      }
    }

    if (playing) {
      this.resolveDigs();
      this.resolveBones();
    }
  }

  resolveBite(a) {
    for (const b of this.players.values()) {
      if (b.id === a.id || b.stunT > 0) continue;
      if (!biteHits(a, b)) continue;
      b.stunT = BITE.stun;
      b.vx += (b.x - a.x) * 2.2;
      b.vy += (b.y - a.y) * 2.2;
      a.bites++;
      const had = !!b.carrying;
      if (had) this.dropBone(b);
      this.push({ e: 'bite', a: a.slot, b: b.slot, x: Math.round(b.x), y: Math.round(b.y), stole: had });
    }
  }

  resolveBark(a) {
    let hit = 0;
    for (const b of this.players.values()) {
      if (b.id === a.id) continue;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = len(dx, dy);
      if (d > BARK.radius || d < 0.01) continue;
      b.vx += (dx / d) * BARK.push;
      b.vy += (dy / d) * BARK.push;
      b.digT = 0;                       // unterbricht das Graben
      hit++;
    }
    this.push({ e: 'bark', id: a.slot, x: Math.round(a.x), y: Math.round(a.y), hit });
  }

  resolveDigs() {
    for (const p of this.players.values()) {
      if (p.digT < DIG.time) continue;
      const c = cacheAt(this, p.x, p.y);
      p.digT = 0;
      if (!c) continue;
      c.taken = true;
      for (let i = 0; i < DIG.yield; i++) {
        const a = (i / DIG.yield) * Math.PI * 2;
        this.bones.push({
          id: ++this.boneSeq,
          x: clamp(p.x + Math.cos(a) * 70, ARENA.pad, ARENA.w - ARENA.pad),
          y: clamp(p.y + Math.sin(a) * 70, ARENA.pad, ARENA.h - ARENA.pad),
          by: null, t: 0.35,
        });
      }
      this.push({ e: 'dig', id: p.slot, x: Math.round(p.x), y: Math.round(p.y), n: DIG.yield });
      // Neues Depot woanders vergraben
      const s = this.freeSpot(320);
      c.x = s.x; c.y = s.y; c.taken = false;
    }
  }

  resolveBones() {
    // Aufnehmen
    for (const b of this.bones) {
      if (b.t > 0) { b.t -= DT; continue; }
      if (b.by) continue;
      for (const p of this.players.values()) {
        if (p.carrying || p.stunT > 0) continue;
        if (len(p.x - b.x, p.y - b.y) <= BONE.pickupR) {
          b.by = p.id; p.carrying = b.id;
          this.push({ e: 'grab', id: p.slot, bone: b.id });
          break;
        }
      }
    }
    // Getragene mitziehen + abliefern
    for (const p of this.players.values()) {
      if (!p.carrying) continue;
      const b = this.bones.find(b => b.id === p.carrying);
      if (!b) { p.carrying = null; continue; }
      b.x = p.x + p.facing * 46;
      b.y = p.y - 4;
      const h = houseFor(p.slot);
      if (len(h.x - p.x, h.y - p.y) <= HOUSE.r) {
        p.score++; p.delivered++;
        p.carrying = null;
        this.bones = this.bones.filter(x => x.id !== b.id);
        this.push({ e: 'deliver', id: p.slot, x: Math.round(h.x), y: Math.round(h.y), score: p.score });
      }
    }
    // Nachschub
    const free = this.bones.filter(b => !b.by).length;
    if (free < BONE.onField) {
      const s = this.freeSpot();
      this.bones.push({ id: ++this.boneSeq, x: s.x, y: s.y, by: null, t: BONE.respawn });
    }
  }

  /** Kompakter Schnappschuss. Arrays statt Objekte -- spart ~60% Bytes. */
  snapshot() {
    const ANIM = { idle: 0, walk: 1, prowl: 2, run: 3, bite: 4, bark: 5, sniff: 6, dig: 7, stunned: 8 };
    return {
      t: 's',
      k: this.tick,
      ph: this.phase,
      pt: Math.max(0, Math.round(this.phaseT)),
      ps: [...this.players.values()].map(p => [
        p.slot, Math.round(p.x), Math.round(p.y),
        Math.round(p.vx), Math.round(p.vy),
        p.facing, ANIM[p.anim] || 0, p.score,
        Math.round(p.stam), p.carrying ? 1 : 0,
        Math.round(p.stunT * 100), p.lastSeq,
        Math.round(p.digT / DIG.time * 100),
        p.sniffT > 0 ? 1 : 0,
      ]),
      bs: this.bones.filter(b => b.t <= 0).map(b => [b.id, Math.round(b.x), Math.round(b.y), b.by === null ? -1 : (this.players.get(b.by)?.slot ?? -1)]),
      cs: this.caches.filter(c => !c.taken).map(c => [c.id, Math.round(c.x), Math.round(c.y)]),
      ev: this.events,
    };
  }

  flushEvents() { this.events = []; }

  meta() {
    return {
      t: 'meta', code: this.code,
      ps: [...this.players.values()].map(p => ({ id: p.id, name: p.name, slot: p.slot, bot: !!p.bot })),
    };
  }
}

export { MAX };
