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

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.stick = { active: false, id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.touchBtn = { bite: false, bark: false, nose: false, run: false };
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
    });
    // keyup NICHT toren: wer beim Loslassen gerade ins Feld geklickt hat,
    // haette sonst eine Taste, die fuer immer gedrueckt bleibt.
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

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

  // Linke Bildhaelfte = Stick, rechte = Maus-Biss
  _down(e) {
    this.canvas.setPointerCapture?.(e.pointerId);
    const r = this.canvas.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    if (e.pointerType === 'mouse') { this.mouseBite = true; return; }
    if (x < r.width * 0.5 && !this.stick.active) {
      this.stick = { active: true, id: e.pointerId, ox: x, oy: y, x, y };
      e.preventDefault();
    }
  }
  _move(e) {
    if (!this.stick.active || e.pointerId !== this.stick.id) return;
    const r = this.canvas.getBoundingClientRect();
    this.stick.x = e.clientX - r.left;
    this.stick.y = e.clientY - r.top;
    e.preventDefault();
  }
  _up(e) {
    if (e.pointerType === 'mouse') { this.mouseBite = false; return; }
    if (this.stick.active && e.pointerId === this.stick.id) this.stick.active = false;
  }

  /** -> {dx, dy, btn} */
  read() {
    let dx = 0, dy = 0;
    const k = this.keys;
    if (k.has('KeyA') || k.has('ArrowLeft'))  dx -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) dx += 1;
    if (k.has('KeyW') || k.has('ArrowUp'))    dy -= 1;
    if (k.has('KeyS') || k.has('ArrowDown'))  dy += 1;

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

    return { dx, dy, btn };
  }

  stickView() { return this.stick.active ? this.stick : null; }
}
