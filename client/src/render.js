// Renderer. Canvas2D, 2,5-D: die Sprites bleiben reine Seitenansicht, die
// Bewegung laeuft auf einer Bodenebene. Bildschirm-Y = Welt-Y * SQUASH,
// Tiefensortierung nach Welt-Y. Das ist das Beat-em-up-Prinzip -- der einzige
// Aufbau, fuer den diese Zeichnungen ohne neue Kunst ausreichen.
import { ARENA, DOG, HOUSE, CACHE, SNIFF, BITE, houseFor } from '../../shared/sim.js';

export const SQUASH = 0.62;
const VIS = 0.54;              // Atlas-Pixel -> Welteinheiten

export const SLOT_COLORS = [
  '#ffd166', '#4cc9f0', '#f4978e', '#90e0a0',
  '#c77dff', '#ffa552', '#7ad7c4', '#ff8fab',
];

const ANIM_FRAMES = {
  idle:    ['walk4'],
  walk:    ['walk0', 'walk1', 'walk2', 'walk3', 'walk4'],
  prowl:   ['prowl0', 'prowl1', 'prowl2', 'prowl3'],
  run:     ['run0', 'run1'],
  bite:    ['bite0', 'bite1'],
  bark:    ['bark'],
  sniff:   ['sniff'],
  dig:     ['sniff'],
  stunned: ['sleep0'],
};
// Bildrate nur noch fuer Posen OHNE Fortbewegung. Alles, was laeuft, haengt an
// der zurueckgelegten STRECKE (s. STRIDE) -- eine feste Bildrate loest die Beine
// vom Boden, sobald das Tempo nicht exakt zum Takt passt ("foot sliding").
const ANIM_FPS = { bark: 8, sniff: 6, dig: 10, stunned: 2, default: 6 };

// Schrittlaenge in Welteinheiten fuer EINEN vollen Zyklus. Daraus ergibt sich
// der Takt: Zyklen/s = Tempo / Schrittlaenge. Der Hund ist 68 Einheiten lang.
//
// ⚠️ Vorher lief der Sprint mit 13 fps auf zwei Bildern = 6,5 Zyklen/s, das
// sind 52 Einheiten Schrittlaenge -- KUERZER als der Geh-Schritt (119) bei
// fast doppeltem Tempo und 0,77 Koerperlaengen pro Galoppsprung. Ein echter
// Hund macht 2-2,5 Koerperlaengen bei 2,5-3,5 Zyklen/s. Daher das Flimmern.
export const STRIDE = { walk: 95, prowl: 86, run: 120 };

// Fusstritte je Zyklus (Phasenlage 0..1). Staub kommt beim AUFSETZEN, nicht
// nach Wuerfel -- gewuerfelter Staub haengt an der Bildrate des Geraets.
const FOOTFALL = { run: [0.06, 0.52], walk: [0.0, 0.5], prowl: [0.0, 0.5] };

export const BITE_DUR = BITE.windup + BITE.active;   // 0,26 s -- so lange dauert der Biss
export const BITE_LAND = 0.16;                        // Nachschwingen nach dem Zuschnappen

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export class Renderer {
  constructor(canvas, atlasImg, atlasJson) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.img = atlasImg;
    this.atlas = atlasJson;
    this.pivots = atlasJson.meta.brummer?.pivots || {};
    this.cam = { x: ARENA.w / 2, y: ARENA.h / 2, zoom: 1 };
    this.phase = new Map();       // slot -> Animationszustand (s. _animState)
    this.fx = [];
    this.ground = this._makeGround();
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.t = 0;
  }

  // --- Boden: es gibt keine Hintergrundgrafik, also erzeugen wir eine.
  _makeGround() {
    const S = 256;
    const c = document.createElement('canvas');
    c.width = c.height = S;
    const g = c.getContext('2d');
    g.fillStyle = '#4a7a44';
    g.fillRect(0, 0, S, S);
    // Grasbueschel: viele kurze Striche in leicht wechselnden Gruentoenen
    let seed = 1337;
    const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    for (let i = 0; i < 1400; i++) {
      const x = rnd() * S, y = rnd() * S, h = 3 + rnd() * 6;
      const l = 38 + rnd() * 20;
      g.strokeStyle = `hsl(${95 + rnd() * 22} 30% ${l}%)`;
      g.lineWidth = 1 + rnd();
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (rnd() - .5) * 3, y - h); g.stroke();
    }
    for (let i = 0; i < 90; i++) {
      const x = rnd() * S, y = rnd() * S, r = 6 + rnd() * 22;
      g.fillStyle = `hsl(${100 + rnd() * 18} 26% ${rnd() > .5 ? 30 : 44}% / .16)`;
      g.beginPath(); g.ellipse(x, y, r, r * .6, rnd() * 3, 0, 7); g.fill();
    }
    return this.ctx.createPattern(c, 'repeat');
  }

  resize() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = this.cv.clientWidth, h = this.cv.clientHeight;
    if (this.cv.width !== Math.round(w * dpr) || this.cv.height !== Math.round(h * dpr)) {
      this.cv.width = Math.round(w * dpr);
      this.cv.height = Math.round(h * dpr);
    }
    this.dpr = dpr; this.vw = w; this.vh = h;
  }

  // Welt -> Bildschirm
  toScreen(x, y) {
    const z = this.cam.zoom;
    return [(x - this.cam.x) * z + this.vw / 2, (y * SQUASH - this.cam.y * SQUASH) * z + this.vh / 2];
  }

  follow(x, y, dt) {
    // resize() MUSS vorher gelaufen sein -- sonst ist vw/vh undefiniert, der
    // Zoom wird NaN und die Klemmung unten macht die Kamera dauerhaft kaputt.
    if (!this.vw) this.resize();
    // Zoom passt die HOEHE, nicht die Breite: die Arena ist 2,45:1, eine
    // Breiten-Passung liesse auf jedem normalen Bildschirm tote Baender oben
    // und unten. Horizontal wandert stattdessen die Kamera mit.
    const fit = this.vh / (ARENA.h * SQUASH);
    this.cam.zoom = Math.max(0.3, Math.min(1.4, fit));
    const k = this.reduced ? 1 : Math.min(1, dt * 7);
    this.cam.x += (x - this.cam.x) * k;
    this.cam.y += (y - this.cam.y) * k;
    // an den Arenagrenzen anhalten
    const hw = this.vw / (2 * this.cam.zoom), hh = this.vh / (2 * this.cam.zoom * SQUASH);
    this.cam.x = Math.max(Math.min(hw, ARENA.w / 2), Math.min(this.cam.x, Math.max(ARENA.w - hw, ARENA.w / 2)));
    this.cam.y = Math.max(Math.min(hh, ARENA.h / 2), Math.min(this.cam.y, Math.max(ARENA.h - hh, ARENA.h / 2)));
    // Ein einziger schlechter Frame darf die Kamera nicht dauerhaft toeten:
    // NaN pflanzt sich durch jede weitere Rechnung fort.
    if (!Number.isFinite(this.cam.x)) this.cam.x = ARENA.w / 2;
    if (!Number.isFinite(this.cam.y)) this.cam.y = ARENA.h / 2;
    if (!Number.isFinite(this.cam.zoom)) this.cam.zoom = 0.6;
  }

  // ------------------------------------------------------------ Effekte
  spawn(kind, x, y, opt = {}) {
    if (this.reduced && kind !== 'score') return;
    this.fx.push({ kind, x, y, t: 0, life: opt.life || 0.6, ...opt });
  }
  dust(x, y, n = 3, spread = 26) {
    for (let i = 0; i < n; i++) {
      this.spawn('dust', x + (Math.random() - .5) * spread, y + (Math.random() - .5) * 10, {
        life: 0.45 + Math.random() * 0.3,
        vx: (Math.random() - .5) * 55, vy: -14 - Math.random() * 26, r: 7 + Math.random() * 9,
      });
    }
  }

  _stepFx(dt) {
    for (const f of this.fx) {
      f.t += dt;
      if (f.vx !== undefined) { f.x += f.vx * dt; f.y += f.vy * dt; f.vy += 40 * dt; }
    }
    this.fx = this.fx.filter(f => f.t < f.life);
  }

  // ------------------------------------------------------------ Zeichnen
  /** Animationszustand je Spieler. Haelt Phase, geglaettete Werte und die
   *  lokale Biss-Uhr -- alles, was zwischen zwei Bildern ueberleben muss. */
  _animState(slot) {
    let st = this.phase.get(slot);
    if (!st) {
      st = { ph: 0, lift: 0, squash: 1, rot: 0, dx: 0,
             px: null, py: null, speed: 0,
             biteT: -1, wasBite: false, pushed: false };
      this.phase.set(slot, st);
    }
    return st;
  }

  frame(name) { return this.atlas.frames[name]; }

  drawSprite(name, wx, wy, opt = {}) {
    const f = this.frame(name);
    if (!f) return;
    const { ctx } = this;
    const s = (opt.scale || 1) * VIS * this.cam.zoom;
    const [sx, sy] = this.toScreen(wx, wy);
    const w = f.frame.w * s, h = f.frame.h * s;
    const dy = (this.pivots[name]?.dy || 0) * s;
    ctx.save();
    ctx.translate(sx + (opt.dx || 0) * this.cam.zoom, sy + (opt.lift || 0) * this.cam.zoom);
    // ⚠️ Die Drehung steht VOR dem Spiegeln, wirkt also im ungespiegelten
    // System. Wer nach vorn lehnen will, muss den Winkel mit facing
    // multiplizieren -- sonst lehnt der linkslaufende Hund nach hinten.
    if (opt.rot) ctx.rotate(opt.rot);
    if (opt.flip) ctx.scale(-1, 1);
    if (opt.squash) ctx.scale(1 / opt.squash, opt.squash);
    if (opt.alpha !== undefined) ctx.globalAlpha = opt.alpha;
    ctx.drawImage(this.img, f.frame.x, f.frame.y, f.frame.w, f.frame.h,
                  -w / 2, -h + dy, w, h);
    ctx.restore();
  }

  drawGround() {
    const { ctx } = this;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = '#2e4a2c';
    ctx.fillRect(0, 0, this.vw, this.vh);
    const [ox, oy] = this.toScreen(0, 0);
    const [ex, ey] = this.toScreen(ARENA.w, ARENA.h);
    ctx.save();
    ctx.beginPath(); ctx.rect(ox, oy, ex - ox, ey - oy); ctx.clip();
    ctx.translate(ox, oy);
    ctx.scale(this.cam.zoom, this.cam.zoom);
    ctx.fillStyle = this.ground;
    ctx.fillRect(0, 0, (ex - ox) / this.cam.zoom, (ey - oy) / this.cam.zoom);
    ctx.restore();
    // Rand
    ctx.strokeStyle = 'rgba(20,30,18,.55)'; ctx.lineWidth = 3;
    ctx.strokeRect(ox, oy, ex - ox, ey - oy);
    ctx.restore();
  }

  drawFence() {
    const { ctx } = this;
    const step = 95;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.lineCap = 'round';
    const post = (wx, wy) => {
      const [x, y] = this.toScreen(wx, wy);
      const h = 46 * this.cam.zoom;
      ctx.strokeStyle = '#6b4a30'; ctx.lineWidth = 5 * this.cam.zoom;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x, y - h); ctx.stroke();
      ctx.strokeStyle = '#8a6440'; ctx.lineWidth = 2 * this.cam.zoom;
      ctx.beginPath(); ctx.moveTo(x, y - 2); ctx.lineTo(x, y - h + 2); ctx.stroke();
    };
    for (let x = 0; x <= ARENA.w; x += step) { post(x, 0); post(x, ARENA.h); }
    for (let y = step; y < ARENA.h; y += step) { post(0, y); post(ARENA.w, y); }
    ctx.restore();
  }

  /** Der Hof ist eine Bodenmarkierung -- die liegt IMMER unter allem. */
  drawHouseYard(slot) {
    const h = houseFor(slot);
    const { ctx } = this;
    const [x, y] = this.toScreen(h.x, h.y);
    const z = this.cam.zoom;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = SLOT_COLORS[slot % 8] + '22';
    ctx.strokeStyle = SLOT_COLORS[slot % 8] + '99';
    ctx.lineWidth = 2.5 * z;
    ctx.setLineDash([9 * z, 7 * z]);
    ctx.beginPath(); ctx.ellipse(x, y, HOUSE.r * z, HOUSE.r * z * SQUASH, 0, 0, 7);
    ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    ctx.restore();
  }

  /** Der Baukoerper steht dagegen IM Feld und gehoert in die Tiefensortierung:
   *  ein Hund dahinter muss dahinter bleiben. */
  drawHouseBody(slot) {
    const h = houseFor(slot);
    const { ctx } = this;
    const [x, y] = this.toScreen(h.x, h.y);
    const z = this.cam.zoom;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    // Huette
    const W = 76 * z, H = 62 * z;
    ctx.fillStyle = '#5d4030';
    ctx.fillRect(x - W / 2, y - H, W, H);
    ctx.fillStyle = SLOT_COLORS[slot % 8];
    ctx.beginPath();
    ctx.moveTo(x - W / 2 - 7 * z, y - H);
    ctx.lineTo(x, y - H - 34 * z);
    ctx.lineTo(x + W / 2 + 7 * z, y - H);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#241a14';
    ctx.beginPath();
    ctx.ellipse(x, y - H * 0.34, W * 0.28, H * 0.36, 0, Math.PI, 0);
    ctx.rect(x - W * 0.28, y - H * 0.34, W * 0.56, H * 0.34);
    ctx.fill();
    ctx.restore();
  }

  drawShadow(wx, wy, r, alpha = 0.32) {
    const { ctx } = this;
    const [x, y] = this.toScreen(wx, wy);
    const z = this.cam.zoom;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = `rgba(12,22,10,${alpha})`;
    ctx.beginPath(); ctx.ellipse(x, y, r * z, r * z * 0.42, 0, 0, 7); ctx.fill();
    ctx.restore();
  }

  /** Wahl von Frame + prozeduraler Bewegung. Die Blaetter liefern Posen,
   *  keine Zwischenbilder -- Leben kommt hier dazu. */
  dogVisual(p, dt) {
    const st = this._animState(p.slot);
    dt = Math.min(dt, 0.05);              // Tab-Wechsel darf die Phase nicht schleudern

    // --- Tempo aus der TATSAECHLICH gezeichneten Strecke -------------------
    // Nicht aus vx/vy: fremde Figuren werden interpoliert, und die Beine
    // muessen zu dem passen, was auf dem Schirm passiert, nicht zur Physik.
    let dist = 0;
    if (st.px !== null) dist = Math.hypot(p.x - st.px, p.y - st.py);
    if (dist > 70) dist = 0;              // Sprung nach Paketverlust nicht in die Phase geben
    st.px = p.x; st.py = p.y;
    const roh = dt > 0 ? dist / dt : 0;
    st.speed += (roh - st.speed) * (1 - Math.exp(-14 * dt));
    const kraft = clamp01(st.speed / DOG.run);          // 0 = steht, 1 = Vollgas

    // --- Biss: eigener Zeitgeber, an der Flanke gestartet ------------------
    // Der Schnappschuss traegt keinen Biss-Fortschritt (das waere ein Byte je
    // Spieler und Takt). Die Dauer ist aber eine Konstante, also laeuft die
    // Uhr lokal -- fluessig statt auf 30 Hz gerastert.
    const beisst = p.anim === 'bite';
    if (beisst && !st.wasBite) { st.biteT = 0; st.pushed = false; }
    st.wasBite = beisst;
    if (st.biteT >= 0) {
      st.biteT += dt;
      if (st.biteT > BITE_DUR + BITE_LAND) st.biteT = -1;
    }

    // --- Fortbewegung: Phase folgt der Strecke -----------------------------
    const list = ANIM_FRAMES[p.anim] || ANIM_FRAMES.idle;
    const stride = STRIDE[p.anim];
    const vorher = st.ph;
    if (stride) st.ph += dist / stride;
    else        st.ph += dt * (ANIM_FPS[p.anim] || ANIM_FPS.default) / list.length;

    const u = st.ph - Math.floor(st.ph);
    let name = list[Math.min(list.length - 1, Math.floor(u * list.length))];
    let zLift = 0, zSquash = 1, zRot = 0, zDx = 0;

    if (!this.reduced) {
      if (p.anim === 'run') {
        // Galopp: EIN Flugbogen je Zyklus, gelegt auf das gestreckte Bild.
        // Vorher hob |sin| den Hund zweimal je Zyklus -- ein Huepfen, kein Galopp.
        const flug   = Math.max(0, Math.sin((u - 0.5) * 2 * Math.PI));  // 2. Haelfte
        const sammeln = Math.max(0, Math.sin(u * 2 * Math.PI));         // 1. Haelfte
        zLift   = -(5 + 11 * kraft) * flug;
        zSquash = 1 - 0.11 * kraft * flug + 0.05 * kraft * sammeln;     // strecken / stauchen
        zRot    = (0.05 + 0.055 * kraft) * p.facing;                    // Vorlage ins Tempo
      } else if (p.anim === 'walk' || p.anim === 'prowl') {
        const hoch = Math.abs(Math.sin(u * 2 * Math.PI));
        zLift   = -hoch * (p.anim === 'prowl' ? 2.2 : 3);
        zSquash = 1 + 0.015 * hoch;
        zRot    = 0.015 * p.facing;
      } else if (p.anim === 'idle') {
        const a = Math.sin(this.t * 1.9 + p.slot);
        zLift = a * 1.4; zSquash = 1 + a * 0.008;
      } else if (p.anim === 'dig') {
        zLift = Math.sin(this.t * 26) * 2.5; zRot = Math.sin(this.t * 26) * 0.03;
      } else if (p.anim === 'bark') {
        zSquash = 1.04;
      } else if (p.anim === 'stunned') {
        zRot = 0.05;
      }

      // --- Biss ueberschreibt alles ---------------------------------------
      if (st.biteT >= 0) {
        if (st.biteT < BITE.windup) {
          // ANTICIPATION: zurueckziehen und ducken. Ohne sie wirkt jeder
          // Angriff wie ein Schnitt -- der Zuschauer sieht ihn nicht kommen.
          const k = st.biteT / BITE.windup, e = k * k;
          name = 'bite0';
          zDx = -11 * e * p.facing;
          zLift = 3.5 * e;
          zSquash = 1 - 0.10 * e;
          zRot = -0.06 * e * p.facing;
        } else if (st.biteT < BITE_DUR) {
          // ZUSCHNAPPEN: explosiv raus, dann auslaufen (ease-out), Flugbogen.
          const k = (st.biteT - BITE.windup) / BITE.active;
          const e = 1 - Math.pow(1 - k, 3);
          const bogen = Math.sin(k * Math.PI);
          name = 'bite1';
          zDx = 15 * e * p.facing;
          zLift = -(2 + 15 * bogen);
          zSquash = 1 - 0.17 * bogen;
          zRot = 0.14 * e * p.facing;
        } else {
          // NACHSCHWINGEN: landen, einfedern, ausschwingen. Der Name kommt
          // wieder aus der Fortbewegung -- der Biss ist vorbei, der Koerper
          // federt nur noch aus.
          const k = clamp01((st.biteT - BITE_DUR) / BITE_LAND);
          const federn = (1 - k) * Math.cos(k * Math.PI * 1.6);
          zSquash -= 0.13 * federn;
          zLift += 2.5 * federn;
        }
      }
    }

    // --- Glaetten: keine Spruenge zwischen zwei Zustaenden -----------------
    // ⚠️ Die Glaettung ist ein Tiefpass und daempft damit auch den Flugbogen,
    // der ja selbst schwingt. Gemessen bei 2,94 Zyklen/s: Rate 22 liess nur
    // 77 % der Sprunghoehe uebrig und schob den Bogen 38 ms hinter den
    // Bildwechsel. Rate 55 haelt 95 % und 18 ms -- unter einem Bild bei 60 Hz --
    // und glaettet den Zustandswechsel immer noch ueber ~3 Bilder.
    // Beim Biss noch schneller, sonst frisst sie den Schlag.
    const rate = st.biteT >= 0 ? 90 : 55;
    const a = 1 - Math.exp(-rate * dt);
    st.lift   += (zLift   - st.lift)   * a;
    st.squash += (zSquash - st.squash) * a;
    st.rot    += (zRot    - st.rot)    * a;
    st.dx     += (zDx     - st.dx)     * a;

    // --- Staub auf den Fusstritt ------------------------------------------
    if (!this.reduced && stride && p.anim === 'run' && kraft > 0.45) {
      for (const f of FOOTFALL.run) {
        if (Math.floor(vorher - f) !== Math.floor(st.ph - f)) {
          this.dust(p.x - p.facing * 26, p.y + 3, 1, 14);
        }
      }
    }
    // Abstoss-Staub genau im Moment des Zuschnappens (nicht erst, wenn der
    // Server den Treffer bestaetigt -- das waere eine halbe Netzrunde spaeter).
    if (!this.reduced && st.biteT >= BITE.windup && !st.pushed) {
      st.pushed = true;
      this.dust(p.x - p.facing * 20, p.y + 2, 3, 20);
    }

    return { name, lift: st.lift, squash: st.squash, rot: st.rot, dx: st.dx, air: -st.lift };
  }

  drawDog(p, dt) {
    const v = this.dogVisual(p, dt);
    const { ctx } = this;
    // Der Schatten haengt an der Flughoehe, nicht am Zustandsnamen: je hoeher
    // der Hund, desto kleiner und blasser. Das erst macht den Sprung lesbar.
    const hoch = Math.min(1, Math.max(0, v.air) / 18);
    this.drawShadow(p.x, p.y, DOG.r * 1.5 * (1 - 0.3 * hoch), 0.34 - 0.18 * hoch);

    // Farbring des Spielers -- man muss sofort sehen, wer wer ist
    const [sx, sy] = this.toScreen(p.x, p.y);
    const z = this.cam.zoom;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.strokeStyle = SLOT_COLORS[p.slot % 8] + (p.you ? 'ff' : 'aa');
    ctx.lineWidth = (p.you ? 3.4 : 2.2) * z;
    ctx.beginPath(); ctx.ellipse(sx, sy, DOG.r * 1.15 * z, DOG.r * 1.15 * z * 0.42, 0, 0, 7); ctx.stroke();
    ctx.restore();

    this.drawSprite(v.name, p.x, p.y, {
      flip: p.facing < 0, lift: v.lift, squash: v.squash, rot: v.rot, dx: v.dx,
      alpha: p.stun > 0 ? 0.82 : 1,
    });

    // Getragener Knochen an der Schnauze
    if (p.carrying) {
      const f = this.frame('bone');
      if (f) this.drawSprite('bone', p.x + p.facing * 52, p.y - 52, { scale: 0.85, dx: v.dx, lift: v.lift });
    }
  }

  drawBone(b) {
    if (b.by >= 0) return;                     // getragene zeichnet drawDog
    const bob = this.reduced ? 0 : Math.sin(this.t * 2.4 + b.id) * 3;
    this.drawShadow(b.x, b.y, 17, 0.22);
    this.drawSprite('bone', b.x, b.y - 6 + bob);
  }

  drawNameTag(p) {
    const { ctx } = this;
    const [x, y] = this.toScreen(p.x, p.y);
    const z = this.cam.zoom;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const label = p.name + (p.bot ? ' ·' : '');
    ctx.font = `600 ${Math.max(10, 13 * z)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const ty = y - (96 * z);
    const w = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(8,16,8,.5)';
    ctx.beginPath();
    ctx.roundRect(x - w / 2 - 6 * z, ty - 15 * z, w + 12 * z, 18 * z, 9 * z);
    ctx.fill();
    ctx.fillStyle = p.you ? '#ffffff' : SLOT_COLORS[p.slot % 8];
    ctx.fillText(label, x, ty);
    ctx.restore();
  }

  drawCache(c, revealed) {
    if (!revealed) return;
    const { ctx } = this;
    const [x, y] = this.toScreen(c[1], c[2]);
    const z = this.cam.zoom;
    const pulse = 0.6 + 0.4 * Math.sin(this.t * 3);
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.strokeStyle = `rgba(255,214,102,${0.35 + 0.35 * pulse})`;
    ctx.lineWidth = 2.5 * z;
    ctx.setLineDash([7 * z, 6 * z]);
    ctx.beginPath(); ctx.ellipse(x, y, CACHE.r * z, CACHE.r * z * SQUASH, 0, 0, 7); ctx.stroke();
    ctx.setLineDash([]);
    // Erdhuegel
    ctx.fillStyle = 'rgba(92,64,40,.75)';
    ctx.beginPath(); ctx.ellipse(x, y, 26 * z, 12 * z, 0, Math.PI, 0); ctx.fill();
    ctx.restore();
  }

  drawFx() {
    const { ctx } = this;
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    for (const f of this.fx) {
      const k = f.t / f.life;
      const [x, y] = this.toScreen(f.x, f.y);
      const z = this.cam.zoom;
      if (f.kind === 'dust') {
        ctx.fillStyle = `rgba(196,180,150,${(1 - k) * 0.5})`;
        ctx.beginPath(); ctx.arc(x, y, f.r * z * (0.6 + k * 1.5), 0, 7); ctx.fill();
      } else if (f.kind === 'bark') {
        ctx.strokeStyle = `rgba(255,255,255,${(1 - k) * 0.65})`;
        ctx.lineWidth = (4 - 3 * k) * z;
        ctx.beginPath(); ctx.ellipse(x, y, f.r * k * z, f.r * k * z * SQUASH, 0, 0, 7); ctx.stroke();
      } else if (f.kind === 'bite') {
        ctx.strokeStyle = `rgba(255,120,90,${(1 - k) * 0.9})`;
        ctx.lineWidth = 3 * z;
        for (let i = 0; i < 3; i++) {
          const a = f.a0 + i * 0.5;
          const r0 = 16 * z + k * 30 * z, r1 = r0 + 16 * z;
          ctx.beginPath();
          ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0 * SQUASH);
          ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1 * SQUASH);
          ctx.stroke();
        }
      } else if (f.kind === 'scent') {
        ctx.strokeStyle = `rgba(160,220,255,${(1 - k) * 0.5})`;
        ctx.lineWidth = 2 * z;
        ctx.beginPath(); ctx.ellipse(x, y, f.r * k * z, f.r * k * z * SQUASH, 0, 0, 7); ctx.stroke();
      } else if (f.kind === 'score') {
        ctx.font = `800 ${20 * z}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.fillStyle = `rgba(255,214,102,${1 - k})`;
        ctx.fillText(f.text || '+1', x, y - 60 * z - k * 44 * z);
      }
    }
    ctx.restore();
  }

  render(state, dt) {
    this.t += dt;
    this._stepFx(dt);
    this.resize();
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.drawGround();

    for (const slot of state.slots) this.drawHouseYard(slot);
    for (const c of state.caches) this.drawCache(c, state.revealed);

    // Tiefensortierung: was weiter hinten steht (kleineres y), wird zuerst gemalt
    const things = [];
    for (const b of state.bones) if (b.by < 0) things.push({ y: b.y, kind: 'bone', o: b });
    for (const p of state.players) things.push({ y: p.y, kind: 'dog', o: p });
    for (const slot of state.slots) things.push({ y: houseFor(slot).y, kind: 'house', o: slot });
    things.sort((a, b) => a.y - b.y);
    for (const t of things) {
      if (t.kind === 'bone') this.drawBone(t.o);
      else if (t.kind === 'house') this.drawHouseBody(t.o);
      else this.drawDog(t.o, dt);
    }
    for (const p of state.players) this.drawNameTag(p);

    this.drawFence();
    this.drawFx();
  }
}
