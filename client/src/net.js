// Netzcode.
//
// Der Server ist autoritativ. Damit sich die eigene Figur trotzdem sofort
// bewegt, laeuft hier eine VORHERSAGE: jede Eingabe wird lokal sofort
// angewendet und aufbewahrt; kommt ein Schnappschuss, wird die eigene Figur
// auf den Serverzustand gesetzt und alle seither ungequittierten Eingaben
// werden erneut abgespielt. Fremde Figuren werden dagegen INTERPOLIERT --
// sie werden bewusst ~90 ms in der Vergangenheit gezeichnet, weil man sonst
// bei jedem Paketverlust raten muesste.
import { DT, TICK_HZ, makePlayer, stepPlayer } from '../../shared/sim.js';

const ANIM = ['idle', 'walk', 'prowl', 'run', 'bite', 'bark', 'sniff', 'dig', 'stunned'];
export const INTERP_MS = 90;

export class Net {
  constructor() {
    this.ws = null;
    this.you = -1;
    this.room = '';
    this.code = '';
    this.connected = false;
    this.meta = new Map();          // slot -> {name, bot}
    this.buffer = [];               // Schnappschuesse fuer die Interpolation
    this.pending = [];              // eigene, noch nicht quittierte Eingaben
    this.seq = 0;
    this.me = null;                 // vorhergesagter eigener Zustand
    this.world = { caches: [] };    // fuer stepPlayer (Depots)
    this.bones = [];
    this.caches = [];
    this.phase = 'play';
    this.phaseT = 0;
    this.board = null;
    this.rtt = 0;
    this.onEvent = () => {};
    this.onMeta  = () => {};
    this.onClose = () => {};
    this._pingT = 0;
  }

  connect(name, roomCode, playerCode) {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/ws`;
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.ws.send(JSON.stringify({ t: 'join', name, room: roomCode || '', code: playerCode || null }));
    };
    this.ws.onmessage = e => this._msg(JSON.parse(e.data));
    this.ws.onclose = () => { this.connected = false; this.onClose(); };
    this.ws.onerror = () => {};
  }

  disconnect() { try { this.ws && this.ws.close(); } catch {} }

  _msg(m) {
    if (m.t === 'hello') {
      this.you = m.you; this.room = m.room; this.code = m.code;
      this.connected = true;
      this.me = makePlayer('me', 'me', m.you);
      return;
    }
    if (m.t === 'meta') {
      this.meta.clear();
      for (const p of m.ps) this.meta.set(p.slot, { name: p.name, bot: !!p.bot });
      this.onMeta();
      return;
    }
    if (m.t === 'pong') { this.rtt = performance.now() - m.c; return; }
    if (m.t === 'err')  { this.onEvent({ e: 'err', msg: m.msg }); return; }
    if (m.t !== 's') return;

    // Schnappschuss einreihen
    m._at = performance.now();
    this.buffer.push(m);
    if (this.buffer.length > 40) this.buffer.shift();

    this.phase = m.ph; this.phaseT = m.pt;
    this.bones = m.bs; this.caches = m.cs;
    this.world.caches = m.cs.map(c => ({ x: c[1], y: c[2], taken: false }));

    for (const ev of m.ev) {
      if (ev.e === 'round' && ev.phase === 'over') this.board = ev.board;
      if (ev.e === 'round' && ev.phase === 'play') this.board = null;
      this.onEvent(ev);
    }

    this._reconcile(m);
  }

  /** Eigene Figur auf den Serverstand setzen und ungequittierte Eingaben nachspielen. */
  _reconcile(m) {
    const row = m.ps.find(p => p[0] === this.you);
    if (!row || !this.me) return;
    const s = this.me;
    const ackSeq = row[11];

    s.x = row[1]; s.y = row[2]; s.vx = row[3]; s.vy = row[4];
    s.facing = row[5];
    s.score = row[7]; s.stam = row[8];
    s.carrying = row[9] ? 1 : null;
    s.stunT = row[10] / 100;
    s.digT = (row[12] / 100) * 2.0;
    s.sniffT = row[13] ? 1 : 0;

    // Alles bis einschliesslich ackSeq ist verarbeitet
    this.pending = this.pending.filter(p => p.seq > ackSeq);
    for (const p of this.pending) stepPlayer(s, p, this.world);
  }

  /** Eingabe senden UND lokal sofort anwenden. */
  sendInput(inp) {
    if (!this.connected || !this.me) return;
    const msg = { t: 'in', dx: +inp.dx.toFixed(3), dy: +inp.dy.toFixed(3), btn: inp.btn, seq: ++this.seq };
    this.pending.push(msg);
    if (this.pending.length > 90) this.pending.shift();
    stepPlayer(this.me, msg, this.world);
    if (this.ws.readyState === 1) this.ws.send(JSON.stringify(msg));

    const now = performance.now();
    if (now - this._pingT > 2000) { this._pingT = now; this.ws.send(JSON.stringify({ t: 'ping', c: now })); }
  }

  /** Zustand aller Figuren zum Zeichnen. Eigene vorhergesagt, fremde interpoliert. */
  view() {
    const out = [];
    if (this.me) {
      out.push({
        slot: this.you, x: this.me.x, y: this.me.y, facing: this.me.facing,
        anim: this.me.anim, score: this.me.score, stam: this.me.stam,
        carrying: !!this.me.carrying, stun: this.me.stunT, dig: this.me.digT / 2.0,
        sniff: this.me.sniffT > 0, you: true,
        name: (this.meta.get(this.you) || {}).name || 'Du',
      });
    }
    const t = performance.now() - INTERP_MS;
    let a = null, b = null;
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i]._at <= t) { a = this.buffer[i]; b = this.buffer[i + 1] || null; break; }
    }
    if (!a) a = this.buffer[0];
    if (!a) return out;
    const alpha = (b && b._at > a._at) ? Math.min(1, (t - a._at) / (b._at - a._at)) : 0;

    for (const row of a.ps) {
      const slot = row[0];
      if (slot === this.you) continue;
      let x = row[1], y = row[2];
      if (b) {
        const rb = b.ps.find(p => p[0] === slot);
        if (rb) { x += (rb[1] - x) * alpha; y += (rb[2] - y) * alpha; }
      }
      const meta = this.meta.get(slot) || {};
      out.push({
        slot, x, y, facing: row[5], anim: ANIM[row[6]] || 'idle',
        score: row[7], stam: row[8], carrying: !!row[9],
        stun: row[10] / 100, dig: row[12] / 100, sniff: !!row[13],
        you: false, name: meta.name || '?', bot: !!meta.bot,
      });
    }
    return out;
  }

  /** Knochen mit Interpolation (sie haengen an Traegern). */
  bonesView() {
    const t = performance.now() - INTERP_MS;
    let a = null, b = null;
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      if (this.buffer[i]._at <= t) { a = this.buffer[i]; b = this.buffer[i + 1] || null; break; }
    }
    if (!a) a = this.buffer[this.buffer.length - 1];
    if (!a) return [];
    const alpha = (b && b._at > a._at) ? Math.min(1, (t - a._at) / (b._at - a._at)) : 0;
    return a.bs.map(r => {
      let x = r[1], y = r[2];
      if (b) { const rb = b.bs.find(q => q[0] === r[0]); if (rb) { x += (rb[1] - x) * alpha; y += (rb[2] - y) * alpha; } }
      return { id: r[0], x, y, by: r[3] };
    });
  }

  scoreboard() {
    const rows = [];
    const seen = new Set();
    for (const v of this.view()) { rows.push({ slot: v.slot, name: v.name, score: v.score, bot: v.bot, you: v.you }); seen.add(v.slot); }
    return rows.sort((p, q) => q.score - p.score);
  }
}
