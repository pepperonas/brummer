// Bot-Gegner. Sie laufen durch DIESELBE stepPlayer-Simulation wie Menschen --
// sie erzeugen nur Eingaben, keine Sonderwege. Damit kann ein Bot nichts,
// was ein Spieler nicht auch koennte.
import { BTN, BITE, BONE, CACHE, DIG, SNIFF, HOUSE, ARENA, houseFor, cacheAt, util } from '../shared/sim.js';
const { len } = util;

export const BOT_NAMES = ['Brutus', 'Buddy', 'Rocky', 'Nala', 'Balu', 'Kira', 'Sam', 'Emma'];

const NONE = { dx: 0, dy: 0, btn: 0, seq: 0 };

function toward(p, tx, ty) {
  const dx = tx - p.x, dy = ty - p.y;
  const d = len(dx, dy) || 1;
  return { dx: dx / d, dy: dy / d, d };
}

export function botInput(p, room, playing) {
  if (!playing || p.stunT > 0) return NONE;
  const b = p.brain;
  b.t += 1 / 30;

  const house = houseFor(p.slot);

  // 1. Traegt einen Knochen -> heim, dabei Verfolger wegbellen
  if (p.carrying) {
    const t = toward(p, house.x, house.y);
    let btn = BTN.RUN;
    // Jemand dicht hinter mir? Bellen.
    for (const o of room.players.values()) {
      if (o.id === p.id) continue;
      if (len(o.x - p.x, o.y - p.y) < 170 && p.barkCd <= 0) { btn |= BTN.BARK; break; }
    }
    return { dx: t.dx, dy: t.dy, btn, seq: 0 };
  }

  // 2. Traeger in Beissweite -> zubeissen
  let prey = null, preyD = 1e9;
  for (const o of room.players.values()) {
    if (o.id === p.id || o.stunT > 0) continue;
    const d = len(o.x - p.x, o.y - p.y);
    if (!o.carrying && d > 200) continue;      // nur Traeger weiter verfolgen
    const w = o.carrying ? d * 0.45 : d;       // Traeger sind attraktiver
    if (w < preyD) { preyD = w; prey = o; }
  }
  if (prey && preyD < 420) {
    const t = toward(p, prey.x, prey.y);
    let btn = BTN.RUN;
    // Erst zubeissen, wenn er wirklich vor der Schnauze ist
    if (t.d < BITE.range * 0.85 && p.biteCd <= 0) btn |= BTN.BITE;
    return { dx: t.dx, dy: t.dy, btn, seq: 0 };
  }

  // 3. Naechster freier Knochen
  let bone = null, bd = 1e9;
  for (const bo of room.bones) {
    if (bo.by || bo.t > 0) continue;
    const d = len(bo.x - p.x, bo.y - p.y);
    if (d < bd) { bd = d; bone = bo; }
  }

  // 4. Ein Depot direkt unter der Nase? Ausgraben lohnt (3 Knochen).
  const c = cacheAt(room, p.x, p.y);
  if (c) return { dx: 0, dy: 0, btn: BTN.NOSE, seq: 0 };

  // Gelegentlich ein bekanntes Depot ansteuern, aber nicht allwissend wirken:
  // nur wenn es naeher ist als der naechste Knochen und der Bot "geschnueffelt" hat.
  if (b.t % 9 < 1 / 30 && p.sniffCd <= 0) {
    b.knows = null;
    let best = null, bestD = 1e9;
    for (const ca of room.caches) {
      if (ca.taken) continue;
      const d = len(ca.x - p.x, ca.y - p.y);
      if (d < SNIFF.radius && d < bestD) { bestD = d; best = ca; }
    }
    b.knows = best;
    return { dx: 0, dy: 0, btn: BTN.NOSE, seq: 0 };
  }
  if (b.knows && !b.knows.taken) {
    const d = len(b.knows.x - p.x, b.knows.y - p.y);
    if (d < bd * 1.3) {
      const t = toward(p, b.knows.x, b.knows.y);
      return { dx: t.dx, dy: t.dy, btn: d > 260 ? BTN.RUN : 0, seq: 0 };
    }
  }

  if (bone) {
    const t = toward(p, bone.x, bone.y);
    // Leichtes Schlingern, damit die Wege nicht wie am Lineal aussehen
    const w = Math.sin(b.t * 1.7 + b.jitter * 6) * 0.18;
    return { dx: t.dx + -t.dy * w, dy: t.dy + t.dx * w, btn: bd > 300 ? BTN.RUN : 0, seq: 0 };
  }

  // 5. Nichts zu tun: gemuetlich zur Mitte
  const t = toward(p, ARENA.w / 2, ARENA.h / 2);
  return { dx: t.dx, dy: t.dy, btn: 0, seq: 0 };
}
