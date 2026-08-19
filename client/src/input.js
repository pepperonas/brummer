// Eingabe. Tastatur und Touch liefern DASSELBE Format, damit die Spiellogik
// nichts von Geraeten weiss. Der virtuelle Stick ist von Anfang an dabei --
// ihn nachzuruesten hiesse, die halbe Eingabeschicht neu zu schreiben.
import { BTN } from '../../shared/sim.js';

/**
 * Tippt der Spieler gerade in ein Feld?
 *
 * Der Tasten-Handler haengt am FENSTER und verschluckt die Spieltasten per
 * preventDefault. Ohne dieses Tor frisst er sie auch im Namens- und im
 * Code-Feld: "Tyson" wurde zu "Tyon", und weil das Code-Alphabet
 * (ABCDEFGHJKMNPQRSTUVWXYZ23456789) ALLE sieben Buchstabentasten enthaelt
 * -- A D E F Q S W -- liessen sich 64 % der Arena-Codes gar nicht eingeben.
 * Leerzeichen im Namen ebenso wenig.
 */
export function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable === true;
}

/**
 * Tasten, deren Druck GERASTET wird.
 *
 * Die Eingabe wird nur im Servertakt abgetastet (30 Hz = alle 33 ms). Ein
 * kuerzerer Druck faellt zwischen zwei Abtastungen durch und kommt nie an --
 * live gemessen: unter 20 ms loeste kein Biss aus, der Spieler drueckt und es
 * passiert nichts. Deshalb merkt sich der Handler jeden Druck bis zur
 * naechsten Abtastung.
 *
 * ⚠️ Sprint ist bewusst NICHT dabei: das ist ein Halten, kein Antippen. Ein
 * gerasteter Sprint waere ein Ein-Bild-Satz nach vorn.
 */
/**
 * Zeigersteuerung wie in Diablo: linke Taste HALTEN laesst den Hund zum
 * Mauszeiger laufen, die rechte beisst.
 *
 * ⚠️ Vorher beiss die LINKE Taste. Das Laufen bekommt sie, weil es die
 * Dauerhandlung ist -- Beissen ist ein Einzelschlag und liegt jetzt rechts
 * (die Leertaste bleibt selbstverstaendlich).
 */
const AIM_DEAD = 24;         // Welteinheiten: naeher dran wird nicht gelaufen
const AIM_RAMP = 34;         // darueber sanft auf volles Tempo

const TAP_BITS = {
  Space: BTN.BITE,
  KeyE: BTN.BARK,
  KeyQ: BTN.NOSE,
  KeyF: BTN.NOSE,
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.tapped = 0;               // gerastete Druecke, bis read() sie abholt
    this.stick = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.touchBtn = { bite: false, bark: false, nose: false, run: false };
    this.tapTouch = 0;             // dasselbe fuer die Bildschirmknoepfe
    this.mouse = { x: 0, y: 0, held: false, inside: false };
    this.aim = null;               // Weltrichtung zum Zeiger, je Bild gesetzt
    this.onPause = null;

    addEventListener('keydown', e => {
      // Das Textfeld gewinnt immer -- sonst frisst der Handler die Eingabe.
      if (isTypingTarget(e.target)) return;
      // Cmd+W / Strg+W schliesst den Tab, Cmd+A markiert: nie abfangen.
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.repeat) return;
      if (e.code === 'Escape' && this.onPause) this.onPause();
      if (this._isGameKey(e.code)) e.preventDefault();
      this.keys.add(e.code);
      this.tapped |= TAP_BITS[e.code] || 0;
    });
    // keyup NICHT toren: wer beim Loslassen gerade ins Feld geklickt hat,
    // haette sonst eine Taste, die fuer immer gedrueckt bleibt.
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.mouse.held = false; this.mouseBite = false; });

    canvas.addEventListener('pointerdown', e => this._down(e), { passive: false });
    canvas.addEventListener('pointermove', e => this._move(e), { passive: false });
    canvas.addEventListener('pointerup',   e => this._up(e));
    canvas.addEventListener('pointercancel', e => this._up(e));
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  _isGameKey(c) {
    return ['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space','KeyW','KeyA','KeyS','KeyD',
            'KeyQ','KeyE','KeyF','ShiftLeft','ShiftRight'].includes(c);
  }

  // Maus: links laufen, rechts beissen. Finger: linke Bildhaelfte = Stick.
  _down(e) {
    this.canvas.setPointerCapture?.(e.pointerId);
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (e.pointerType === 'mouse') {
      this.mouse.x = x; this.mouse.y = y; this.mouse.inside = true;
      if (e.button === 2) { this.mouseBite = true; this.tapped |= BTN.BITE; }
      else if (e.button === 0) this.mouse.held = true;
      e.preventDefault();
      return;
    }
    if (x < r.width * 0.5 && !this.stick.active) {
      this.stick = { active: true, id: e.pointerId, ox: x, oy: y, x, y };
      e.preventDefault();
    }
  }
  _move(e) {
    const r = this.canvas.getBoundingClientRect();
    if (e.pointerType === 'mouse') {
      // Auch ohne gedrueckte Taste mitfuehren: beim ersten Klick muss die
      // Richtung sofort stimmen, nicht erst nach der ersten Bewegung.
      this.mouse.x = e.clientX - r.left;
      this.mouse.y = e.clientY - r.top;
      this.mouse.inside = true;
      return;
    }
    if (!this.stick.active || e.pointerId !== this.stick.id) return;
    this.stick.x = e.clientX - r.left;
    this.stick.y = e.clientY - r.top;
    e.preventDefault();
  }
  _up(e) {
    if (e.pointerType === 'mouse') {
      if (e.button === 2) this.mouseBite = false;
      else if (e.button === 0) this.mouse.held = false;
      return;
    }
    if (this.stick.active && e.pointerId === this.stick.id) this.stick.active = false;
  }

  /** Weltrichtung zum Zeiger; main.js setzt sie je Bild aus dem Renderer. */
  setAim(aim) { this.aim = aim; }

  /** -> {dx, dy, btn} */
  read() {
    let dx = 0, dy = 0;
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft'))  dx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) dx += 1;
    if (k.has('KeyW') || k.has('ArrowUp'))    dy -= 1;
    if (k.has('KeyS') || k.has('ArrowDown'))  dy += 1;

    // Maus haelt: zum Zeiger laufen. Innerhalb der Totzone stehen bleiben,
    // darueber sanft auf volles Tempo -- ohne die Rampe pendelt der Hund um
    // den Zielpunkt, weil er bei jedem Bild ueberschiesst.
    if (this.mouse.held && this.aim && this.aim.dist > AIM_DEAD) {
      const m = Math.min(1, (this.aim.dist - AIM_DEAD) / AIM_RAMP);
      dx = (this.aim.dx / this.aim.dist) * m;
      dy = (this.aim.dy / this.aim.dist) * m;
    }

    if (this.stick.active) {
      const sx = this.stick.x - this.stick.ox, sy = this.stick.y - this.stick.oy;
      const d = Math.hypot(sx, sy);
      const dead = 12, max = 62;
      if (d > dead) {
        const m = Math.min(1, (d - dead) / (max - dead));
        dx = (sx / d) * m; dy = (sy / d) * m;
      }
    }

    let btn = 0;
    if (k.has('ShiftLeft') || k.has('ShiftRight') || this.touchBtn.run) btn |= BTN.RUN;
    if (k.has('Space') || this.mouseBite || this.touchBtn.bite) btn |= BTN.BITE;
    if (k.has('KeyE') || this.touchBtn.bark) btn |= BTN.BARK;
    if (k.has('KeyQ') || k.has('KeyF') || this.touchBtn.nose) btn |= BTN.NOSE;

    // Gerastete Druecke einmal mitgeben, dann loeschen. read() laeuft genau
    // einmal je Servertakt (main.js), die Raste wird also nie doppelt gelesen.
    btn |= this.tapped | this.tapTouch;
    this.tapped = 0;
    this.tapTouch = 0;

    return { dx, dy, btn };
  }

  /** Bildschirmknopf gedrueckt -- rastet wie eine Taste. */
  pressTouch(key) {
    this.touchBtn[key] = true;
    if (key === 'bite') this.tapTouch |= BTN.BITE;
    else if (key === 'bark') this.tapTouch |= BTN.BARK;
    else if (key === 'nose') this.tapTouch |= BTN.NOSE;
  }

  stickView() { return this.stick.active ? this.stick : null; }
}
